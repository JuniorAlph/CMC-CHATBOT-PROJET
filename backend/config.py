"""
config.py — Configuration (mode hors ligne + AnythingLLM)
"""

import os
from dotenv import load_dotenv

os.environ.setdefault("HF_HUB_OFFLINE",      "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_DATASETS_OFFLINE",  "1")

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)


def _clean(value: str | None) -> str:
    if not value:
        return ""
    return value.strip().strip("\r\n").strip('"').strip("'").lstrip("\ufeff")


class Settings:
    def __init__(self):
        # Ollama (gardé pour health check)
        self.ollama_base_url = _clean(os.getenv("OLLAMA_BASE_URL")) or "http://localhost:11434"
        self.ollama_api_key  = _clean(os.getenv("OLLAMA_API_KEY")) or "ollama"
        self.default_model   = _clean(os.getenv("DEFAULT_MODEL")) or "qwen3-vl:2b-instruct-q8_0"

        # AnythingLLM — noms d'attributs canoniques utilisés partout
        self.anything_llm_base      = _clean(os.getenv("ANYTHINGLLM_URL")) or "http://localhost:3001"
        self.anything_llm_api       = _clean(os.getenv("ANYTHINGLLM_KEY")) or ""
        self.anything_llm_workspace = _clean(os.getenv("ANYTHINGLLM_WORKSPACE")) or "mon-espace-de-travail"

        # CORS
        self.allowed_origins = _clean(os.getenv("ALLOWED_ORIGINS")) or (
            "http://localhost:8000,http://127.0.0.1:8000,"
            "http://localhost:5500,http://127.0.0.1:5500"
        )

        # MongoDB
        self.mongodb_uri = _clean(os.getenv("MONGO_URI")) or "mongodb://127.0.0.1:27017"
        self.mongodb_db  = _clean(os.getenv("MONGO_DB")) or "cmc_chatbot"

    @property
    def origins_list(self) -> list:
        return [o.strip() for o in self.allowed_origins.split(",")]


def get_settings() -> Settings:
    return Settings()