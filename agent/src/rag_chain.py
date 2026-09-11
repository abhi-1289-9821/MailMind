"""
rag_chain.py — Basic RAG chain (retrieve → prompt → gpt-4o-mini → answer + sources).

Flow:
1. Retrieve top-k relevant email chunks from Chroma using get_retriever()
   (filters by user_email metadata when provided for account isolation).
2. Format retrieved Document chunks into a clean context block.
3. Prompt gpt-4o-mini with anti-hallucination instructions.
4. Extract and deduplicate source citations by thread_id (highest-relevance-order wins).
5. Return {"answer": str, "sources": list[dict]}.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from .llm import get_chat_model

from .retriever import get_retriever

load_dotenv()

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE = """You are a helpful email assistant. Answer the question using ONLY the email
excerpts provided below. If the answer cannot be found in the excerpts, say
"I couldn't find that information in your emails." Do not invent facts.

Formatting Instructions:
- Format your response cleanly using GitHub-flavored Markdown.
- Use clear bullet points for lists, with each item on a new line.
- Use bold section headers (e.g. **Date / Category:**) to group items logically.
- Bold key entities such as job titles, company names, deadlines, amounts, and dates.
- Ensure proper paragraph and line spacing between sections for readability.
- When the user asks for "all" or multiple items (e.g., all rejections, all deadlines, all budgets, all proposals), carefully check every provided excerpt and list every single matching item.
- Accurately distinguish matching items (e.g. identify actual job rejection notifications like "unable to proceed" or "not moving forward", and do not confuse them with application receipt confirmations or account setup emails).

--- EMAIL EXCERPTS ---
{context}
--- END EXCERPTS ---

Question: {question}

Answer:"""


def _fmt_date(val: Any) -> str:
    """Format Unix timestamp or string into a readable date representation."""
    if not val:
        return "Unknown date"
    if isinstance(val, (int, float)):
        try:
            return datetime.fromtimestamp(val, tz=timezone.utc).strftime("%a, %d %b %Y")
        except (OSError, ValueError):
            return "Unknown date"
    return str(val)


def format_docs(docs: list[Document], max_docs: int = 6) -> str:
    """Format retrieved documents with clean delimiters and token budgeting."""
    if not docs:
        return "No relevant emails found."
    selected = docs[:max_docs]
    parts = []
    for doc in selected:
        content = doc.page_content.strip()
        if len(content) > 1400:
            content = content[:1400] + "... [truncated]"
        parts.append(content)
    return "\n\n---\n\n".join(parts)


def run_query(question: str, user_email: Optional[str] = None) -> dict:
    """
    Execute the RAG query pipeline.

    Args:
        question: Natural language question about the user's emails.
        user_email: Optional user email for metadata filtering / isolation.

    Returns:
        dict: {"answer": str, "sources": list[dict]}
    """
    chroma_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
    collection = os.environ.get("CHROMA_COLLECTION", "gemai_emails")

    llm = get_chat_model(temperature=0)

    # Step 1: Retrieve relevant documents (top-5 by cosine similarity)
    retriever = get_retriever(
        chroma_path=chroma_path,
        collection=collection,
        k=5,
        user_email=user_email,
    )
    docs = retriever.invoke(question)

    # Step 2: Format context for LLM
    context = format_docs(docs)

    # Step 3: Run LCEL prompt -> LLM -> parser chain
    prompt = ChatPromptTemplate.from_template(PROMPT_TEMPLATE)
    chain = prompt | llm | StrOutputParser()

    logger.info("Invoking LLM for query (retrieved %d chunks) ...", len(docs))
    answer = chain.invoke({"context": context, "question": question})

    # Step 4: Extract and deduplicate sources by thread_id (first-by-relevance order wins)
    seen_threads = set()
    sources = []
    for doc in docs:
        tid = doc.metadata.get("thread_id", "")
        if tid:
            if tid in seen_threads:
                continue
            seen_threads.add(tid)

        sources.append({
            "subject": doc.metadata.get("subject", ""),
            "sender": doc.metadata.get("sender", ""),
            "date": _fmt_date(doc.metadata.get("date_sent")),
            "thread_id": tid,
        })

    return {
        "answer": answer,
        "sources": sources,
    }
