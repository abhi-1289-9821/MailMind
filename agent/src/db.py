"""
db.py — SQLite reader/writer for the shared gemai.db.

Uses Python's built-in sqlite3 module; no ORM needed.
The DB file was created by the Node/Express server using sql.js (standard SQLite
binary format), so Python's sqlite3 reads/writes it with full compatibility.
"""

import sqlite3
from datetime import datetime, timezone
from typing import Optional


def _connect(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row   # rows accessible as dict-like objects
    return con


def get_unindexed_emails(
    db_path: str,
    user_email: Optional[str] = None,
) -> list[dict]:
    """
    Return all emails with indexed=0 from the SQLite DB.

    Optionally filter by user_email (useful when multiple accounts are stored).
    Rows are ordered by thread_id then date_sent so the caller gets them pre-
    sorted for thread-aware chunking.

    Returns a list of plain dicts with keys:
        id, thread_id, user_email, subject, sender,
        recipient, date_sent, body, has_attachment
    """
    con = _connect(db_path)
    try:
        if user_email:
            rows = con.execute(
                """
                SELECT id, thread_id, user_email, subject, sender,
                       recipient, date_sent, body, has_attachment
                FROM   emails
                WHERE  indexed = 0
                  AND  user_email = ?
                ORDER  BY thread_id, date_sent ASC
                """,
                (user_email,),
            ).fetchall()
        else:
            rows = con.execute(
                """
                SELECT id, thread_id, user_email, subject, sender,
                       recipient, date_sent, body, has_attachment
                FROM   emails
                WHERE  indexed = 0
                ORDER  BY thread_id, date_sent ASC
                """,
            ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def get_already_indexed_ids(db_path: str) -> set[str]:
    """Return the set of message IDs already marked as indexed=1."""
    con = _connect(db_path)
    try:
        rows = con.execute("SELECT id FROM emails WHERE indexed = 1").fetchall()
        return {row["id"] for row in rows}
    finally:
        con.close()


def count_indexed_emails(db_path: str, user_email: Optional[str] = None) -> int:
    """
    Return the number of emails already marked indexed=1 for a given user
    (or across all users if user_email is None).

    Used by ingest.py to report an honest 'skipped' count — emails that were
    already embedded in a previous run and skipped this time.
    """
    con = _connect(db_path)
    try:
        if user_email:
            row = con.execute(
                "SELECT COUNT(*) FROM emails WHERE indexed = 1 AND user_email = ?",
                (user_email,),
            ).fetchone()
        else:
            row = con.execute(
                "SELECT COUNT(*) FROM emails WHERE indexed = 1"
            ).fetchone()
        return row[0] if row else 0
    finally:
        con.close()


def mark_indexed(db_path: str, ids: list[str]) -> int:
    """
    Set indexed=1 for the given list of email IDs in a single UPDATE.
    Returns the number of rows updated.
    """
    if not ids:
        return 0
    placeholders = ",".join("?" * len(ids))
    con = _connect(db_path)
    try:
        cur = con.execute(
            f"UPDATE emails SET indexed = 1 WHERE id IN ({placeholders})",
            ids,
        )
        con.commit()
        return cur.rowcount
    finally:
        con.close()


def get_thread_emails(
    db_path: str,
    thread_id: str,
    user_email: Optional[str] = None,
) -> list[dict]:
    """
    Fetch all email messages belonging to a thread, ordered chronologically.

    Args:
        db_path:    Path to SQLite file.
        thread_id:  Gmail thread ID.
        user_email: Optional user email to ensure account isolation.

    Returns:
        List of dicts representing email messages in ascending date_sent order.
    """
    con = _connect(db_path)
    try:
        if user_email:
            cur = con.execute(
                """
                SELECT id, thread_id, sender, recipient, subject,
                       body, date_sent, user_email
                FROM emails
                WHERE thread_id = ? AND user_email = ?
                ORDER BY date_sent ASC
                """,
                (thread_id, user_email),
            )
        else:
            cur = con.execute(
                """
                SELECT id, thread_id, sender, recipient, subject,
                       body, date_sent, user_email
                FROM emails
                WHERE thread_id = ?
                ORDER BY date_sent ASC
                """,
                (thread_id,),
            )
        return [dict(row) for row in cur.fetchall()]
    finally:
        con.close()

