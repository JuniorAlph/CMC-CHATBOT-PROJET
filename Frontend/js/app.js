/**
 * app.js — Orchestration avec MongoDB + RAG + sidebar responsive
 */

const App = (() => {

  let conversationHistory = [];
  let currentConvId       = null;
  let isBusy              = false;

  function el(id)          { return document.getElementById(id); }
  function on(id, evt, fn) { const n = el(id); if (n) n.addEventListener(evt, fn); }

  // ── Sidebar mobile ─────────────────────────────────────────────
  function openSidebar() {
    el("sidebar")?.classList.add("open");
    el("sidebarOverlay")?.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    el("sidebar")?.classList.remove("open");
    el("sidebarOverlay")?.classList.remove("active");
    document.body.style.overflow = "";
  }

  // Ferme la sidebar auto après sélection sur mobile
  function closeSidebarIfMobile() {
    if (window.innerWidth <= 640) closeSidebar();
  }

  // ── Payload ────────────────────────────────────────────────────
  function buildPayload() {
    const payload = {
      messages:    conversationHistory,
      model:       UI.getModel(),
      temperature: UI.getTemperature(),
      max_tokens:  2048,
      use_rag:     true,
    };
    if (currentConvId) payload.conversation_id = currentConvId;
    return payload;
  }

  // ── Envoi ──────────────────────────────────────────────────────
  async function sendMessage() {
    if (isBusy) return;
    const text   = UI.getInputText();
    const stream = UI.isStreaming();
    if (!text) return;

    UI.showError(null);
    isBusy = true;
    UI.setLoading(true);
    UI.clearInput();
    if (el("sendBtn")) el("sendBtn").disabled = true;

    UI.appendMessage("user", text);
    conversationHistory.push({ role: "user", content: text });

    const payload = buildPayload();

    try {
      if (stream) {
        await sendStreaming(payload);
      } else {
        await sendClassic(payload);
      }
    } catch (err) {
      UI.showError(typeof err === "string" ? err : err.message || "Erreur inconnue");
      conversationHistory.pop();
      console.error("[App]", err);
    }

    isBusy = false;
    UI.setLoading(false);
    const input = el("msgInput");
    if (el("sendBtn")) el("sendBtn").disabled = !(input && input.value.trim());
    if (input) input.focus();
  }

  async function sendClassic(payload) {
    UI.appendThinking();
    const data = await API.sendMessage(payload);
    UI.removeThinking();
    const content = (data.content || "").trim();
    if (!content) {
      UI.showError("Réponse vide du serveur. Vérifiez qu'AnythingLLM est démarré.");
      return;
    }
    UI.appendMessage("assistant", content);
    if (data.sources && data.sources.length > 0) UI.appendSources(data.sources);
    conversationHistory.push({ role: "assistant", content });
    if (data.conversation_id && !currentConvId) {
      currentConvId = data.conversation_id;
      await loadConversationList();
    }
  }

  async function sendStreaming(payload) {
    const streamBubble = UI.createStreamingBubble();
    let   fullText     = "";
    let   streamError  = null;
    let   finished     = false;

    const finish = () => {
      if (!finished) {
        finished = true;
        streamBubble.finalize();
      }
    };

    await new Promise((resolve) => {
      API.sendMessageStream(
        payload,
        (delta) => { fullText += delta; streamBubble.update(delta); },
        ()      => { finish(); resolve(); },
        (err)   => { streamError = typeof err === "string" ? err : JSON.stringify(err); finish(); resolve(); },
        (convId) => {
          if (!currentConvId && convId) {
            currentConvId = convId;
            loadConversationList();
          }
        },
      );
    });

    if (streamError) throw new Error(streamError);
    if (!fullText.trim()) {
      UI.showError("Réponse vide du serveur. Vérifiez qu'AnythingLLM est démarré.");
      return;
    }
    if (fullText) conversationHistory.push({ role: "assistant", content: fullText });
  }

  // ── Historique ─────────────────────────────────────────────────
  async function loadConversationList() {
    try {
      const conversations = await API.listConversations();
      UI.renderConversationList(conversations, currentConvId, (id) => {
        loadConversation(id);
        closeSidebarIfMobile();
      }, deleteConversation);
    } catch (err) {
      console.warn("[App] Historique non disponible :", err.message);
    }
  }

  async function loadConversation(convId) {
    if (convId === currentConvId) return;
    try {
      const messages = await API.getMessages(convId);
      currentConvId = convId;
      conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
      UI.renderMessages(messages);
      UI.highlightConversation(convId);
    } catch (err) {
      UI.showError("Impossible de charger la conversation.");
    }
  }

  async function deleteConversation(convId) {
    if (!confirm("Supprimer cette conversation ?")) return;
    try {
      await API.deleteConversation(convId);
      if (convId === currentConvId) startNewConversation();
      await loadConversationList();
    } catch (err) {
      UI.showError("Erreur lors de la suppression.");
    }
  }

  function startNewConversation() {
    currentConvId       = null;
    conversationHistory = [];
    UI.stopSpeaking();
    UI.clearMessages();
    UI.highlightConversation(null);
    closeSidebarIfMobile();
  }

  // ── Reconnaissance vocale (STT) ────────────────────────────────
  let recognition = null;
  let isListening = false;

  function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isListening = true;
      const btn = el("voiceBtn");
      if (btn) {
        btn.classList.add("listening");
        btn.title = "Écoute en cours…";
      }
      UI.setStatus("loading", "Écoute…");
    };

    recognition.onend = () => {
      isListening = false;
      const btn = el("voiceBtn");
      if (btn) {
        btn.classList.remove("listening");
        btn.title = "Dicter votre message";
      }
      if (!isBusy) UI.setStatus("ready");
    };

    recognition.onerror = (e) => {
      if (e.error !== "aborted") {
        UI.showError("Microphone indisponible ou permission refusée.");
      }
    };

    recognition.onresult = (event) => {
      const input = el("msgInput");
      if (!input) return;
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = transcript.trim();
      input.dispatchEvent(new Event("input"));
      if (event.results[event.results.length - 1].isFinal && transcript.trim()) {
        setTimeout(() => sendMessage(), 300);
      }
    };

    return recognition;
  }

  function toggleVoiceInput() {
    if (!recognition) {
      recognition = initVoiceInput();
      if (!recognition) {
        UI.showError("La reconnaissance vocale n'est pas supportée par ce navigateur.");
        return;
      }
    }
    if (isListening) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
    } catch {
      UI.showError("Impossible d'activer le microphone.");
    }
  }

  // ── Statut ──────────────────────────────────────────────────────
  async function checkServer() {
    UI.setServerStatus(false, "Vérification…");
    try {
      const health = await API.checkHealth();
      const ok = health.status === "ok";
      UI.setServerStatus(ok, ok ? "Serveur connecté" : health.message);
      if (ok) {
        const rag = await API.checkRAGStatus();
        UI.setRAGStatus(rag.ready, rag.chunk_count);
      }
    } catch {
      UI.setServerStatus(false, "Serveur inaccessible");
    }
  }

  // ── Événements ──────────────────────────────────────────────────
  // ── Bascule entre les onglets Chat / Dashboard ──────────────────
  function switchTab(tab) {
    const tabChat   = el("tabChat");
    const tabDash   = el("tabDash");
    const chatTab   = el("chatTabContent");
    const viewChat  = el("viewChat");
    const viewDash  = el("viewDashboard");
    const clearBtn  = el("clearBtn");

    if (tab === "dashboard") {
      tabChat?.classList.remove("active");
      tabDash?.classList.add("active");
      if (chatTab)  chatTab.style.display  = "none";
      if (viewChat) viewChat.style.display = "none";
      if (viewDash) viewDash.style.display = "flex";
      if (viewDash) viewDash.style.flexDirection = "column";
      if (clearBtn) clearBtn.style.display = "none";
      Dashboard.load();
    } else {
      tabDash?.classList.remove("active");
      tabChat?.classList.add("active");
      if (chatTab)  chatTab.style.display  = "";
      if (viewChat) viewChat.style.display = "";
      if (viewDash) viewDash.style.display = "none";
      if (clearBtn) clearBtn.style.display = "";
    }
    closeSidebarIfMobile();
  }

  function bindEvents() {
    // Chat
    on("sendBtn",  "click",   sendMessage);
    on("clearBtn", "click",   startNewConversation);
    on("newChatBtn","click",  startNewConversation);

    // Clavier
    on("msgInput", "keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    // Auto-resize textarea + activation bouton
    on("msgInput", "input", () => {
      const input = el("msgInput");
      if (!input) return;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";
      if (el("sendBtn")) el("sendBtn").disabled = isBusy || !input.value.trim();
    });

    // Paramètres
    on("modelSelect",  "change",  (e) => UI.updateModelBadge(e.target.value));
    on("tempRange",    "input",   (e) => { const v = el("tempVal"); if (v) v.textContent = parseFloat(e.target.value).toFixed(1); });
    on("streamToggle", "change",  () => {}); // état lu directement via UI.isStreaming()
    on("themeToggle",  "change",   () => UI.toggleTheme());
    on("headerThemeBtn","click",   () => UI.toggleTheme());
    on("voiceBtn",     "click",    toggleVoiceInput);

    // RAG
    on("reindexBtn", "click", () => {
      // Ouvre AnythingLLM pour gérer les documents
      window.open("http://localhost:3000", "_blank");
    });

    // Sidebar mobile
    on("hamburgerBtn",   "click", openSidebar);
    on("sidebarClose",   "click", closeSidebar);
    on("sidebarOverlay", "click", closeSidebar);

    // Ferme la sidebar si on redimensionne vers desktop
    window.addEventListener("resize", () => {
      if (window.innerWidth > 640) closeSidebar();
    });

    // Suggestions (délégation)
    const area = el("messagesArea");
    if (area) area.addEventListener("click", (e) => {
      const btn = e.target.closest(".suggestion");
      if (!btn) return;
      const input = el("msgInput");
      if (!input) return;
      input.value = btn.dataset.text || "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  }

  // ── Init ────────────────────────────────────────────────────────
  async function init() {
    bindEvents();
    UI.initTheme();
    UI.showWelcome();
    UI.setStatus("ready");
    if (el("sendBtn")) el("sendBtn").disabled = true;
    initVoiceInput();
    await checkServer();
    await loadConversationList();
    const input = el("msgInput");
    if (input) input.focus();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { sendMessage, startNewConversation, switchTab, getHistory: () => [...conversationHistory] };

})();