"""
CMCBOT.py — Client AnythingLLM
Remplace l'appel direct à Ollama + RAG manuel.
AnythingLLM gère en interne : embeddings, recherche vectorielle, contexte RAG.
Vos routes FastAPI restent identiques.
"""

import json
import httpx
from typing import AsyncIterator
from fastapi import HTTPException

from backend.config import get_settings
from backend.models import ChatRequest, ChatResponse


API_ERROR_MESSAGES: dict[int, str] = {
    400: "Requête invalide.",
    401: "Clé API AnythingLLM invalide — vérifiez ANYTHINGLLM_KEY dans .env",
    403: "Accès refusé — vérifiez la clé API et le workspace.",
    404: "Workspace introuvable — vérifiez ANYTHINGLLM_WORKSPACE dans .env",
    429: "Trop de requêtes.",
    500: "Erreur interne AnythingLLM.",
    503: "AnythingLLM inaccessible — est-il démarré sur le port 3000 ?",
}


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    try:
        data = response.json()
        detail = data.get("message") or data.get("error") or ""
    except Exception:
        detail = ""
    raise HTTPException(
        status_code=response.status_code,
        detail=detail or API_ERROR_MESSAGES.get(response.status_code)
                      or f"Erreur HTTP {response.status_code}",
    )


class CMC_Client:
    """
    Client HTTP async vers AnythingLLM.
    Endpoints utilisés :
      POST /api/v1/workspace/{slug}/chat          ← réponse complète
      POST /api/v1/workspace/{slug}/stream-chat   ← streaming SSE
      GET  /api/v1/auth                           ← health check
      GET  /api/v1/workspaces                     ← liste workspaces / modèles
    """

    def __init__(self):
        s = get_settings()
        # Nettoie l'URL : retire un éventuel /api/v1 déjà présent
        base = s.anything_llm_base.rstrip("/")
        if base.endswith("/api/v1"):
            base = base[: -len("/api/v1")]
        self._base_url = base
        self._api_key  = s.anything_llm_api
        self._workspace = s.anything_llm_workspace
        self._client: httpx.AsyncClient | None = None

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self._api_key:
            h["Authorization"] = f"Bearer {self._api_key}"
        return h

    async def open(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=5.0),
        )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Réponse complète ─────────────────────────────────────────

    async def chat(self, request: ChatRequest, context: str = "") -> ChatResponse:
        """
        Envoie le dernier message à AnythingLLM.
        AnythingLLM gère lui-même le RAG sur vos PDFs.
        Le paramètre context est ignoré (AnythingLLM le produit en interne).
        """
        # Récupère uniquement le dernier message utilisateur
        user_messages = [m for m in request.messages if m.role == "user"]
        last_question = user_messages[-1].content if user_messages else ""

        payload = {
            "message": last_question,
            "mode":    "chat",          # "chat" = avec historique workspace
        }

        response = await self._client.post(
            f"/api/v1/workspace/{self._workspace}/chat",
            json=payload,
        )
        _raise_for_status(response)

        data = response.json()

        # AnythingLLM retourne : { "textResponse": "...", "sources": [...], ... }
        content = self._extract_content(data)
        sources = self._extract_sources(data.get("sources", []))

        return ChatResponse(
            content=content,
            model=data.get("model") or request.model,
            sources=sources if sources else None,
        )

    # ── Streaming SSE ─────────────────────────────────────────────

    async def chat_stream(self, request: ChatRequest, context: str = "") -> AsyncIterator[str]:
        """
        Streaming via l'endpoint stream-chat d'AnythingLLM.
        Retourne les tokens au fur et à mesure en format SSE.
        """
        user_messages = [m for m in request.messages if m.role == "user"]
        last_question = user_messages[-1].content if user_messages else ""

        payload = {
            "message": last_question,
            "mode":    "chat",
        }

        prev_text = ""
        try:
            stream_headers = {**self._headers(), "Accept": "text/event-stream"}
            async with self._client.stream(
                "POST",
                f"/api/v1/workspace/{self._workspace}/stream-chat",
                json=payload,
                headers=stream_headers,
            ) as response:
                _raise_for_status(response)

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue

                    # AnythingLLM stream : "data: {...}"
                    if line.startswith("data: "):
                        raw = line[6:]
                        if raw == "[DONE]":
                            break
                        try:
                            chunk = json.loads(raw)

                            if chunk.get("type") == "abort" or chunk.get("error"):
                                err = chunk.get("error") or "Réponse interrompue."
                                yield f"data: {json.dumps({'error': err})}\n\n"
                                break

                            # Token de texte — AnythingLLM peut envoyer incrémental ou cumulatif
                            text = self._extract_content(chunk)
                            if text:
                                if text.startswith(prev_text) and len(text) > len(prev_text):
                                    delta = text[len(prev_text):]
                                    prev_text = text
                                elif text == prev_text:
                                    delta = ""
                                else:
                                    delta = text
                                    prev_text += text
                                if delta:
                                    yield f"data: {json.dumps({'delta': delta})}\n\n"

                            # Fin du stream avec sources
                            if chunk.get("close") or chunk.get("type") == "finalizeResponseStream":
                                final_text = self._extract_content(chunk)
                                if final_text and final_text.startswith(prev_text) and len(final_text) > len(prev_text):
                                    delta = final_text[len(prev_text):]
                                    prev_text = final_text
                                    if delta:
                                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                                sources = self._extract_sources(chunk.get("sources", []))
                                if sources:
                                    yield f"data: {json.dumps({'sources': sources})}\n\n"
                                break

                        except (json.JSONDecodeError, KeyError):
                            continue

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

        finally:
            yield "data: [DONE]\n\n"

    # ── Contenu & sources ─────────────────────────────────────────

    def _extract_content(self, data: dict) -> str:
        """Extrait le texte de réponse depuis les différents formats AnythingLLM."""
        if not isinstance(data, dict):
            return ""
        for key in ("textResponse", "text", "response", "message", "responseText"):
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                return val
        nested = data.get("response")
        if isinstance(nested, dict):
            for key in ("text", "textResponse", "message"):
                val = nested.get(key)
                if isinstance(val, str) and val.strip():
                    return val
        return ""

    def _extract_sources(self, raw_sources: list) -> list[dict]:
        """Formate les sources AnythingLLM pour le frontend."""
        sources = []
        for s in raw_sources:
            sources.append({
                "title": s.get("title") or s.get("name") or "Document",
                "url":   s.get("url")   or s.get("source") or "#",
                "score": round(float(s.get("score") or s.get("similarity") or 0), 3),
            })
        return sources

    # ── Health & modèles ─────────────────────────────────────────

    async def health_check(self) -> bool:
        """Vérifie qu'AnythingLLM est accessible et la clé valide."""
        try:
            resp = await self._client.get("/api/v1/auth", timeout=5.0)
            return resp.is_success
        except Exception:
            return False

    async def list_models(self) -> list[str]:
        """Retourne les workspaces disponibles comme 'modèles'."""
        try:
            resp = await self._client.get("/api/v1/workspaces", timeout=5.0)
            if resp.is_success:
                data = resp.json()
                workspaces = data.get("workspaces", [])
                return [w.get("slug") or w.get("name") for w in workspaces if w]
        except Exception:
            pass
        return [self._workspace]


# Instance globale
CMC_USER = CMC_Client()