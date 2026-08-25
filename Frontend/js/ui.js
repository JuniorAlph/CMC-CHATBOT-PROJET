/**
 * ui.js — Gestion complète de l'interface utilisateur
 */

const WELCOME_MESSAGE = "Bonjour, que puis-je faire pour vous ?";

const UI = (() => {

  // ── Helper ──────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Références DOM ───────────────────────────────────────────────
  const refs = {
    messagesArea:    () => el("messagesArea"),
    emptyState:      () => el("emptyState"),
    msgInput:        () => el("msgInput"),
    sendBtn:         () => el("sendBtn"),
    voiceBtn:        () => el("voiceBtn"),
    errorBar:        () => el("errorBar"),
    statusDot:       () => el("statusDot"),
    statusText:      () => el("statusText"),
    modelBadge:      () => el("modelBadge"),
    historyList:     () => el("historyList"),
    modelSelect:     () => el("modelSelect"),
    tempRange:       () => el("tempRange"),
    tempVal:         () => el("tempVal"),
    streamToggle:    () => el("streamToggle"),
    streamLabel:     () => el("streamLabel"),
    themeToggle:     () => el("themeToggle"),
    voiceOutToggle:  () => el("voiceOutToggle"),
    newChatBtn:      () => el("newChatBtn"),
    clearBtn:        () => el("clearBtn"),
    serverDot:       () => el("serverDot"),
    serverStatusText:() => el("serverStatusText"),
    ragDot:          () => el("ragDot"),
    ragStatusText:   () => el("ragStatusText"),
  };

  // ── Thème clair / sombre ─────────────────────────────────────────
  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("cmc-theme", next);
    const toggle = refs.themeToggle();
    if (toggle) toggle.checked = next === "light";
  }

  function initTheme() {
    const saved = localStorage.getItem("cmc-theme");
    applyTheme(saved === "light" ? "light" : "dark");
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "light" ? "dark" : "light");
  }

  function isLightTheme() {
    return document.documentElement.getAttribute("data-theme") === "light";
  }

  // ── Voix (TTS) ───────────────────────────────────────────────────
  function isVoiceOutputEnabled() {
    const t = refs.voiceOutToggle();
    return t ? t.checked : false;
  }

  function speak(text) {
    if (!text || !isVoiceOutputEnabled()) return;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, "").replace(/\*\*/g, ""));
    utterance.lang = "fr-FR";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  // ── Formatage ───────────────────────────────────────────────────
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function formatContent(text) {
    if (text == null || text === "") {
      return '<span class="empty-response">Aucune réponse reçue du serveur.</span>';
    }
    const parts = String(text).split(/(```[\s\S]*?```)/g);
    return parts.map(part => {
      if (part.startsWith("```")) {
        const code = part.replace(/^```[^\n]*\n?/,"").replace(/```$/,"").trim();
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      return escapeHtml(part)
        .replace(/\n/g,"<br>")
        .replace(/`([^`]+)`/g,"<code>$1</code>")
        .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
        .replace(/\*(.+?)\*/g,"<em>$1</em>");
    }).join("");
  }

  function currentTime() {
    return new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
  }

  function scrollToBottom() {
    const area = refs.messagesArea();
    if (area) area.scrollTop = area.scrollHeight;
  }

  function removeEmptyState() {
    const es = refs.emptyState();
    const area = refs.messagesArea();
    if (es && area && es.parentNode === area) es.remove();
  }

  // ── Messages ────────────────────────────────────────────────────
  function appendMessage(role, content, options = {}) {
    removeEmptyState();
    const area = refs.messagesArea();
    if (!area) return;

    const row = document.createElement("div");
    row.className = `msg-row ${role === "user" ? "user" : ""}`;
    if (options.welcome) row.classList.add("welcome-row");

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role === "user" ? "user" : "ai"}`;
    avatar.textContent = role === "user" ? "Vous" : "CMC";

    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "user" ? "user" : "ai"}`;
    bubble.innerHTML = formatContent(content);

    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = currentTime();
    bubble.appendChild(time);

    row.appendChild(avatar);
    row.appendChild(bubble);
    area.appendChild(row);
    scrollToBottom();

    if (role === "assistant" && content && options.speak !== false) {
      speak(content);
    }
    return bubble;
  }

  function createStreamingBubble() {
    removeEmptyState();
    const area = refs.messagesArea();
    if (!area) return { update: () => {}, finalize: () => {} };

    const row = document.createElement("div");
    row.className = "msg-row";

    const avatar = document.createElement("div");
    avatar.className = "avatar ai";
    avatar.textContent = "CMC";

    const bubble = document.createElement("div");
    bubble.className = "bubble ai streaming";

    const content = document.createElement("span");
    content.className = "stream-content";
    bubble.appendChild(content);

    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    cursor.textContent = "▌";
    bubble.appendChild(cursor);

    row.appendChild(avatar);
    row.appendChild(bubble);
    area.appendChild(row);

    let fullText = "";
    return {
      update(delta) {
        fullText += delta;
        content.textContent = fullText;
        scrollToBottom();
      },
      finalize() {
        content.innerHTML = formatContent(fullText);
        cursor.remove();
        const time = document.createElement("span");
        time.className = "msg-time";
        time.textContent = currentTime();
        bubble.appendChild(time);
        bubble.classList.remove("streaming");
        scrollToBottom();
        if (fullText) speak(fullText);
      },
    };
  }

  function appendThinking() {
    removeEmptyState();
    const area = refs.messagesArea();
    if (!area) return;
    const row = document.createElement("div");
    row.className = "msg-row thinking-row";
    row.id = "__thinking__";
    const avatar = document.createElement("div");
    avatar.className = "avatar ai";
    avatar.textContent = "CMC";
    const bubble = document.createElement("div");
    bubble.className = "bubble ai";
    bubble.innerHTML = `<div class="thinking"><span></span><span></span><span></span></div>`;
    row.appendChild(avatar);
    row.appendChild(bubble);
    area.appendChild(row);
    scrollToBottom();
  }

  function removeThinking() {
    const node = el("__thinking__");
    if (node) node.remove();
  }

  // ── Sources RAG ─────────────────────────────────────────────────
  function appendSources(sources) {
    if (!sources || sources.length === 0) return;
    const area = refs.messagesArea();
    if (!area) return;
    const block = document.createElement("div");
    block.className = "sources-block";
    const title = document.createElement("p");
    title.className = "sources-title";
    title.textContent = "Sources utilisées";
    block.appendChild(title);
    sources.forEach(s => {
      const pill = document.createElement("a");
      pill.className = "source-pill";
      pill.href = s.url || "#";
      pill.target = "_blank";
      pill.innerHTML = `${escapeHtml((s.title||"Source").slice(0,35))} <span class="score">${Math.round((s.score||0)*100)}%</span>`;
      block.appendChild(pill);
    });
    area.appendChild(block);
    scrollToBottom();
  }

  // ── États visuels ────────────────────────────────────────────────
  function setStatus(state, label) {
    const dot  = refs.statusDot();
    const text = refs.statusText();
    const map  = { ready:"Prêt", loading:"Génération…", error:"Erreur" };
    if (dot) {
      dot.className = "status-dot";
      if (state === "loading") dot.classList.add("loading");
      if (state === "error")   dot.classList.add("error");
    }
    if (text) text.textContent = label || map[state] || state;
  }

  function setServerStatus(ok, message) {
    const dot  = refs.serverDot();
    const text = refs.serverStatusText();
    if (dot)  dot.className    = "status-dot" + (ok ? "" : " error");
    if (text) text.textContent = message;
  }

  function setRAGStatus(ready, chunkCount) {
    const dot  = refs.ragDot();
    const text = refs.ragStatusText();
    if (dot)  dot.className    = "status-dot" + (ready ? "" : " error");
    if (text) text.textContent = ready ? `RAG : ${chunkCount} chunks` : "RAG : non prêt";
  }

  function showError(message) {
    const bar = refs.errorBar();
    if (!bar) return;
    if (!message) { bar.style.display="none"; bar.textContent=""; return; }
    bar.textContent = "⚠ " + message;
    bar.style.display = "block";
    setTimeout(() => showError(null), 7000);
  }

  function setLoading(loading) {
    const btn   = refs.sendBtn();
    const input = refs.msgInput();
    if (btn)   btn.disabled   = loading;
    if (input) input.disabled = loading;
    setStatus(loading ? "loading" : "ready");
  }

  // ── Contrôles ───────────────────────────────────────────────────
  function getModel()       { const s=refs.modelSelect(); return s?s.value:"deepseek-r1:7b"; }
  function getTemperature() { const r=refs.tempRange();   return r?parseFloat(r.value):0.7; }
  function getInputText()   { const i=refs.msgInput();    return i?i.value.trim():""; }
  function isStreaming()    { const t=refs.streamToggle();return t?t.checked:false; }

  function clearInput() {
    const input = refs.msgInput();
    if (!input) return;
    input.value = "";
    input.style.height = "auto";
  }

  // ── Historique sidebar ───────────────────────────────────────────
  function addHistoryItem(id, text) {
    const list = refs.historyList();
    if (!list) return;
    const empty = list.querySelector(".history-empty");
    if (empty) empty.remove();
    list.querySelectorAll(".history-item.active").forEach(n => n.classList.remove("active"));
    const item = document.createElement("div");
    item.className   = "history-item active";
    item.dataset.id  = id;
    item.textContent = text.length > 38 ? text.slice(0,38)+"…" : text;
    list.prepend(item);
    return item;
  }

  function renderConversationList(conversations, activeId, onLoad, onDelete) {
    const list = refs.historyList();
    if (!list) return;
    list.innerHTML = "";
    if (!conversations || conversations.length === 0) {
      list.innerHTML = '<p class="history-empty">Aucune conversation</p>';
      return;
    }
    conversations.forEach(conv => {
      const item = document.createElement("div");
      item.className   = "history-item" + (conv.id === activeId ? " active" : "");
      item.dataset.id  = conv.id;

      const titleEl = document.createElement("span");
      titleEl.className   = "history-title";
      titleEl.textContent = conv.title;

      const delBtn = document.createElement("button");
      delBtn.className   = "history-delete";
      delBtn.textContent = "✕";
      delBtn.title       = "Supprimer";
      delBtn.addEventListener("click", (e) => { e.stopPropagation(); onDelete(conv.id); });

      item.appendChild(titleEl);
      item.appendChild(delBtn);
      item.addEventListener("click", () => onLoad(conv.id));
      list.appendChild(item);
    });
  }

  function highlightConversation(activeId) {
    document.querySelectorAll(".history-item").forEach(item => {
      item.classList.toggle("active", item.dataset.id === activeId);
    });
  }

  function renderMessages(messages) {
    const area = refs.messagesArea();
    if (!area) return;
    area.innerHTML = "";
    if (!messages || messages.length === 0) {
      showWelcome();
      return;
    }
    messages.forEach(m => {
      appendMessage(m.role, m.content, { speak: false });
      if (m.sources && m.sources.length > 0) appendSources(m.sources);
    });
  }

  function buildSuggestionsHtml() {
    return `
      <div class="suggestions">
        <button class="suggestion" data-text="Quelles formations sont disponibles à la CMC de Rabat ?">Formations disponibles</button>
        <button class="suggestion" data-text="Comment s'inscrire à la CMC Rabat ?">Procédure d'inscription</button>
        <button class="suggestion" data-text="Quels sont les frais de scolarité à la CMC ?">Frais de scolarité</button>
        <button class="suggestion" data-text="Où se trouve la CMC Rabat-Salé-Kénitra ?">Localisation</button>
      </div>`;
  }

  function showWelcome() {
    const area = refs.messagesArea();
    if (!area) return;
    area.innerHTML = "";
    appendMessage("assistant", WELCOME_MESSAGE, { welcome: true, speak: false });

    const suggestions = document.createElement("div");
    suggestions.className = "empty-state";
    suggestions.id = "emptyState";
    suggestions.innerHTML = `
      <div class="empty-icon">🏫</div>
      <p>Posez vos questions sur les filières, l'admission, les frais et la vie des apprenants.</p>
      ${buildSuggestionsHtml()}`;
    area.appendChild(suggestions);
    scrollToBottom();
  }

  function clearMessages() {
    showWelcome();
  }

  function updateModelBadge(model) {
    const b = refs.modelBadge();
    if (b) b.textContent = model;
  }

  // ── Export ───────────────────────────────────────────────────────
  return {
    refs,
    WELCOME_MESSAGE,
    appendMessage,
    createStreamingBubble,
    appendThinking,
    removeThinking,
    appendSources,
    setStatus,
    setServerStatus,
    setRAGStatus,
    showError,
    setLoading,
    getModel,
    getTemperature,
    getInputText,
    isStreaming,
    clearInput,
    addHistoryItem,
    renderConversationList,
    highlightConversation,
    renderMessages,
    clearMessages,
    showWelcome,
    updateModelBadge,
    scrollToBottom,
    initTheme,
    toggleTheme,
    isLightTheme,
    isVoiceOutputEnabled,
    speak,
    stopSpeaking,
  };

})();