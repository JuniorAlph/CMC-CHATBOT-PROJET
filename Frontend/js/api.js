/**
 * api.js — Client HTTP vers FastAPI (Ollama + RAG + MongoDB)
 */

const API = (() => {

  function resolveBaseUrl() {
    const { protocol, hostname, port } = window.location;
    if (protocol === "file:") return "http://127.0.0.1:8000";
    if (port === "5500" || port === "5173" || port === "3000" || port === "8080") {
      return "http://127.0.0.1:8000";
    }
    return "";
  }

  const BASE_URL = resolveBaseUrl();

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
    } catch {
      throw new Error("Impossible de joindre le serveur. Ollama est-il démarré ?");
    }
    if (!response.ok) {
      let detail = `Erreur HTTP ${response.status}`;
      try { const d = await response.json(); detail = d.detail || d.error || detail; } catch {}
      const err = new Error(detail);
      err.status = response.status;
      throw err;
    }
    return response;
  }

  // ── Système ──────────────────────────────────────────────────
  const checkHealth    = () => request("/health").then(r => r.json());
  const checkRAGStatus = () => request("/rag/status").then(r => r.json());
  const reindex        = () => request("/rag/reindex", { method: "POST" }).then(r => r.json());
  const fetchModels    = () => request("/models").then(r => r.json()).then(d => d.models ?? []);

  // ── Conversations ────────────────────────────────────────────
  const listConversations  = ()   => request("/conversations").then(r => r.json());
  const getConversation    = (id) => request(`/conversations/${id}`).then(r => r.json());
  const getMessages        = (id) => request(`/conversations/${id}/messages`).then(r => r.json());
  const deleteConversation = (id) => request(`/conversations/${id}`, { method: "DELETE" }).then(r => r.json());

  // ── Chat ─────────────────────────────────────────────────────
  async function sendMessage(payload) {
    return request("/chat", {
      method: "POST",
      body: JSON.stringify({ ...payload, stream: false }),
    }).then(r => r.json());
  }

  async function sendMessageStream(payload, onDelta, onDone, onError, onConvId) {
    let response;
    try {
      response = await fetch(`${BASE_URL}/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, stream: true }),
      });
    } catch { onError?.("Impossible de joindre le serveur."); return; }

    if (!response.ok) {
      let detail = `Erreur HTTP ${response.status}`;
      try { const d = await response.json(); detail = d.detail || d.error || detail; } catch {}
      onError?.(detail);
      return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText  = "";
    let buffer    = "";
    let finished  = false;

    function processLine(rawLine) {
      const t = rawLine.trim();
      if (!t) return;
      if (t === "data: [DONE]") {
        if (!finished) { finished = true; onDone?.(fullText); }
        return;
      }
      if (!t.startsWith("data: ")) return;
      try {
        const json = JSON.parse(t.slice(6));
        if (json.error) { onError?.(json.error); return; }
        if (json.conversation_id) { onConvId?.(json.conversation_id); return; }
        if (json.sources) return;
        const delta = json.delta ?? json.textResponse ?? json.text ?? json.token ?? "";
        if (delta) { fullText += delta; onDelta?.(delta, fullText); }
      } catch {}
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : (lines.pop() ?? "");
          for (const line of lines) processLine(line);
        }
        if (done) {
          if (buffer.trim()) processLine(buffer);
          if (!finished) { finished = true; onDone?.(fullText); }
          break;
        }
      }
    } catch (err) { onError?.(err.message); }
  }

  // ── Métriques ────────────────────────────────────────────────
  const getMetrics        = () => request("/metrics").then(r => r.json());
  const getMetricsHistory = (limit = 30) => request(`/metrics/history?limit=${limit}`).then(r => r.json());

  return {
    BASE_URL,
    getMetrics, getMetricsHistory,
    checkHealth, checkRAGStatus, reindex, fetchModels,
    listConversations, getConversation, getMessages, deleteConversation,
    sendMessage, sendMessageStream,
  };

})();