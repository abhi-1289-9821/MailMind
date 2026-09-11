"""
chunker.py — Thread-aware LangChain Document builder.

Strategy
--------
- One Document per email message (no intra-email splitting).
- Messages are grouped by thread_id and sorted by date_sent (ascending),
  so each chunk carries its position-in-thread as metadata.
- A plain-text header is prepended to the body so the LLM (Phase 3) can
  understand thread context without needing to decode metadata separately.
- Body is truncated at MAX_BODY_CHARS to stay within embedding token limits
  (bge-base-en-v1.5 max context = 512 tokens ≈ 1 500–2 000 chars).

Metadata stored per Document (all passed through to Chroma):
    message_id      – Gmail message ID (used as Chroma document ID for upserts)
    thread_id       – Gmail thread ID
    message_index   – 0-based position of this message within its thread
    thread_size     – total messages in the thread at ingest time
    subject         – email subject line
    sender          – From header
    date_sent       – Unix timestamp (int); -1 if missing
    user_email      – Gmail account that owns this email
"""

from datetime import datetime, timezone
from itertools import groupby

from langchain_core.documents import Document

MAX_BODY_CHARS = 2_000   # safe limit for 512-token bge-base-en-v1.5 context window


def _fmt_date(unix_ts: int | None) -> str:
    """Convert a Unix timestamp to a human-readable UTC string."""
    if not unix_ts:
        return "Unknown date"
    try:
        return datetime.fromtimestamp(unix_ts, tz=timezone.utc).strftime(
            "%a, %d %b %Y %H:%M UTC"
        )
    except (OSError, ValueError):
        return "Unknown date"


def build_documents(emails: list[dict]) -> list[Document]:
    """
    Convert a list of email dicts (from db.get_unindexed_emails) into LangChain
    Documents, preserving thread order and enriching with thread-position context.

    The input list is expected to already be sorted by (thread_id, date_sent)
    — db.get_unindexed_emails() guarantees this via ORDER BY.

    Returns a flat list of Documents (same order as input, thread-grouped).
    """
    docs: list[Document] = []

    # Group by thread_id (rows are pre-sorted, so groupby works correctly)
    for thread_id, thread_iter in groupby(emails, key=lambda e: e["thread_id"]):
        thread_emails = list(thread_iter)
        thread_size = len(thread_emails)

        for idx, email in enumerate(thread_emails):
            body = (email.get("body") or "").strip()
            truncated_body = body[:MAX_BODY_CHARS]
            was_truncated = len(body) > MAX_BODY_CHARS

            # Plain-text header gives the LLM immediate context
            header = (
                f"Thread-ID:    {thread_id}\n"
                f"Message:      {idx + 1} of {thread_size}\n"
                f"From:         {email.get('sender') or 'Unknown'}\n"
                f"Date:         {_fmt_date(email.get('date_sent'))}\n"
                f"Subject:      {email.get('subject') or '(no subject)'}\n"
            )
            if was_truncated:
                header += "[Note: body truncated to 2 000 chars for embedding]\n"

            page_content = f"{header}\n{truncated_body}"

            docs.append(
                Document(
                    page_content=page_content,
                    metadata={
                        "message_id":    email["id"],
                        "thread_id":     thread_id,
                        "message_index": idx,
                        "thread_size":   thread_size,
                        "subject":       email.get("subject") or "",
                        "sender":        email.get("sender") or "",
                        "date_sent":     email.get("date_sent") or -1,
                        "user_email":    email.get("user_email") or "",
                    },
                )
            )

    return docs
