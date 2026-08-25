"""
models.py — Schémas Pydantic (compatible Ollama — modèle libre)
"""

from pydantic import BaseModel, Field, field_validator
from typing import Literal, Optional, Any


class Message(BaseModel):
    role:    Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1, max_length=32_000)


class ChatRequest(BaseModel):
    messages:        list[Message] = Field(..., min_length=1)
    # ← str libre : accepte n'importe quel modèle Ollama (deepseek-v3.2:cloud, llama3, etc.)
    model:           str           = Field(default="qwen2.5:3b")
    temperature:     float         = Field(default=0.7, ge=0.0, le=1.0)
    max_tokens:      int           = Field(default=2048, ge=1, le=32_000)
    stream:          bool          = False
    use_rag:         bool          = True
    conversation_id: Optional[str] = Field(default=None)

    @field_validator("conversation_id", mode="before")
    @classmethod
    def coerce_conv_id(cls, v: Any) -> Optional[str]:
        if v is None or v == "" or v == "null":
            return None
        return str(v)

    @field_validator("model", mode="before")
    @classmethod
    def coerce_model(cls, v: Any) -> str:
        """Accepte n'importe quelle string — jamais de rejet pour le nom du modèle."""
        if not v or str(v).strip() == "":
            return "deepseek-r1:7b"
        return str(v).strip()

    @field_validator("messages")
    @classmethod
    def at_least_one_user_message(cls, messages):
        if not any(m.role == "user" for m in messages):
            raise ValueError("La conversation doit contenir au moins un message utilisateur.")
        return messages


class UsageInfo(BaseModel):
    prompt_tokens:     int
    completion_tokens: int
    total_tokens:      int


class ChatResponse(BaseModel):
    content:         str
    model:           str
    conversation_id: Optional[str]        = None
    usage:           Optional[UsageInfo]  = None
    finish_reason:   Optional[str]        = None
    sources:         Optional[list[dict]] = None


class ConversationOut(BaseModel):
    id:         str
    title:      str
    model:      str
    created_at: str
    updated_at: str


class MessageOut(BaseModel):
    id:         str
    role:       str
    content:    str
    sources:    list[dict]
    created_at: str


class HealthResponse(BaseModel):
    status:  Literal["ok", "error"]
    message: str


class ModelsResponse(BaseModel):
    models: list[str]


class RAGStatus(BaseModel):
    ready:       bool
    chunk_count: int
    message:     str