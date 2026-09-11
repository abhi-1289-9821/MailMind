"""
graph.py — LangGraph Agent Workflow for GemAI Copilot (Phase 4).

Architecture:
- StateGraph:
    retrieve_emails -> generate_answer -> self_check -> conditional routing:
      * is_grounded == True  -> END
      * is_grounded == False & retry_count < 1 -> rewrite_query -> retrieve_emails
      * is_grounded == False & retry_count >= 1 -> fallback_answer -> END

Key Features:
- Deterministic Groundedness Check via Pydantic structured output (.with_structured_output).
- Document accumulation across retries (deduplicating by message_id).
- First-by-relevance-order source citation deduplication by thread_id.
- Safe fallback response with sources=[] when information is not in emails.
- Automatic LangSmith tracing when LANGCHAIN_TRACING_V2=true is set.
"""

import logging
import os
from typing import Any, Optional, TypedDict

from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from .llm import get_chat_model

from .rag_chain import PROMPT_TEMPLATE, _fmt_date, format_docs
from .retriever import get_retriever

load_dotenv()

logger = logging.getLogger(__name__)


# ─── Graph State ──────────────────────────────────────────────────────────────

class GraphState(TypedDict):
    question: str
    user_email: Optional[str]
    current_query: str
    documents: list[Document]
    answer: str
    sources: list[dict]
    is_grounded: bool
    retry_count: int


# ─── Structured Output for Self-Check ─────────────────────────────────────────

class GroundednessCheck(BaseModel):
    is_grounded: bool = Field(
        description=(
            "True if every factual claim in the answer is directly supported by the retrieved email excerpts. "
            "False if there are unsupported claims, hallucinations, or if the excerpts do not contain the answer."
        )
    )
    reasoning: str = Field(
        description="Concise rationale explaining whether claims are grounded in context."
    )


# ─── Graph Nodes ──────────────────────────────────────────────────────────────

def _search_sqlite_keywords(user_email: Optional[str], query: str) -> list[Document]:
    """
    Keyword search in SQLite to catch explicit terms and domain synonyms that
    dense semantic embeddings might rank lower (e.g. 'unable to proceed' for rejection queries).
    """
    import sqlite3
    from .chunker import build_documents

    db_path = os.environ.get("SQLITE_DB_PATH", "../server/data/gemai.db")
    if not os.path.exists(db_path):
        return []

    q_lower = query.lower()
    stopwords = {
        "what", "were", "the", "did", "say", "about", "is", "of", "all",
        "mail", "email", "emails", "from", "company", "companies", "to",
        "in", "and", "or", "for", "with", "any", "my", "me", "show", "list",
        "tell", "give", "get", "find"
    }
    raw_words = [w.strip("?,!.:;\"'()[]{}") for w in q_lower.split()]
    meaningful = [w for w in raw_words if len(w) > 2 and w not in stopwords]

    terms = list(meaningful)
    if any(r in q_lower for r in ["reject", "rejection", "declined"]):
        terms.extend([
            "unable to proceed", "not moving forward", "regret to inform",
            "not selected", "unsuccessful", "unfortunately"
        ])
    if any(d in q_lower for d in ["deadline", "due"]):
        terms.extend(["due date", "deadline", "by end of day", "eod"])
    if any(b in q_lower for b in ["budget", "cost", "pricing", "expense"]):
        terms.extend(["budget", "estimate", "quote", "cost", "invoice"])

    if not terms:
        return []

    unique_terms = list(dict.fromkeys(terms))[:10]

    try:
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        cur = con.cursor()

        conditions = " OR ".join(
            ["lower(body) LIKE ?" for _ in unique_terms] +
            ["lower(subject) LIKE ?" for _ in unique_terms]
        )
        params = [f"%{t}%" for t in unique_terms] * 2

        if user_email:
            sql = f"SELECT * FROM emails WHERE user_email = ? AND ({conditions}) ORDER BY date_sent DESC LIMIT 25"
            rows = cur.execute(sql, [user_email] + params).fetchall()
        else:
            sql = f"SELECT * FROM emails WHERE ({conditions}) ORDER BY date_sent DESC LIMIT 25"
            rows = cur.execute(sql, params).fetchall()

        con.close()
        if not rows:
            return []
        return build_documents([dict(r) for r in rows])
    except Exception as exc:
        logger.warning("SQLite keyword search fallback error: %s", exc)
        return []


def retrieve_emails(state: GraphState) -> dict:
    """Retrieve top-k relevant email chunks from Chroma + SQLite keywords and accumulate documents."""
    chroma_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
    collection = os.environ.get("CHROMA_COLLECTION", "gemai_emails")
    query = state.get("current_query") or state["question"]
    user_email = state.get("user_email")

    retriever = get_retriever(
        chroma_path=chroma_path,
        collection=collection,
        k=20,  # Increased from 5 to 20 for thorough coverage of aggregation questions
        user_email=user_email,
    )

    logger.info("Retrieving emails for query: '%s' (user: %s)", query, user_email or "all")
    dense_docs = retriever.invoke(query)
    keyword_docs = _search_sqlite_keywords(user_email, query)

    # Document accumulation: merge new dense + keyword docs with existing ones (deduplicated by message_id)
    existing_docs = state.get("documents", [])
    seen_message_ids = {
        doc.metadata.get("message_id")
        for doc in existing_docs
        if doc.metadata.get("message_id")
    }

    merged_docs = list(existing_docs)
    for doc in list(dense_docs) + list(keyword_docs):
        mid = doc.metadata.get("message_id")
        if not mid or mid not in seen_message_ids:
            if mid:
                seen_message_ids.add(mid)
            merged_docs.append(doc)

    # Deduplicate sources by thread_id (highest-relevance-order wins)
    seen_threads = set()
    sources = []
    for doc in merged_docs:
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
        "documents": merged_docs,
        "sources": sources,
    }


def generate_answer(state: GraphState) -> dict:
    """Synthesize an answer from retrieved excerpts using the configured LLM."""
    llm = get_chat_model(temperature=0)
    prompt = ChatPromptTemplate.from_template(PROMPT_TEMPLATE)
    chain = prompt | llm | StrOutputParser()

    context = format_docs(state.get("documents", []))
    logger.info("Generating answer for question with %d documents...", len(state.get("documents", [])))

    answer = chain.invoke({
        "context": context,
        "question": state["question"],
    })

    return {"answer": answer}


def self_check(state: GraphState) -> dict:
    """Verify that the generated answer is strictly grounded in retrieved excerpts."""
    llm = get_chat_model(temperature=0)
    evaluator = llm.with_structured_output(GroundednessCheck)

    check_prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            (
                "You are a strict factual grounding verifier. Your task is to evaluate whether "
                "the generated answer is completely faithful to and substantiated by the provided email context.\n\n"
                "Rules:\n"
                "1. If the answer states that it could not find the information or that the emails do not contain the answer, "
                "set is_grounded=False (this signals missing context so a re-query can be attempted).\n"
                "2. If the answer contains any factual claims not backed by the context excerpts, set is_grounded=False.\n"
                "3. If and only if all claims made in the answer are supported by the excerpts, set is_grounded=True."
            ),
        ),
        (
            "human",
            (
                "--- EMAIL CONTEXT ---\n{context}\n\n"
                "--- ORIGINAL QUESTION ---\n{question}\n\n"
                "--- GENERATED ANSWER ---\n{answer}\n\n"
                "Evaluate grounding:"
            ),
        ),
    ])

    eval_chain = check_prompt | evaluator
    context = format_docs(state.get("documents", []))

    logger.info("Evaluating answer groundedness...")
    try:
        evaluator = llm.with_structured_output(GroundednessCheck)
        eval_chain = check_prompt | evaluator
        eval_result: GroundednessCheck = eval_chain.invoke({
            "context": context,
            "question": state["question"],
            "answer": state["answer"],
        })
        is_grounded = bool(getattr(eval_result, "is_grounded", True))
        reasoning = getattr(eval_result, "reasoning", "Verified")
    except Exception as exc:
        logger.warning("Structured groundedness check encountered error (%s), using heuristic validation", exc)
        ans_lower = state.get("answer", "").lower()
        if any(neg in ans_lower for neg in ["not found", "no information", "unable to find", "no emails"]):
            is_grounded = False
            reasoning = "Negative indicator detected in answer"
        else:
            is_grounded = True
            reasoning = "Fallback heuristic pass"

    logger.info("Groundedness result: is_grounded=%s, reasoning=%s", is_grounded, reasoning)
    return {"is_grounded": is_grounded}


def rewrite_query(state: GraphState) -> dict:
    """Reformulate the search query to retrieve missing context on retry."""
    llm = get_chat_model(temperature=0)
    rewrite_prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            (
                "You are an expert search query optimizer for an email assistant. "
                "The previous search query did not retrieve enough relevant email excerpts to answer the question.\n"
                "Generate an expanded or alternative search query with relevant synonyms/keywords "
                "to retrieve the necessary emails from a vector store.\n"
                "Output ONLY the revised query string, with no quotes, formatting, or commentary."
            ),
        ),
        (
            "human",
            (
                "Original Question: {question}\n"
                "Previous Query: {current_query}\n"
                "Attempted Answer: {answer}\n\n"
                "Revised Query:"
            ),
        ),
    ])

    rewrite_chain = rewrite_prompt | llm | StrOutputParser()
    new_query = rewrite_chain.invoke({
        "question": state["question"],
        "current_query": state.get("current_query", state["question"]),
        "answer": state.get("answer", ""),
    }).strip()

    logger.info(
        "Rewriting query from '%s' to '%s' (retry %d -> %d)",
        state.get("current_query"),
        new_query,
        state.get("retry_count", 0),
        state.get("retry_count", 0) + 1,
    )

    return {
        "current_query": new_query,
        "retry_count": state.get("retry_count", 0) + 1,
    }


def fallback_answer(state: GraphState) -> dict:
    """Return a safe refusal when emails do not contain enough info, with empty sources list."""
    logger.info("Routing to fallback refusal; setting empty sources.")
    return {
        "answer": "I couldn't find enough information in your emails to answer this question accurately.",
        "sources": [],
    }


# ─── Routing Logic ────────────────────────────────────────────────────────────

def should_continue(state: GraphState) -> str:
    """Decide next node based on groundedness and bounded retry count."""
    if state.get("is_grounded", False):
        return "end"

    # Retry bounded to max 1 attempt
    if state.get("retry_count", 0) < 1:
        return "retry"

    return "fallback"


# ─── Graph Construction ───────────────────────────────────────────────────────

def build_graph():
    """Assemble and compile the Phase 4 LangGraph StateGraph."""
    workflow = StateGraph(GraphState)

    # Register nodes
    workflow.add_node("retrieve_emails", retrieve_emails)
    workflow.add_node("generate_answer", generate_answer)
    workflow.add_node("self_check", self_check)
    workflow.add_node("rewrite_query", rewrite_query)
    workflow.add_node("fallback_answer", fallback_answer)

    # Edges
    workflow.add_edge(START, "retrieve_emails")
    workflow.add_edge("retrieve_emails", "generate_answer")
    workflow.add_edge("generate_answer", "self_check")

    workflow.add_conditional_edges(
        "self_check",
        should_continue,
        {
            "end": END,
            "retry": "rewrite_query",
            "fallback": "fallback_answer",
        },
    )

    workflow.add_edge("rewrite_query", "retrieve_emails")
    workflow.add_edge("fallback_answer", END)

    return workflow.compile()


# Compile once as module singleton
agent_app = build_graph()


# ─── Execution Runner ─────────────────────────────────────────────────────────

def _filter_cited_sources(answer: str, sources: list[dict]) -> list[dict]:
    """Filter sources list to only include emails actually cited or discussed in the answer."""
    import re
    if not sources or not answer:
        return []

    # If it's a refusal answer, return empty sources
    ans_lower = answer.lower()
    if "couldn't find that information" in ans_lower or "not enough information" in ans_lower:
        return []

    # Extract bolded entities from answer (e.g. company names, job titles, senders)
    bolded = [b.lower().strip() for b in re.findall(r"\*\*([^*]+)\*\*", answer)]
    meta_headers = {
        "company:", "company", "date:", "date", "job title:", "status:",
        "rejections by date:", "rejections:", "job rejections:", "category:",
        "sender:", "subject:", "position:"
    }
    entities = [e for e in bolded if e not in meta_headers and len(e) > 2]

    relevant = []
    for s in sources:
        subj = (s.get("subject") or "").lower()
        snd = (s.get("sender") or "").lower()
        combined = f"{subj} {snd}"
        snd_clean = snd.split("<")[0].strip() if "<" in snd else snd

        is_matched = False
        # 1. Match against extracted bold entities from the answer
        if any(e in combined for e in entities):
            is_matched = True
        # 2. Match if clean sender name is in answer
        elif snd_clean and len(snd_clean) > 2 and snd_clean in ans_lower:
            is_matched = True
        # 3. Match distinct company or subject keywords
        else:
            for w in snd_clean.split():
                if len(w) > 3 and w in ans_lower:
                    is_matched = True
                    break

        if is_matched:
            relevant.append(s)

    return relevant if relevant else sources[:5]


def run_agent(question: str, user_email: Optional[str] = None) -> dict:
    """
    Execute the LangGraph agent workflow for a user question.

    Args:
        question: User's natural language question.
        user_email: Optional Gmail account filter for isolation.

    Returns:
        dict: {"answer": str, "sources": list[dict]}
    """
    # Ensure LLM key is configured before starting graph
    get_chat_model()

    initial_state: GraphState = {
        "question": question,
        "user_email": user_email,
        "current_query": question,  # Explicitly initialized to original question
        "documents": [],
        "answer": "",
        "sources": [],
        "is_grounded": False,
        "retry_count": 0,
    }

    logger.info("Starting LangGraph agent execution for question: '%s'", question)
    final_state = agent_app.invoke(initial_state)

    raw_answer = final_state.get("answer", "")
    raw_sources = final_state.get("sources", [])
    filtered_sources = _filter_cited_sources(raw_answer, raw_sources)

    return {
        "answer": raw_answer,
        "sources": filtered_sources,
    }
