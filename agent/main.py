"""
main.py — FastAPI application for the GemAI agent/RAG service.

Phase 2: POST /ingest and GET /health only.
Phase 3: adds POST /query
Phase 4: LangGraph workflow + LangSmith tracing
Phase 5: POST /draft (Node.js proxies all routes here)
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("gemai-agent")

# ─── Lifespan ─────────────────────────────────────────────────────────────────
# Pre-load the embedding model at startup so the first /ingest call isn't slow.

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting GemAI agent service (Phase 2) …")
    # Eagerly load the BGE model so it's warm before the first request
    from src.embedder import _get_embeddings
    _get_embeddings()
    logger.info("Embedding model ready. Service is up.")
    yield
    logger.info("GemAI agent service shutting down.")


app = FastAPI(
    title="GemAI Agent Service",
    description="RAG + LangGraph email assistant backend",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response schemas ───────────────────────────────────────────────

class IngestRequest(BaseModel):
    email: Optional[str] = None   # filter by Gmail account; None = ingest all


class IngestResponse(BaseModel):
    success: bool
    embedded: int
    skipped: int
    message: str


class QueryRequest(BaseModel):
    email: str
    question: str


class SourceItem(BaseModel):
    subject: str
    sender: str
    date: str
    thread_id: str


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceItem]


class DraftRequest(BaseModel):
    email: str
    thread_id: str
    instruction: str


class DraftResponse(BaseModel):
    to: str
    subject: str
    body: str
    thread_id: str
    status: str = "pending_approval"


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "gemai-agent", "phase": 5}


@app.post("/ingest", response_model=IngestResponse)
def ingest(body: IngestRequest):
    """
    Trigger the embedding pipeline:
      1. Read un-indexed emails from SQLite
      2. Build thread-aware Documents
      3. Embed with BGE-base-en-v1.5 and store in Chroma
      4. Mark emails as indexed=1 in SQLite
    """
    from src.ingest import run_ingest
    try:
        result = run_ingest(user_email=body.email)
        return IngestResponse(
            success=True,
            embedded=result["embedded"],
            skipped=result["skipped"],
            message=(
                f"Embedded {result['embedded']} documents, "
                f"skipped {result['skipped']} already-indexed."
            ),
        )
    except Exception as exc:
        logger.exception("Ingest failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/query", response_model=QueryResponse)
def query(body: QueryRequest):
    """
    Run the LangGraph agent workflow:
      1. retrieve_emails -> generate_answer -> self_check (structured groundedness)
      2. If ungrounded & retry_count < 1 -> rewrite_query -> re-retrieve & accumulate docs
      3. If ungrounded & retry_count >= 1 -> fallback_answer (empty sources)
    """
    from src.graph import run_agent
    try:
        result = run_agent(body.question, user_email=body.email)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Query failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/draft", response_model=DraftResponse)
def draft(body: DraftRequest):
    """
    Generate an email draft reply with human-in-the-loop safeguards:
      - Retrieves thread messages and recipient
      - Contextualizes with RAG excerpts from Chroma
      - Status is always set to 'pending_approval' (never sent automatically)
    """
    from src.drafter import generate_draft, ThreadNotFoundError
    try:
        result = generate_draft(
            user_email=body.email,
            thread_id=body.thread_id,
            instruction=body.instruction,
        )
        return result
    except ThreadNotFoundError as tne:
        raise HTTPException(status_code=404, detail=str(tne))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Draft generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


