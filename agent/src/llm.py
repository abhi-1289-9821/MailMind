"""
llm.py — Multi-Provider Model Factory for MailMind.

Architecture:
LLM (ModelFactory)
├── Gemini       (Google AI Studio / langchain-google-genai)
├── Groq         (Ultra-low latency Llama-3 / langchain-groq)
└── OpenRouter   (Universal multi-model gateway / langchain-openai)
"""

import logging
import os
from enum import Enum
from typing import Optional

from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)


class Provider(str, Enum):
    GEMINI = "gemini"
    GROQ = "groq"
    OPENROUTER = "openrouter"
    OPENAI = "openai"


class LLMFactory:
    """Model factory providing instantiated chat models for Gemini, Groq, and OpenRouter."""

    @staticmethod
    def create_gemini(temperature: float = 0.0) -> BaseChatModel:
        gemini_key = (
            os.environ.get("GEMINI_API_KEY", "").strip()
            or os.environ.get("GOOGLE_API_KEY", "").strip()
        )
        if not gemini_key:
            raise ValueError("GEMINI_API_KEY is not configured.")

        from langchain_google_genai import ChatGoogleGenerativeAI

        # Default to production gemini-3.6-flash or gemini-flash-latest
        model_name = os.environ.get("GEMINI_MODEL", "").strip()
        if not model_name or model_name == "gemini-3.5-flash":
            model_name = "gemini-3.6-flash"

        logger.info("[LLMFactory] Initializing Gemini: model=%s", model_name)
        return ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=gemini_key,
            temperature=temperature,
        )

    @staticmethod
    def create_groq(temperature: float = 0.0) -> BaseChatModel:
        groq_key = os.environ.get("GROQ_API_KEY", "").strip()
        if not groq_key:
            raise ValueError("GROQ_API_KEY is not configured.")

        model_name = os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b").strip()
        logger.info("[LLMFactory] Initializing Groq: model=%s", model_name)

        try:
            from langchain_groq import ChatGroq

            return ChatGroq(
                model=model_name,
                api_key=groq_key,
                temperature=temperature,
            )
        except ImportError:
            from langchain_openai import ChatOpenAI

            return ChatOpenAI(
                base_url="https://api.groq.com/openai/v1",
                api_key=groq_key,
                model=model_name,
                temperature=temperature,
            )

    @staticmethod
    def create_openrouter(temperature: float = 0.0) -> BaseChatModel:
        openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not openrouter_key:
            raise ValueError("OPENROUTER_API_KEY is not configured.")

        model_name = os.environ.get(
            "OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free"
        ).strip()
        logger.info("[LLMFactory] Initializing OpenRouter: model=%s", model_name)

        # Safeguard against Windows Application Control blocking _tiktoken.pyd
        import sys
        from unittest.mock import MagicMock
        try:
            import tiktoken
        except Exception:
            sys.modules["tiktoken"] = MagicMock()
            sys.modules["_tiktoken"] = MagicMock()

        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=openrouter_key,
            model=model_name,
            temperature=temperature,
            default_headers={
                "HTTP-Referer": "https://github.com/abhi-1289-9821/MailMind",
                "X-Title": "MailMind",
            },
        )

    @staticmethod
    def create_openai(temperature: float = 0.0) -> BaseChatModel:
        openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not openai_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        model_name = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip()
        logger.info("[LLMFactory] Initializing OpenAI: model=%s", model_name)

        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model_name,
            api_key=openai_key,
            temperature=temperature,
        )

    @classmethod
    def get_chat_model(
        cls,
        provider: Optional[str] = None,
        temperature: float = 0.0,
    ) -> BaseChatModel:
        """
        Factory method to return a configured chat model.

        Resolution order:
        1. Explicit 'provider' parameter ('gemini', 'groq', 'openrouter', 'openai').
        2. 'LLM_PROVIDER' environment variable.
        3. Automatic detection based on available API keys:
           Gemini -> Groq -> OpenRouter -> OpenAI.
        """
        chosen = (provider or os.environ.get("LLM_PROVIDER", "")).strip().lower()

        if chosen == Provider.GEMINI:
            return cls.create_gemini(temperature)
        if chosen == Provider.GROQ:
            return cls.create_groq(temperature)
        if chosen == Provider.OPENROUTER:
            return cls.create_openrouter(temperature)
        if chosen == Provider.OPENAI:
            return cls.create_openai(temperature)

        # Auto-detect mode
        errors = []
        if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            try:
                return cls.create_gemini(temperature)
            except Exception as e:
                errors.append(f"Gemini: {e}")

        if os.environ.get("GROQ_API_KEY"):
            try:
                return cls.create_groq(temperature)
            except Exception as e:
                errors.append(f"Groq: {e}")

        if os.environ.get("OPENROUTER_API_KEY"):
            try:
                return cls.create_openrouter(temperature)
            except Exception as e:
                errors.append(f"OpenRouter: {e}")

        if os.environ.get("OPENAI_API_KEY"):
            try:
                return cls.create_openai(temperature)
            except Exception as e:
                errors.append(f"OpenAI: {e}")

        raise ValueError(
            "No valid LLM provider configured! Please set one of the following in agent/.env:\n"
            "  - GEMINI_API_KEY (Free at https://aistudio.google.com/app/apikey)\n"
            "  - GROQ_API_KEY (Free at https://console.groq.com/keys)\n"
            "  - OPENROUTER_API_KEY (Free/Paid at https://openrouter.ai/keys)\n"
            f"Encountered errors: {errors}"
        )


# Backward-compatible function alias matching original signature
def get_chat_model(
    temperature: float = 0.0,
    provider: Optional[str] = None,
) -> BaseChatModel:
    return LLMFactory.get_chat_model(provider=provider, temperature=temperature)
