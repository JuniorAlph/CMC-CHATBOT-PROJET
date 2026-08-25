"""
main.py — FastAPI avec AnythingLLM + MongoDB
Toutes vos routes sont conservées identiques.
Lancement : uvicorn main:app --reload --port 8000
"""

import os, json, uuid, time, asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import httpx

from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings
from backend.metrics import metrics_collector, MessageMetrics, ResponseTimer, estimate_tokens
from backend.CMCBOT import CMC_USER
from backend.Database import db
from backend.models import (
    ChatRequest, ChatResponse,
    ConversationOut, MessageOut,
    HealthResponse, ModelsResponse, RAGStatus,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    print("\n" + "=" * 55)
    print("  CMC Chatbot — AnythingLLM + MongoDB")
    print("=" * 55)
    print(f"  AnythingLLM : {s.anything_llm_base}")
    print(f"  Workspace   : {s.anything_llm_workspace}")

    await db.connect()
    await CMC_USER.open()

    # Vérifie la connexion AnythingLLM via le client déjà ouvert (utilise /api/v1/auth)
    ok = await CMC_USER.health_check()

    print(f"  AnythingLLM : {'✅ connecté' if ok else '❌ inaccessible — est-il démarré ?'}")
    print(f"  MongoDB     : {'✅ connecté' if db.is_connected else '❌ inaccessible'}")
    print("=" * 55 + "\n")

    yield

    await CMC_USER.close()
    await db.disconnect()


settings = get_settings()

app = FastAPI(
    title="CMC Chatbot — AnythingLLM + MongoDB",
    version="5.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[ERROR] {request.url.path} → {type(exc).__name__}: {exc}")
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ── Système ──────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    ok = await CMC_USER.health_check()
    return HealthResponse(
        status="ok" if ok else "error",
        message="AnythingLLM opérationnel." if ok
                else f"AnythingLLM inaccessible sur {settings.anything_llm_base}",
    )

@app.get("/rag/status", response_model=RAGStatus)
async def rag_status():
    """RAG géré par AnythingLLM — toujours prêt si AnythingLLM est connecté."""
    ok = await CMC_USER.health_check()
    return RAGStatus(
        ready=ok,
        chunk_count=0,   # AnythingLLM gère en interne
        message="RAG géré par AnythingLLM" if ok else "AnythingLLM inaccessible",
    )

@app.post("/rag/reindex")
async def reindex():
    """Avec AnythingLLM, la réindexation se fait via son interface web."""
    return {
        "status":  "info",
        "message": f"Gérez vos documents directement dans AnythingLLM : {settings.anything_llm_base}",
    }

@app.get("/models", response_model=ModelsResponse)
async def list_models():
    """Retourne les workspaces AnythingLLM disponibles."""
    return ModelsResponse(models=await CMC_USER.list_models())


# ── Métriques ─────────────────────────────────────────────────────

@app.get("/metrics")
async def get_metrics():
    """Résumé des métriques de performance du chatbot."""
    return metrics_collector.summary()

@app.get("/metrics/history")
async def get_metrics_history(limit: int = 50):
    """Historique des N dernières métriques individuelles."""
    return metrics_collector.history(limit=min(limit, 200))


# ── Conversations (MongoDB) ───────────────────────────────────────

@app.get("/conversations")
async def list_conversations():
    if not db.is_connected:
        return []
    try:
        return await db.list_conversations(limit=100)
    except Exception as e:
        print(f"[MongoDB] {e}")
        return []

@app.get("/conversations/{conversation_id}/messages")
async def get_messages(conversation_id: str):
    if not db.is_connected:
        return JSONResponse(status_code=503, content={"detail": "MongoDB non disponible"})
    try:
        return await db.get_messages(conversation_id)
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    if not db.is_connected:
        return JSONResponse(status_code=503, content={"detail": "MongoDB non disponible"})
    try:
        ok = await db.delete_conversation(conversation_id)
        return {"status": "deleted"} if ok else JSONResponse(
            status_code=404, content={"detail": "Conversation introuvable"}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


# ── Chat ──────────────────────────────────────────────────────────

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if request.stream:
        return JSONResponse(status_code=400, content={"detail": "Utilisez /chat/stream"})

    timer    = ResponseTimer()
    response = await CMC_USER.chat(request)
    elapsed  = timer.elapsed_ms

    # Enregistrement métriques
    user_msgs_for_metric = [m for m in request.messages if m.role == "user"]
    last_q_metric = user_msgs_for_metric[-1].content if user_msgs_for_metric else ""
    sources_metric = response.sources or []
    est_tokens = estimate_tokens(response.content)
    metrics_collector.record(MessageMetrics(
        id=str(uuid.uuid4())[:8],
        timestamp=datetime.now(timezone.utc).isoformat(),
        question=last_q_metric[:120],
        response_length=len(response.content),
        response_time_ms=elapsed,
        ttfb_ms=elapsed,
        tokens_estimated=est_tokens,
        tokens_per_second=round(est_tokens / max(elapsed/1000, 0.001), 1),
        rag_chunks_used=len(sources_metric),
        rag_score_max=max((s.get("score",0) for s in sources_metric), default=0),
        rag_score_avg=sum(s.get("score",0) for s in sources_metric)/max(len(sources_metric),1),
        model=settings.anything_llm_workspace,
        workspace=settings.anything_llm_workspace,
        success=True,
        streaming=False,
    ))

    # Sauvegarde MongoDB
    if db.is_connected:
        try:
            user_messages = [m for m in request.messages if m.role == "user"]
            last_question = user_messages[-1].content if user_messages else ""
            conv_id = request.conversation_id
            if not conv_id:
                conv_id = await db.create_conversation(
                    title=last_question[:80] or "Nouvelle conversation",
                    model=settings.anything_llm_workspace,
                )
                for m in request.messages[:-1]:
                    await db.add_message(conv_id, m.role, m.content)
            await db.add_message(conv_id, "user", last_question)
            await db.add_message(conv_id, "assistant", response.content,
                                 response.sources or [])
            response.conversation_id = conv_id
        except Exception as e:
            print(f"[MongoDB] {e}")

    return response


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    user_messages = [m for m in request.messages if m.role == "user"]
    last_question = user_messages[-1].content if user_messages else ""

    conv_id = request.conversation_id
    if db.is_connected and not conv_id:
        try:
            conv_id = await db.create_conversation(
                title=last_question[:80] or "Nouvelle conversation",
                model=settings.anything_llm_workspace,
            )
        except Exception as e:
            print(f"[MongoDB] {e}")

    async def _save_messages(text: str, src: list) -> None:
        if not db.is_connected or not conv_id:
            return
        try:
            await db.add_message(conv_id, "user", last_question)
            await db.add_message(conv_id, "assistant", text, src)
        except Exception as e:
            print(f"[MongoDB] {e}")

    async def stream_and_save():
        full_text = ""
        sources   = []
        timer     = ResponseTimer()
        success   = True
        error_msg = None

        if conv_id:
            yield f"data: {json.dumps({'conversation_id': conv_id})}\n\n"

        try:
            async for chunk in CMC_USER.chat_stream(request):
                if chunk.startswith("data: {"):
                    try:
                        data = json.loads(chunk[6:])
                        if data.get("error"):
                            success   = False
                            error_msg = data["error"]
                        elif data.get("delta"):
                            timer.mark_first_byte()
                            full_text += data["delta"]
                        if data.get("sources"):
                            sources = data["sources"]
                    except Exception:
                        pass
                yield chunk
        except Exception as exc:
            success   = False
            error_msg = str(exc)
            raise
        finally:
            elapsed    = timer.elapsed_ms
            est_tokens = estimate_tokens(full_text) if full_text else 0
            metrics_collector.record(MessageMetrics(
                id=str(uuid.uuid4())[:8],
                timestamp=datetime.now(timezone.utc).isoformat(),
                question=last_question[:120],
                response_length=len(full_text),
                response_time_ms=elapsed,
                ttfb_ms=timer.ttfb_ms or elapsed,
                tokens_estimated=est_tokens,
                tokens_per_second=round(est_tokens / max(elapsed / 1000, 0.001), 1),
                rag_chunks_used=len(sources),
                rag_score_max=max((s.get("score", 0) for s in sources), default=0),
                rag_score_avg=sum(s.get("score", 0) for s in sources) / max(len(sources), 1),
                model=settings.anything_llm_workspace,
                workspace=settings.anything_llm_workspace,
                success=success,
                error=error_msg,
                streaming=True,
            ))
            asyncio.create_task(_save_messages(full_text, sources))

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Frontend statique ─────────────────────────────────────────────
_here        = os.path.dirname(os.path.abspath(__file__))
frontend_dir = os.path.normpath(os.path.join(_here, "..", "Frontend"))
print(f"  📁 Frontend : {frontend_dir}")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    print("  ⚠ Frontend introuvable")