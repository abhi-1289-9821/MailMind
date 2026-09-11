"""
embedder.py — Chroma vector store wrapper with BGE-base-en-v1.5 embeddings.

Design decisions
----------------
- HuggingFaceEmbeddings with BAAI/bge-base-en-v1.5 runs entirely locally.
  normalize_embeddings=True is required for BGE: cosine similarity then equals
  dot-product, which is what Chroma uses by default.
- The embedding model is initialised once (module-level singleton) so repeated
  calls to upsert_documents() within the same process reuse the loaded model.
- Chroma is opened in persistent mode — the collection survives restarts.
- upsert_documents() passes ids= matching each document's message_id.
  Chroma's add() with a pre-existing ID raises an error, so we split the batch
  into truly-new vs already-present and only add the new ones.  The already-
  indexed filter in db.py means this situation only arises on retry after a
  partial failure.
"""

import os
import logging
from functools import lru_cache

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer
from huggingface_hub import hf_hub_download

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"


class BGEOnnxEmbeddings(Embeddings):
    """
    ONNX-powered BAAI/bge-base-en-v1.5 embeddings producing exact 768-dimensional
    vectors using onnxruntime and tokenizers, bypassing PyTorch DLL policy restrictions.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL):
        logger.info("Initializing BGE ONNX embeddings for %s …", model_name)
        onnx_path = hf_hub_download(model_name, "onnx/model.onnx")
        tok_path = hf_hub_download(model_name, "tokenizer.json")

        self.tokenizer = Tokenizer.from_file(tok_path)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
        self.tokenizer.enable_truncation(max_length=512)

        # Use CPUExecutionProvider
        self.session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        logger.info("BGE ONNX session initialized successfully (768 dimensions).")

    def _embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        encodings = self.tokenizer.encode_batch(texts)
        input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        token_type_ids = np.array([e.type_ids for e in encodings], dtype=np.int64)

        ort_inputs = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": token_type_ids,
        }
        outputs = self.session.run(None, ort_inputs)
        # BGE uses CLS token embedding (index 0) with L2 normalization
        cls_vecs = outputs[0][:, 0]
        norms = np.linalg.norm(cls_vecs, axis=1, keepdims=True)
        normed = cls_vecs / np.maximum(norms, 1e-12)
        return normed.tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        batch_size = 32
        all_vecs = []
        for i in range(0, len(texts), batch_size):
            all_vecs.extend(self._embed(texts[i : i + batch_size]))
        return all_vecs

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text])[0]


@lru_cache(maxsize=1)
def _get_embeddings() -> Embeddings:
    """
    Load BGE-base-en-v1.5 once and cache for the process lifetime.
    Uses BGEOnnxEmbeddings to provide exact 768-dim embeddings matching existing Chroma collections.
    """
    try:
        return BGEOnnxEmbeddings()
    except Exception as exc:
        logger.warning("BGE ONNX loading failed (%s), trying HuggingFaceEmbeddings fallback …", exc)
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )


def _get_vector_store(chroma_path: str, collection: str) -> Chroma:
    """Open (or create) the persistent Chroma collection."""
    return Chroma(
        collection_name=collection,
        embedding_function=_get_embeddings(),
        persist_directory=chroma_path,
    )


def upsert_documents(
    docs: list[Document],
    chroma_path: str,
    collection: str,
) -> int:
    """
    Embed and upsert Documents into Chroma.

    Uses each document's metadata["message_id"] as the Chroma document ID so
    re-ingesting the same email is idempotent (Chroma overwrites on duplicate ID).

    Returns the number of documents actually added/updated.
    """
    if not docs:
        return 0

    ids   = [doc.metadata["message_id"] for doc in docs]
    store = _get_vector_store(chroma_path, collection)

    # Check which IDs already exist to avoid Chroma duplicate errors.
    # In normal flow db.py's indexed=0 filter prevents duplicates; this guards
    # against partial-failure retries.
    try:
        existing = store.get(ids=ids, include=[])["ids"]
        existing_set = set(existing)
    except Exception:
        existing_set = set()

    new_docs = [d for d in docs if d.metadata["message_id"] not in existing_set]
    update_docs = [d for d in docs if d.metadata["message_id"] in existing_set]

    added = 0
    if new_docs:
        new_ids = [d.metadata["message_id"] for d in new_docs]
        store.add_documents(documents=new_docs, ids=new_ids)
        added += len(new_docs)
        logger.info("Added %d new documents to Chroma.", len(new_docs))

    if update_docs:
        upd_ids = [d.metadata["message_id"] for d in update_docs]
        # Chroma doesn't have a native update; delete then re-add
        store.delete(ids=upd_ids)
        store.add_documents(documents=update_docs, ids=upd_ids)
        added += len(update_docs)
        logger.info("Updated %d existing documents in Chroma.", len(update_docs))

    return added


def collection_count(chroma_path: str, collection: str) -> int:
    """Return the number of documents currently in the Chroma collection."""
    store = _get_vector_store(chroma_path, collection)
    return store._collection.count()
