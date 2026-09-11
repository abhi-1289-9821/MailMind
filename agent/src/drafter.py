"""
drafter.py — Context-aware email reply drafter with human-in-the-loop safeguards.

Safety:
- Generates reply draft with status="pending_approval".
- The system NEVER sends an email automatically.
- All actual sends require explicit human approval and dedicated OAuth scope.
"""

import logging
import os
import re
from typing import Optional

from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from .llm import get_chat_model

from .chunker import _fmt_date
from .db import get_thread_emails
from .rag_chain import format_docs
from .retriever import get_retriever

load_dotenv()

logger = logging.getLogger(__name__)


class ThreadNotFoundError(Exception):
    """Raised when the specified thread_id does not exist in SQLite for the user."""
    pass


DRAFT_PROMPT_TEMPLATE = """You are an AI email assistant drafting a reply on behalf of {user_email}.

--- CONVERSATION THREAD (Chronological) ---
{thread_history}
--- END THREAD ---

--- ADDITIONAL RELEVANT EMAIL EXCERPTS ---
{extra_context}
--- END EXCERPTS ---

User Instruction:
"{instruction}"

Instructions:
1. Write a professional, concise reply addressing the user instruction in the context of the conversation.
2. Maintain an appropriate tone consistent with the ongoing thread.
3. Output ONLY the email body text. Do not include subject lines, headers, or metadata.

Draft Reply:"""


def _extract_email_address(raw_header: str) -> str:
    """Extract clean email address from a header like 'John Doe <john@example.com>'."""
    if not raw_header:
        return ""
    match = re.search(r"<([^>]+)>", raw_header)
    if match:
        return match.group(1).strip()
    return raw_header.strip()


def generate_draft(
    user_email: str,
    thread_id: str,
    instruction: str,
) -> dict:
    """
    Generate a draft email reply for a thread.

    Args:
        user_email: The authenticating user's Gmail address.
        thread_id: The Gmail thread ID to reply to.
        instruction: User's intent/instruction (e.g. 'tell them I can do Tuesday').

    Returns:
        dict with { to, subject, body, thread_id, status: "pending_approval" }
    """
    db_path = os.environ.get("SQLITE_DB_PATH", "../server/data/gemai.db")
    chroma_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
    collection = os.environ.get("CHROMA_COLLECTION", "gemai_emails")

    llm = get_chat_model(temperature=0.3)

    # Step 1: Retrieve thread messages from SQLite
    thread_emails = get_thread_emails(db_path, thread_id, user_email=user_email)
    if not thread_emails:
        logger.warning("Thread '%s' not found for user '%s'", thread_id, user_email)
        raise ThreadNotFoundError(f"Thread '{thread_id}' not found for user '{user_email}'.")

    # Step 2: Determine recipient (find last message NOT sent by user_email)
    recipient_raw = ""
    user_email_clean = user_email.lower().strip()
    for msg in reversed(thread_emails):
        sender = msg.get("sender", "")
        sender_email = _extract_email_address(sender).lower()
        if sender_email != user_email_clean:
            recipient_raw = sender
            break

    # If all messages in thread were sent by the user, fallback to recipient of last message
    if not recipient_raw and thread_emails:
        recipient_raw = thread_emails[-1].get("recipient", "")

    recipient = _extract_email_address(recipient_raw)

    # Step 3: Format subject (Re: <clean_subject>)
    base_subject = thread_emails[-1].get("subject") or thread_emails[0].get("subject") or "No Subject"
    clean_subject = re.sub(r"^(Re:\s*)+", "", base_subject, flags=re.IGNORECASE).strip()
    reply_subject = f"Re: {clean_subject}" if clean_subject else "Re: Email"

    # Step 4: Build thread history text
    history_blocks = []
    for msg in thread_emails:
        date_str = _fmt_date(msg.get("date_sent"))
        sender_str = msg.get("sender", "Unknown")
        body_text = msg.get("body", "").strip()
        history_blocks.append(f"From: {sender_str} ({date_str})\n\n{body_text}")
    thread_history = "\n\n---\n\n".join(history_blocks)

    # Step 5: Query Chroma for external context related to instruction
    retriever = get_retriever(
        chroma_path=chroma_path,
        collection=collection,
        k=3,
        user_email=user_email,
    )
    extra_docs = retriever.invoke(instruction)
    extra_context = format_docs(extra_docs)

    # Step 6: Generate draft reply with configured LLM
    prompt = ChatPromptTemplate.from_template(DRAFT_PROMPT_TEMPLATE)
    chain = prompt | llm | StrOutputParser()

    logger.info("Generating draft reply for thread %s to %s...", thread_id, recipient)
    draft_body = chain.invoke({
        "user_email": user_email,
        "thread_history": thread_history,
        "extra_context": extra_context,
        "instruction": instruction,
    })

    return {
        "to": recipient,
        "subject": reply_subject,
        "body": draft_body.strip(),
        "thread_id": thread_id,
        "status": "pending_approval",
    }
