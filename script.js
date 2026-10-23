(() => {
  "use strict";

  const STORAGE_KEY = "centralHexJarvis.v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nowTime = () => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  const timestamp = () => new Date().toISOString();

  const state = {
    rules: [],
    logs: [],
    preferences: { tts: true, confirm: true, remoteAi: false, endpoint: "", model: "" },
    listening: false
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        state.rules = Array.isArray(saved.rules) ? saved.rules.filter(validRule) : [];
        state.logs = Array.isArray(saved.logs) ? saved.logs.filter(validLog).slice(-200) : [];
        state.preferences = { ...state.preferences, ...(saved.preferences || {}) };
      }
    } catch (error) {
      console.warn("CENTRAL-HEX: données locales illisibles.", error);
      toast("Certaines données locales n'ont pas pu être chargées.", true);
    }
  }

  function validRule(rule) {
    return rule && typeof rule.id === "string" && typeof rule.name === "string" &&
      ["manual", "visit"].includes(rule.trigger) &&
      ["notify", "speak", "note"].includes(rule.action) && typeof rule.payload === "string";
  }
  function validLog(log) {
    return log && typeof log.id === "string" && typeof log.event === "string" &&
      typeof log.detail === "string" && typeof log.time === "string";
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rules: state.rules, logs: state.logs.slice(-200), preferences: state.preferences
      }));
    } catch (error) {
      console.error("CENTRAL-HEX: sauvegarde impossible.", error);
      toast("Impossible d'enregistrer : stockage local indisponible.", true);
    }
    renderStats();
  }

  function toast(message, isError = false) {
    const region = $("#toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast${isError ? " error" : ""}`;
    item.textContent = String(message);
    region.append(item);
    window.setTimeout(() => item.remove(), 3800);
  }

  function logEvent(event, detail, status = "OK") {
    state.logs.unshift({
      id: makeId(), event: String(event).slice(0, 100),
      detail: String(detail).slice(0, 500), status, time: timestamp()
    });
    state.logs = state.logs.slice(0, 200);
    saveState();
    renderActivity();
    renderRecentActivity();
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const viewNames = {
    overview: "Vue d'ensemble", assistant: "Assistant JARVIS", automation: "Automatisations",
    activity: "Journal d'activité", modules: "Modules", settings: "Configuration"
  };

  function showView(name) {
    if (!viewNames[name]) return;
    $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
    $("#pageCrumb").textContent = viewNames[name];
    $("#sidebar").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "activity") renderActivity();
    if (name === "automation") renderRules();
  }

  function addChatMessage(text, sender = "assistant") {
    const host = $("#chatMessages");
    const wrapper = document.createElement("div");
    wrapper.className = `message ${sender === "user" ? "user-message" : "assistant-message"}`;
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = sender === "user" ? "VOUS" : "JARVIS";
    const time = document.createElement("span");
    time.textContent = nowTime();
    label.append(time);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrapper.append(label, bubble);
    host.append(wrapper);
    host.scrollTop = host.scrollHeight;
  }

  function speak(text) {
    if (!state.preferences.tts || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fr-FR";
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("Synthèse vocale indisponible.", error);
    }
  }

  function getBatteryInfo() {
    return new Promise(resolve => {
      if (typeof navigator.getBattery !== "function") {
        resolve("Le navigateur ne permet pas de lire le niveau de batterie.");
        return;
      }
      navigator.getBattery().then(battery => {
        const percent = Math.round(battery.level * 100);
        resolve(`Batterie du téléphone : ${percent}%. ${battery.charging ? "Le téléphone est en charge." : "Le téléphone n'est pas en charge."}`);
      }).catch(() => resolve("L'état de batterie n'est pas accessible dans ce navigateur."));
    });
  }

  function normalize(text) {
    return text.toLocaleLowerCase("fr-FR").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function safeExternalAction(description, action) {
    if (state.preferences.confirm) {
      openConfirm(description, action);
    } else {
      action();
    }
  }

  let pendingAction = null;
  function openConfirm(message, action) {
    pendingAction = action;
    $("#confirmText").textContent = message;
    $("#confirmModal").classList.remove("hidden");
    $("#acceptConfirm").focus();
  }
  function closeConfirm() {
    $("#confirmModal").classList.add("hidden");
    pendingAction = null;
  }

  async function processCommand(raw) {
    const input = String(raw || "").trim().slice(0, 1200);
    if (!input) return;
    addChatMessage(input, "user");
    logEvent("Commande reçue", input);
    const normalized = normalize(input);
    let reply;

    if (["aide", "help", "commandes", "que peux tu faire"].includes(normalized)) {
      reply = "Je peux répondre aux commandes locales : « aide », « batterie », « heure », « date », « note votre texte », « mes notes », « ouvre un site web » et « lance la règle nom ». Le contrôle complet d'Android nécessite une application native.";
    } else if (normalized.includes("batterie")) {
      reply = await getBatteryInfo();
    } else if (normalized === "heure" || normalized.includes("quelle heure")) {
      reply = `Il est ${nowTime()}.`;
    } else if (normalized === "date" || normalized.includes("quelle date")) {
      reply = `Nous sommes le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(new Date())}.`;
    } else if (normalized.startsWith("note ")) {
      const note = input.slice(input.indexOf(" ") + 1).trim();
      const notes = getNotes();
      notes.push({ text: note, time: timestamp() });
      saveNotes(notes);
      reply = note ? "Note enregistrée localement dans ce navigateur." : "Écris le contenu de la note après le mot « note ».";
      logEvent("Note enregistrée", note);
    } else if (normalized === "mes notes" || normalized === "affiche mes notes") {
      const notes = getNotes();
      reply = notes.length ? notes.slice(-10).map((note, i) => `${i + 1}. ${note.text}`).join("\n") : "Aucune note locale pour le moment.";
    } else if (normalized.startsWith("ouvre ") || normalized.startsWith("ouvrir ")) {
      const target = input.slice(input.indexOf(" ") + 1).trim();
      const sites = {
        youtube: "https://www.youtube.com/",
        google: "https://www.google.com/",
        wikipedia: "https://fr.wikipedia.org/",
        whatsapp: "https://web.whatsapp.com/",
        github: "https://github.com/"
      };
      const key = normalize(target);
      if (sites[key]) {
        safeExternalAction(`JARVIS va ouvrir ${target} dans un nouvel onglet. Continuer ?`, () => {
          const opened = window.open(sites[key], "_blank", "noopener,noreferrer");
          if (!opened) toast("Le navigateur a bloqué l'ouverture. Autorisez les fenêtres si vous le souhaitez.", true);
          logEvent("Ouverture de site", target, opened ? "OK" : "BLOQUÉ");
        });
        reply = `Je peux ouvrir ${target} dans un nouvel onglet après confirmation.`;
      } else {
        reply = "Site non répertorié. Essaie : ouvre YouTube, Google, Wikipedia, WhatsApp ou GitHub.";
      }
    } else if (normalized.startsWith("lance la regle ")) {
      const name = input.slice("lance la règle ".length).trim();
      const rule = state.rules.find(item => normalize(item.name) === normalize(name));
      if (rule) {
        runRule(rule.id);
        reply = `La règle « ${rule.name} » a été lancée.`;
      } else reply = `Je ne trouve pas la règle « ${name} ».`;
    } else if (normalized.startsWith("appelle ") || normalized.startsWith("sms ") || normalized.startsWith("envoie un sms")) {
      reply = "Pour appeler ou envoyer un SMS, utilise l'application JARVIS native Android. Un site web ne peut pas effectuer ces actions silencieusement. Aucun appel ni message n'a été envoyé.";
    } else if (normalized.includes("alarme") || normalized.includes("rappelle-moi")) {
      reply = "Les alarmes et rappels fiables nécessitent une intégration Android native ou un calendrier. Cette interface web ne programme pas d'alarme système.";
    } else if (state.preferences.remoteAi && state.preferences.endpoint) {
      try {
        const response = await fetch(state.preferences.endpoint.replace(/\/$/, ""), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: input, history: (state.chatHistory || []).slice(-12) })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Erreur serveur (${response.status})`);
        reply = String(data.reply || data.message || "").trim();
        if (!reply) throw new Error("Le serveur n'a pas renvoyé de réponse.");
        state.chatHistory = [...(state.chatHistory || []), {role:"user",content:input}, {role:"assistant",content:reply}].slice(-20);
      } catch (error) {
        reply = `Connexion IA impossible : ${error.message}. Vérifie l'URL du backend et la configuration de la clé API sur Render.`;
        logEvent("Erreur connexion IA", error.message, "ERREUR");
      }
    } else {
      reply = "Je n'ai pas encore de moteur IA connecté. Déploie le serveur sur Render, saisis l'URL complète de /api/chat dans Configuration, puis active « Mode IA distant ». La clé API doit rester dans les variables d'environnement du serveur.";
    }

    addChatMessage(reply, "assistant");
    speak(reply);
    logEvent("Réponse JARVIS", reply.slice(0, 180));
    return reply;
  }

  function getNotes() {
    try {
      const data = JSON.parse(localStorage.getItem(`${STORAGE_KEY}.notes`) || "[]");
      return Array.isArray(data) ? data.filter(n => n && typeof n.text === "string") : [];
    } catch { return []; }
  }
  function saveNotes(notes) {
    try { localStorage.setItem(`${STORAGE_KEY}.notes`, JSON.stringify(notes.slice(-100))); }
    catch { toast("Impossible d'enregistrer la note dans le stockage local.", true); }
  }

  function renderStats() {
    $("#statRules").textContent = String(state.rules.length).padStart(2, "0");
    $("#ruleCount").textContent = String(state.rules.length);
    $("#statActions").textContent = String(state.logs.length).padStart(2, "0");
    $("#rulesSubtitle").textContent = state.rules.length ? `${state.rules.length} règle(s) enregistrée(s)` : "Aucune règle créée";
    $("#aiModeInfo").textContent = state.preferences.remoteAi ? "Backend configuré" : "Local";
    $("#connectionInfo").textContent = navigator.onLine ? "Connecté" : "Hors ligne";
  }

  function renderRecentActivity() {
    const host = $("#recentActivity");
    const recent = state.logs.slice(0, 4);
    host.replaceChildren();
    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "Aucune activité pour le moment.<br>Essayez une commande JARVIS.";
      host.append(empty);
      return;
    }
    recent.forEach(entry => {
      const row = document.createElement("div");
      row.className = "activity-item";
      const symbol = document.createElement("div");
      symbol.className = "activity-symbol";
      symbol.textContent = "≋";
      const detail = document.createElement("div");
      detail.className = "activity-detail";
      const title = document.createElement("strong");
      title.textContent = entry.event;
      const sub = document.createElement("small");
      sub.textContent = entry.detail;
      detail.append(title, sub);
      const time = document.createElement("span");
      time.className = "activity-time";
      time.textContent = formatTime(entry.time);
      row.append(symbol, detail, time);
      host.append(row);
    });
  }

  function renderActivity() {
    const body = $("#activityTable");
    body.replaceChildren();
    if (!state.logs.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "empty-table";
      cell.textContent = "Aucune activité enregistrée.";
      row.append(cell); body.append(row); return;
    }
    state.logs.forEach(entry => {
      const row = document.createElement("tr");
      [entry.event, entry.detail, formatDateTime(entry.time), entry.status || "OK"].forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 3) cell.className = "status-cell";
        row.append(cell);
      });
      body.append(row);
    });
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date inconnue" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function renderRules() {
    const host = $("#rulesList");
    host.replaceChildren();
    if (!state.rules.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = "Aucune automatisation.<br>Créez votre première règle.";
      host.append(empty);
      return;
    }
    state.rules.forEach(rule => {
      const row = document.createElement("div");
      row.className = "rule-item";
      const icon = document.createElement("div");
      icon.className = "rule-icon";
      icon.textContent = "⌘";
      const info = document.createElement("div");
      info.className = "rule-info";
      const title = document.createElement("strong");
      title.textContent = rule.name;
      const desc = document.createElement("small");
      desc.textContent = `${triggerLabel(rule.trigger)} · ${actionLabel(rule.action)}${rule.payload ? ` · ${rule.payload}` : ""}`;
      info.append(title, desc);
      const controls = document.createElement("div");
      controls.className = "rule-controls";
      const run = document.createElement("button");
      run.className = "small-button";
      run.textContent = "Lancer";
      run.type = "button";
      run.addEventListener("click", () => runRule(rule.id));
      const remove = document.createElement("button");
      remove.className = "small-button delete";
      remove.textContent = "Supprimer";
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.rules = state.rules.filter(item => item.id !== rule.id);
        saveState(); renderRules(); logEvent("Règle supprimée", rule.name); toast("Règle supprimée.");
      });
      controls.append(run, remove);
      row.append(icon, info, controls);
      host.append(row);
    });
  }

  function triggerLabel(trigger) {
    return trigger === "visit" ? "À l'ouverture de la page" : "Lancement manuel";
  }
  function actionLabel(action) {
    return ({ notify: "Notification locale", speak: "Lecture vocale", note: "Enregistrement d'une note" })[action] || action;
  }

  function runRule(id) {
    const rule = state.rules.find(item => item.id === id);
    if (!rule) return;
    const execute = () => {
      if (rule.action === "notify") toast(rule.payload || `Règle exécutée : ${rule.name}`);
      if (rule.action === "speak") {
        const text = rule.payload || rule.name;
        if ("speechSynthesis" in window) speak(text);
        else toast("La synthèse vocale n'est pas disponible.", true);
      }
      if (rule.action === "note") {
        if (!rule.payload.trim()) { toast("Ajoutez un contenu à la règle avant de la lancer.", true); return; }
        const notes = getNotes(); notes.push({ text: rule.payload, time: timestamp() }); saveNotes(notes);
        toast("Note ajoutée par la règle.");
      }
      logEvent("Règle exécutée", rule.name);
    };
    if (state.preferences.confirm) openConfirm(`Exécuter « ${rule.name} » ?`, execute);
    else execute();
  }

  function createRule(event) {
    event.preventDefault();
    const name = $("#ruleName").value.trim();
    const payload = $("#rulePayload").value.trim();
    const trigger = $("#ruleTrigger").value;
    const action = $("#ruleAction").value;
    if (name.length < 2) { toast("Le nom doit contenir au moins deux caractères.", true); return; }
    if (!["manual", "visit"].includes(trigger) || !["notify", "speak", "note"].includes(action)) {
      toast("Paramètres de règle invalides.", true); return;
    }
    if (action === "note" && !payload) { toast("Le contenu d'une règle de note ne peut pas être vide.", true); return; }
    const rule = { id: makeId(), name: name.slice(0, 70), payload: payload.slice(0, 500), trigger, action, createdAt: timestamp() };
    state.rules.unshift(rule);
    saveState(); renderRules(); event.target.reset();
    logEvent("Règle créée", rule.name);
    toast("Automatisation enregistrée.");
    if (trigger === "visit") runRule(rule.id);
  }

  function startVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast("La reconnaissance vocale n'est pas prise en charge par ce navigateur. Essaie un navigateur compatible.", true);
      $("#statVoice").textContent = "INDISP.";
      return;
    }
    if (state.listening) {
      if (state.recognition) state.recognition.stop();
      state.listening = false;
      $("#voiceButton").classList.remove("listening");
      $("#voiceButton").setAttribute("aria-label", "Démarrer la reconnaissance vocale");
      return;
    }
    const recognition = new SpeechRecognition();
    state.recognition = recognition;
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      state.listening = true;
      $("#voiceButton").classList.add("listening");
      $("#voiceButton").setAttribute("aria-label", "Arrêter la reconnaissance vocale");
      $("#statVoice").textContent = "ÉCOUTE";
      toast("JARVIS écoute. Parle maintenant.");
    };
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      $("#chatInput").value = transcript;
      processCommand(transcript);
    };
    recognition.onerror = event => toast(`Erreur vocale : ${event.error || "inconnue"}.`, true);
    recognition.onend = () => {
      state.listening = false;
      $("#voiceButton").classList.remove("listening");
      $("#voiceButton").setAttribute("aria-label", "Démarrer la reconnaissance vocale");
      $("#statVoice").textContent = "PRÊTE";
    };
    try { recognition.start(); }
    catch (error) { toast("Impossible de démarrer le micro. Vérifie les permissions du navigateur.", true); }
  }

  function exportLogs() {
    const data = JSON.stringify(state.logs, null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `central-hex-journal-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
    toast("Export du journal préparé.");
  }

  function resetAll() {
    openConfirm("Cette action supprimera les règles, notes, préférences et le journal de cette interface. Continuer ?", () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(`${STORAGE_KEY}.notes`);
      state.rules = []; state.logs = [];
      state.preferences = { tts: true, confirm: true, remoteAi: false, endpoint: "", model: "" };
      applyPreferences(); saveState(); renderRules(); renderActivity(); renderRecentActivity();
      toast("Données locales réinitialisées.");
    });
  }

  function applyPreferences() {
    $("#ttsToggle").checked = Boolean(state.preferences.tts);
    $("#confirmToggle").checked = Boolean(state.preferences.confirm);
    $("#remoteAiToggle").checked = Boolean(state.preferences.remoteAi);
    $("#aiEndpoint").value = state.preferences.endpoint || "";
    $("#aiModel").value = state.preferences.model || "";
    $("#aiModeInfo").textContent = state.preferences.remoteAi ? "Backend configuré" : "Local";
  }

  function init() {
    loadState();
    applyPreferences();
    renderStats(); renderRules(); renderActivity(); renderRecentActivity();

    $$(".nav-item").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
    $$("[data-go]").forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
    $$("[data-command]").forEach(button => button.addEventListener("click", () => { showView("assistant"); processCommand(button.dataset.command); }));
    $$("[data-suggestion]").forEach(button => button.addEventListener("click", () => processCommand(button.dataset.suggestion)));
    $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    document.addEventListener("click", event => {
      const sidebar = $("#sidebar");
      if (sidebar.classList.contains("open") && !sidebar.contains(event.target) && !$("#menuToggle").contains(event.target)) sidebar.classList.remove("open");
    });

    $("#chatForm").addEventListener("submit", event => {
      event.preventDefault();
      const input = $("#chatInput");
      const value = input.value;
      input.value = "";
      processCommand(value);
    });
    $("#voiceButton").addEventListener("click", startVoiceRecognition);
    $("#clearChat").addEventListener("click", () => {
      $("#chatMessages").replaceChildren();
      addChatMessage("Conversation effacée. Les événements déjà inscrits au journal restent disponibles.", "assistant");
      toast("Conversation effacée.");
    });
    $("#newRuleButton").addEventListener("click", () => {
      $("#ruleName").focus();
      $("#ruleFormPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("#ruleForm").addEventListener("submit", createRule);
    $("#resetRule").addEventListener("click", () => window.setTimeout(() => $("#ruleName").focus(), 0));
    $("#exportLog").addEventListener("click", exportLogs);
    $("#clearLog").addEventListener("click", () => openConfirm("Effacer tout le journal d'activité ?", () => {
      state.logs = []; saveState(); renderActivity(); renderRecentActivity(); toast("Journal effacé.");
    }));
    $("#cancelConfirm").addEventListener("click", closeConfirm);
    $("#acceptConfirm").addEventListener("click", () => {
      const action = pendingAction;
      closeConfirm();
      if (typeof action === "function") action();
    });
    $("#confirmModal").addEventListener("click", event => {
      if (event.target === $("#confirmModal")) closeConfirm();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeConfirm();
    });

    $("#ttsToggle").addEventListener("change", event => {
      state.preferences.tts = event.target.checked; saveState();
      if (!event.target.checked && "speechSynthesis" in window) window.speechSynthesis.cancel();
    });
    $("#confirmToggle").addEventListener("change", event => { state.preferences.confirm = event.target.checked; saveState(); });
    $("#remoteAiToggle").addEventListener("change", event => {
      state.preferences.remoteAi = event.target.checked; saveState();
      $("#aiModeInfo").textContent = event.target.checked ? "IA distante" : "Local";
      toast(event.target.checked ? "Mode IA distant activé." : "Mode local activé.");
    });
    $("#aiForm").addEventListener("submit", event => {
      event.preventDefault();
      const endpoint = $("#aiEndpoint").value.trim();
      if (endpoint && !/^https:\/\//i.test(endpoint)) { toast("Utilise une URL HTTPS pour le backend.", true); return; }
      state.preferences.endpoint = endpoint.replace(/\/$/, "");
      state.preferences.model = $("#aiModel").value.trim();
      saveState(); toast("Paramètres IA enregistrés. Active ensuite le mode IA distant.");
    });
    $("#resetAll").addEventListener("click", resetAll);
    $("#testVoice").addEventListener("click", () => {
      if ("speechSynthesis" in window) { speak("Test vocal de CENTRAL-HEX. JARVIS est prêt."); toast("Test vocal lancé."); }
      else toast("Synthèse vocale indisponible.", true);
    });
    $("#themeInfo").addEventListener("click", () => toast("CENTRAL-HEX WEB 1.0 — interface locale noir et blanc."));
    $("#aiEndpoint").value = state.preferences.endpoint || "";
    $("#aiModel").value = state.preferences.model || "";
    $("#remoteAiToggle").checked = !!state.preferences.remoteAi;
    $("#aiModeInfo").textContent = state.preferences.remoteAi ? "IA distante" : "Local";
    $("#platformInfo").textContent = /Android/i.test(navigator.userAgent) ? "Android" : /iPhone|iPad/i.test(navigator.userAgent) ? "iOS" : "Ordinateur";
    $("#languageInfo").textContent = navigator.language || "Inconnue";
    $("#connectionInfo").textContent = navigator.onLine ? "Connecté" : "Hors ligne";
    window.addEventListener("online", () => { $("#connectionInfo").textContent = "Connecté"; });
    window.addEventListener("offline", () => { $("#connectionInfo").textContent = "Hors ligne"; });
    $("#statVoice").textContent = (window.SpeechRecognition || window.webkitSpeechRecognition) ? "PRÊTE" : "LIMITÉE";

    state.rules.filter(rule => rule.trigger === "visit").forEach(rule => runRule(rule.id));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
