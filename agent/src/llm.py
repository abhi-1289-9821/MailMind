"""
llm.py — Factory for the chat model (defaults to Google Gemini free tier).
Supports GEMINI_API_KEY (or GOOGLE_API_KEY) with model "gemini-2.0-flash" (or "gemini-1.5-flash").
Can fall back to OpenAI if OPENAI_API_KEY is supplied.
"""

import os
import logging
from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)


def get_chat_model(temperature: float = 0.0) -> BaseChatModel:
    """
    Returns an instantiated chat model.
    Prioritizes GEMINI_API_KEY (Google Gemini free tier).
    Falls back to OPENAI_API_KEY if Gemini is not set.
    """
    gemini_key = (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )
    if gemini_key:
        from langchain_google_genai import ChatGoogleGenerativeAI
        gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
        logger.info("Using Google Gemini model: %s", gemini_model)
        return ChatGoogleGenerativeAI(
            model=gemini_model,
            google_api_key=gemini_key,
            temperature=temperature,
        )

    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if openai_key:
        from langchain_openai import ChatOpenAI
        openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        logger.info("Using OpenAI model: %s", openai_model)
        return ChatOpenAI(
            model=openai_model,
            api_key=openai_key,
            temperature=temperature,
        )

    raise ValueError(
        "No LLM API key configured! Please set GEMINI_API_KEY in agent/.env. "
        "You can get a 100% free key with no credit card at: https://aistudio.google.com/app/apikey"
    )
