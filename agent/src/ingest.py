"""
ingest.py — Orchestrates the full email ingestion pipeline.

Flow
----
1. Read un-indexed emails from SQLite  (db.get_unindexed_emails)
2. Build thread-aware Documents         (chunker.build_documents)
3. Embed + upsert into Chroma           (embedder.upsert_documents)
4. Mark those emails as indexed=1       (db.mark_indexed)
5. Return a summary dict

Called directly from main.py (FastAPI route) and importable for testing.
"""

import logging
import os
from typing import Optional

from dotenv import load_dotenv

from .db import get_unindexed_emails, mark_indexed, count_indexed_emails
from .chunker import build_documents
from .embedder import upsert_documents

load_dotenv()

logger = logging.getLogger(__name__)


def run_ingest(user_email: Optional[str] = None) -> dict:
    """
    Run the full ingest pipeline for all un-indexed emails.

    Args:
        user_email: If provided, only ingest emails for this Gmail account.
                    If None, ingest all un-indexed emails regardless of account.

    Returns:
        {
            "embedded": int,   # documents added/updated in Chroma
            "skipped":  int,   # emails already marked indexed (filtered out by DB query)
            "total_in_db": int # total emails in SQLite for this user
        }
    """
    db_path      = os.environ["SQLITE_DB_PATH"]
    chroma_path  = os.environ["CHROMA_DB_PATH"]
    collection   = os.environ["CHROMA_COLLECTION"]

    # Step 1 — count already-indexed emails BEFORE filtering (honest skipped count)
    skipped = count_indexed_emails(db_path, user_email=user_email)

    # Step 2 — read un-indexed emails
    logger.info("Reading un-indexed emails from SQLite (user=%s) …", user_email or "all")
    emails = get_unindexed_emails(db_path, user_email=user_email)

    if not emails:
        logger.info(
            "No un-indexed emails found. %d already indexed (skipped).", skipped
        )
        return {"embedded": 0, "skipped": skipped}

    logger.info("Found %d un-indexed emails. Building documents …", len(emails))

    # Step 2 — thread-aware chunking
    docs = build_documents(emails)

    logger.info(
        "Built %d documents from %d emails across %d threads.",
        len(docs),
        len(emails),
        len({e["thread_id"] for e in emails}),
    )

    # Step 4 — embed + store in Chroma
    logger.info("Embedding and upserting into Chroma collection '%s' …", collection)
    embedded = upsert_documents(docs, chroma_path=chroma_path, collection=collection)

    # Step 5 — mark as indexed in SQLite
    ids_to_mark = [e["id"] for e in emails]
    updated = mark_indexed(db_path, ids_to_mark)
    logger.info("Marked %d emails as indexed=1 in SQLite.", updated)

    return {
        "embedded": embedded,
        "skipped":  skipped,  # already-indexed before this run (Option A)
    }
