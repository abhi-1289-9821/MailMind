"""
retriever.py — Chroma similarity-search wrapper.

Returns a LangChain VectorStoreRetriever that:
  - uses the BGE-base-en-v1.5 singleton from embedder.py (no redundant model load)
  - filters by user_email metadata when provided, enforcing data boundaries
    between accounts even though today's project is single-user

The filter is stored in every document's metadata by Phase 2's chunker.py, so
it is always valid. Skipping it would work for a single account but would break
the data contract if a second account is ever added.
"""

import os
from langchain_chroma import Chroma
from .embedder import _get_embeddings


def get_retriever(
    chroma_path: str,
    collection: str,
    k: int = 5,
    user_email: str | None = None,
):
    """
    Build a retriever over the Chroma collection.

    Args:
        chroma_path:  Path to the persistent Chroma directory.
        collection:   Chroma collection name (must match Phase 2).
        k:            Number of chunks to retrieve per query.
        user_email:   When provided, restricts retrieval to documents whose
                      metadata["user_email"] matches — enforces account isolation.

    Returns:
        A LangChain VectorStoreRetriever ready to plug into an LCEL chain.
    """
    store = Chroma(
        collection_name=collection,
        embedding_function=_get_embeddings(),  # BGE singleton — no extra load
        persist_directory=chroma_path,
    )

    search_kwargs: dict = {"k": k}
    if user_email:
        # Chroma metadata filter — only retrieve docs owned by this account
        search_kwargs["filter"] = {"user_email": user_email}

    return store.as_retriever(
        search_type="similarity",
        search_kwargs=search_kwargs,
    )
