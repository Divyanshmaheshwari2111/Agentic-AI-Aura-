let mediaRecorder = null;
let microphoneStream = null;
let audioChunks = [];
let isRecording = false;

const STORAGE_KEYS = {
  conversations: "aura_conversations",
  settings: "aura_settings",
};

let state = {
  currentConversationId: null,
  messages: [],
};

let settings = {
  darkMode: true,
  notifications: false,
  voice: false,
};

/* ---------- 2. Init / bootstrap ---------- */

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  applySettings();
  setupNavigation();
  setupMobileSidebar();
  setupChatForm();
  setupSuggestionCards();
  setupSettingsControls();
  loadNews();
  startNewChat();
});

/* ---------- 3. View switching ---------- */

function setupNavigation() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView(btn.dataset.view);
      closeSidebarOnMobile();
    });
  });

  const newChatBtn = document.getElementById("new-chat-btn");

  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      startNewChat();
      switchView("chat");
      closeSidebarOnMobile();
    });
  }
}

function switchView(viewName) {
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle(
      "active-view",
      section.id === `view-${viewName}`
    );
  });

  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  if (viewName === "history") {
    renderHistoryList();
  }
}

/* ---------- 4. Mobile sidebar ---------- */

function setupMobileSidebar() {
  const toggleBtn = document.getElementById("sidebar-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (!toggleBtn || !backdrop) return;

  toggleBtn.addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");

    if (!sidebar) return;

    const isOpen = sidebar.classList.toggle("open");

    backdrop.classList.toggle("visible", isOpen);
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
  });

  backdrop.addEventListener("click", closeSidebarOnMobile);
}

function closeSidebarOnMobile() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const toggleBtn = document.getElementById("sidebar-toggle");

  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("visible");

  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", "false");
  }
}

/* ---------- 5. Chat ---------- */

function setupChatForm() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const micBtn = document.getElementById("mic-btn");

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleSendMessage();
    });
  }

  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
      }
    });

    input.addEventListener("input", () => {
      autoResizeTextarea(input);
    });
  }

  if (micBtn) {
  micBtn.addEventListener("click", () => {
    if (isRecording) {
      mediaRecorder.stop();
    } else {
      startVoiceRecording();
    }
  });
}
}

async function startVoiceRecording() {
  const micBtn = document.getElementById("mic-btn");

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("Microphone recording is not supported in this browser.");
    return;
  }

  let audioContext = null;

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    audioChunks = [];

    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ].find(type => MediaRecorder.isTypeSupported(type));

    mediaRecorder = mimeType
      ? new MediaRecorder(microphoneStream, { mimeType })
      : new MediaRecorder(microphoneStream);

    mediaRecorder.addEventListener("dataavailable", event => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", async () => {
      isRecording = false;

      if (micBtn) {
        micBtn.classList.remove("mic-recording");
        micBtn.title = "Start voice input";
        micBtn.setAttribute("aria-label", "Start voice input");
      }

      microphoneStream?.getTracks().forEach(track => track.stop());
      microphoneStream = null;

      audioContext = new AudioContext();

      try {
        showToast("Processing your speech...");

        const recordedBlob = new Blob(audioChunks, {
          type: mediaRecorder.mimeType || "audio/webm"
        });

        const audioBuffer = await audioContext.decodeAudioData(
          await recordedBlob.arrayBuffer()
        );

        const wavBlob = audioBufferToWav(audioBuffer);

        const formData = new FormData();
        formData.append("audio", wavBlob, "recording.wav");

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Transcription failed.");
        }

        const input = document.getElementById("chat-input");

        if (input) {
          input.value = data.text;
          autoResizeTextarea(input);
          input.focus();
        }

        showToast("Speech recognized. Press Send to submit.");

      } catch (error) {
        console.error("AURA voice input error:", error);
        showToast(error.message || "Could not recognize your speech.");
      } finally {
        await audioContext.close().catch(() => {});
      }
    }, { once: true });

    isRecording = true;

    if (micBtn) {
      micBtn.classList.add("mic-recording");
      micBtn.title = "Stop voice recording";
      micBtn.setAttribute("aria-label", "Stop voice recording");
    }

    mediaRecorder.start();
    showToast("Listening... Click the microphone to stop.");

  } catch (error) {
    microphoneStream?.getTracks().forEach(track => track.stop());
    microphoneStream = null;
    isRecording = false;

    console.error("Microphone error:", error);

    if (micBtn) {
      micBtn.classList.remove("mic-recording");
      micBtn.title = "Start voice input";
      micBtn.setAttribute("aria-label", "Start voice input");
    }

    if (error.name === "NotAllowedError") {
      showToast("Allow microphone access in your browser settings.");
    } else {
      showToast("Could not start the microphone.");
    }
  }
}


function audioBufferToWav(audioBuffer) {
  const targetRate = 16000;
  const channelCount = audioBuffer.numberOfChannels;
  const inputLength = audioBuffer.length;

  // Convert stereo or multichannel audio to mono.
  const mono = new Float32Array(inputLength);

  for (let channel = 0; channel < channelCount; channel++) {
    const channelData = audioBuffer.getChannelData(channel);

    for (let i = 0; i < inputLength; i++) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  // Resample the audio to 16 kHz for Vosk.
  const ratio = audioBuffer.sampleRate / targetRate;
  const outputLength = Math.ceil(inputLength / ratio);
  const pcm = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, inputLength - 1);
    const fraction = position - left;

    const sample =
      mono[left] * (1 - fraction) + mono[right] * fraction;

    const clipped = Math.max(-1, Math.min(1, sample));

    pcm[i] = clipped < 0
      ? clipped * 32768
      : clipped * 32767;
  }

  // Write a standard 16-bit PCM WAV header.
  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(44 + i * 2, pcm[i], true);
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}


function setupSuggestionCards() {
  document.querySelectorAll(".suggestion-card").forEach((card) => {
    card.addEventListener("click", () => {
      const input = document.getElementById("chat-input");

      if (!input) return;

      input.value = card.dataset.prompt || "";
      handleSendMessage();
    });
  });
}

function handleSendMessage() {
  const input = document.getElementById("chat-input");

  if (!input) return;

  const text = input.value.trim();

  if (!text) return;

  addMessage("user", text);

  input.value = "";
  autoResizeTextarea(input);

  showTypingIndicator();

  fetchAuraResponse(text)
    .then((reply) => {
      hideTypingIndicator();
      addMessage("aura", reply);
      saveCurrentConversation();
      maybeShowBrowserNotification(reply);
    })
    .catch((error) => {
      console.error("AURA response error:", error);

      hideTypingIndicator();

      addMessage(
        "aura",
        "Sorry, something went wrong. Please try again."
      );

      saveCurrentConversation();
    });
}

function addMessage(role, text) {
  const message = {
    role,
    text,
    timestamp: Date.now(),
  };

  state.messages.push(message);

  renderMessage(message);

  const welcome = document.getElementById("welcome-screen");

  if (welcome) {
    welcome.style.display = "none";
  }

  scrollChatToBottom();
}

function renderMessage(message) {
  const container = document.getElementById("messages");

  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = `message ${message.role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "user" ? "U" : "A";

  const content = document.createElement("div");
  content.className = "message-content";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const sender = document.createElement("span");
  sender.className = "message-sender";
  sender.textContent = message.role === "user" ? "You" : "AURA";

  const time = document.createElement("span");
  time.className = "message-time";
  time.textContent = formatTimestamp(message.timestamp);

  meta.append(sender, time);

  const textEl = document.createElement("div");
  textEl.className = "message-text";

  if (message.role === "aura") {
    textEl.innerHTML = DOMPurify.sanitize(
      marked.parse(message.text || "")
    );
  } else {
    textEl.textContent = message.text;
  }

  // Add a speaker button to AURA's replies.
if (message.role === "aura") {
  const speakerBtn = document.createElement("button");
  speakerBtn.className = "speaker-btn";
  speakerBtn.type = "button";
  speakerBtn.title = "Listen to this reply";
  speakerBtn.setAttribute("aria-label", "Listen to this reply");
  speakerBtn.textContent = "🔊";

  speakerBtn.addEventListener("click", () => {
    if (currentAudio || speechRequestController) {
      stopSpeaking();
    } else {
      speakReply(message.text, speakerBtn);
    }
  });

  content.append(meta, textEl, speakerBtn);
} else {
  content.append(meta, textEl);
}

wrapper.append(avatar, content);

  container.appendChild(wrapper);
}

function showTypingIndicator() {
  const container = document.getElementById("messages");

  if (
    !container ||
    document.getElementById("typing-indicator-row")
  ) {
    return;
  }

  const row = document.createElement("div");
  row.className = "message aura";
  row.id = "typing-indicator-row";

  row.innerHTML = `
    <div class="message-avatar">A</div>
    <div class="message-content">
      <div class="message-meta">
        <span class="message-sender">AURA</span>
      </div>
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;

  container.appendChild(row);

  scrollChatToBottom();
}

function hideTypingIndicator() {
  const row = document.getElementById("typing-indicator-row");

  if (row) row.remove();
}

function scrollChatToBottom() {
  const body = document.getElementById("chat-body");

  if (body) {
    body.scrollTop = body.scrollHeight;
  }
}

async function fetchAuraResponse(userMessage) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: userMessage,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data.reply;
}
async function playSong(songName) {
  const response = await fetch("/api/music", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ song: songName })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Unable to search for the song.");
  }

  window.open(data.url, "_blank", "noopener");
}

function generateDemoReply(message) {
  const lower = message.toLowerCase();

  if (lower.includes("weather")) {
    return "Live weather is not connected yet. A weather API can be added later.";
  }

  if (lower.includes("news")) {
    return "News is currently sample content. Open the News tab to see the demo headlines.";
  }

  if (lower.includes("search")) {
    return "Web search is not connected yet.";
  }

  const result = tryEvaluateMath(message);

  if (result !== null) {
    return `That comes out to ${result}.`;
  }

  return "I'm running in demo mode. Connect the Flask API and an AI model for real AI responses.";
}

function tryEvaluateMath(message) {
  const expression = message.replace(/calculate/gi, "").trim();

  const isSafeExpression =
    /^[\d\s+\-*/().]+$/.test(expression) &&
    /\d/.test(expression);

  if (!isSafeExpression) return null;

  try {
    const result = Function(
      `"use strict"; return (${expression});`
    )();

    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/* ---------- 7. Conversation history ---------- */

function startNewChat() {
  state.currentConversationId = `conv_${Date.now()}`;
  state.messages = [];

  const messages = document.getElementById("messages");
  const welcome = document.getElementById("welcome-screen");

  if (messages) {
    messages.innerHTML = "";
  }

  if (welcome) {
    welcome.style.display = "";
  }
}

function saveCurrentConversation() {
  if (!state.messages.length) return;

  const conversations = getConversations();

  const firstUser = state.messages.find(
    (message) => message.role === "user"
  );

  const record = {
    id: state.currentConversationId,
    updatedAt: Date.now(),
    preview: firstUser ? firstUser.text : "New conversation",
    messages: state.messages,
  };

  const index = conversations.findIndex(
    (item) => item.id === record.id
  );

  if (index >= 0) {
    conversations[index] = record;
  } else {
    conversations.unshift(record);
  }

  localStorage.setItem(
    STORAGE_KEYS.conversations,
    JSON.stringify(conversations)
  );
}

function getConversations() {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEYS.conversations) || "[]"
    );
  } catch {
    return [];
  }
}

function renderHistoryList() {
  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");

  if (!list || !empty) return;

  const conversations = getConversations().sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  list.innerHTML = "";

  if (!conversations.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;

  conversations.forEach((conversation) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-item-main";

    const date = document.createElement("div");
    date.className = "history-item-date";
    date.textContent = formatDate(conversation.updatedAt);

    const preview = document.createElement("div");
    preview.className = "history-item-preview";
    preview.textContent = conversation.preview || "New conversation";

    main.append(date, preview);

    main.addEventListener("click", () => {
      loadConversation(conversation.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "history-delete-btn";
    deleteBtn.setAttribute("aria-label", "Delete conversation");
    deleteBtn.textContent = "Delete";

    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteConversation(conversation.id);
    });

    item.append(main, deleteBtn);
    list.appendChild(item);
  });
}

function loadConversation(id) {
  const conversation = getConversations().find(
    (item) => item.id === id
  );

  if (!conversation) return;

  state.currentConversationId = conversation.id;
  state.messages = conversation.messages || [];

  const messagesEl = document.getElementById("messages");
  const welcome = document.getElementById("welcome-screen");

  if (messagesEl) {
    messagesEl.innerHTML = "";
  }

  if (welcome) {
    welcome.style.display = "none";
  }

  state.messages.forEach(renderMessage);

  switchView("chat");
  scrollChatToBottom();
}

function deleteConversation(id) {
  const remaining = getConversations().filter(
    (item) => item.id !== id
  );

  localStorage.setItem(
    STORAGE_KEYS.conversations,
    JSON.stringify(remaining)
  );

  renderHistoryList();

  showToast("Conversation deleted.");

  if (id === state.currentConversationId) {
    startNewChat();
  }
}

/* ---------- 8. News demo ---------- */


async function loadNews(category = "general") {
  const grid = document.getElementById("news-list");

  if (!grid) return;

  grid.replaceChildren();

  const loading = document.createElement("p");
  loading.textContent = "Loading latest news...";
  grid.appendChild(loading);

  try {
    const response = await fetch(
      `/api/news?category=${encodeURIComponent(category)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to load news.");
    }

    grid.replaceChildren();

    if (!data.articles || data.articles.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No news articles found.";
      grid.appendChild(empty);
      return;
    }

    data.articles.forEach((article) => {
      const card = document.createElement("article");
      card.className = "news-card";

      if (article.image) {
        const image = document.createElement("img");
        image.src = article.image;
        image.alt = "";
        image.loading = "lazy";
        image.className = "news-card-image";

        image.addEventListener("error", () => image.remove());
        card.appendChild(image);
      }

      const sourceRow = document.createElement("div");
      sourceRow.className = "news-card-source";
      sourceRow.textContent = article.source;

      const title = document.createElement("h3");
      title.textContent = article.title;

      const description = document.createElement("p");
      description.textContent =
        article.description || "No description available.";

      const date = document.createElement("small");
      date.textContent = article.publishedAt
        ? new Date(article.publishedAt).toLocaleString()
        : "";

      card.append(sourceRow, title, description, date);

      if (article.url) {
        try {
          const url = new URL(article.url);

          if (url.protocol === "https:" || url.protocol === "http:") {
            const link = document.createElement("a");
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "news-read-btn";
            link.textContent = "Read article";
            card.appendChild(link);
          }
        } catch {
          // Skip invalid article links.
        }
      }

      grid.appendChild(card);
    });
  } catch (error) {
    console.error("AURA news error:", error);
    grid.replaceChildren();

    const errorMessage = document.createElement("p");
    errorMessage.textContent = error.message ||
      "Could not load news. Please try again.";

    grid.appendChild(errorMessage);

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", () => loadNews(category));
    grid.appendChild(retryButton);
  }
}


/* ---------- 9. Settings ---------- */

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);

  if (!raw) return;

  try {
    settings = {
      ...settings,
      ...JSON.parse(raw),
    };
  } catch {
    // Keep defaults if saved settings are invalid.
  }
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify(settings)
  );
}

function applySettings() {
  document.body.classList.toggle(
    "light-mode",
    !settings.darkMode
  );

  const dark = document.getElementById("toggle-dark-mode");
  const notifications = document.getElementById("toggle-notifications");
  const voice = document.getElementById("toggle-voice");
  const mic = document.getElementById("mic-btn");

  if (dark) dark.checked = settings.darkMode;
  if (notifications) notifications.checked = settings.notifications;
  if (voice) voice.checked = settings.voice;

  if (mic) {
    mic.classList.toggle("mic-active", settings.voice);
  }
}

function setupSettingsControls() {
  const dark = document.getElementById("toggle-dark-mode");
  const notifications = document.getElementById("toggle-notifications");
  const voice = document.getElementById("toggle-voice");
  const clear = document.getElementById("clear-history-btn");

  if (dark) {
    dark.addEventListener("change", (event) => {
      settings.darkMode = event.target.checked;
      saveSettings();
      applySettings();
    });
  }

  if (notifications) {
    notifications.addEventListener("change", (event) => {
      settings.notifications = event.target.checked;

      if (
        settings.notifications &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        Notification.requestPermission();
      }

      saveSettings();
    });
  }

  if (voice) {
    voice.addEventListener("change", (event) => {
      settings.voice = event.target.checked;
      saveSettings();
      applySettings();
    });
  }

  if (clear) {
    clear.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Delete all saved conversations? This can't be undone."
      );

      if (!confirmed) return;

      localStorage.removeItem(STORAGE_KEYS.conversations);

      renderHistoryList();
      startNewChat();
      switchView("chat");

      showToast("All chat history cleared.");
    });
  }
}

function maybeShowBrowserNotification(replyText) {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  new Notification("AURA replied", {
    body: replyText.slice(0, 120),
  });
}

/* ---------- 10. Small helpers ---------- */

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";

  textarea.style.height =
    `${Math.min(textarea.scrollHeight, 160)}px`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return `Today · ${formatTimestamp(timestamp)}`;
  }

  return (
    `${date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    })} · ${formatTimestamp(timestamp)}`
  );
}

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

let toastTimeoutId = null;

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("visible");

  clearTimeout(toastTimeoutId);

  toastTimeoutId = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2600);
}

function cleanTextForSpeech(text) {
  return text
    // Remove fenced code blocks
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")

    // Keep link text, remove URL
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

    // Remove headings, blockquotes and list markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")

    // Remove bold, italic and strikethrough markers
    .replace(/\*\*(.*?)\*\*/gs, "$1")
    .replace(/__(.*?)__/gs, "$1")
    .replace(/~~(.*?)~~/gs, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")

    // Remove inline code markers and HTML tags
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]*>/g, "")

    // Clean excess whitespace
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

let currentAudio = null;
let currentAudioUrl = null;
let currentSpeechButton = null;
let speechRequestController = null;

function stopSpeaking() {
  if (speechRequestController) {
    speechRequestController.abort();
    speechRequestController = null;
  }

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  if (currentSpeechButton) {
    currentSpeechButton.textContent = "🔊";
    currentSpeechButton.title = "Listen to this reply";
    currentSpeechButton.setAttribute(
      "aria-label",
      "Listen to this reply"
    );
    currentSpeechButton = null;
  }
}

async function speakReply(text, button) {
  stopSpeaking();

  const cleanText = cleanTextForSpeech(text);
  if (!cleanText) return;

  currentSpeechButton = button;
  speechRequestController = new AbortController();

  button.textContent = "⏹";
  button.title = "Stop speaking";
  button.setAttribute("aria-label", "Stop speaking");

  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: cleanText }),
      signal: speechRequestController.signal
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Speech request failed.");
    }

    const audioBlob = await response.blob();

    // The user may have stopped while the server was generating audio.
    if (!speechRequestController) return;

    speechRequestController = null;
    currentAudioUrl = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(currentAudioUrl);

    const audio = currentAudio;

    const resetPlayback = () => {
      if (currentAudio !== audio) return;

      currentAudio = null;

      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
      }

      if (currentSpeechButton) {
        currentSpeechButton.textContent = "🔊";
        currentSpeechButton.title = "Listen to this reply";
        currentSpeechButton.setAttribute(
          "aria-label",
          "Listen to this reply"
        );
        currentSpeechButton = null;
      }
    };

    audio.addEventListener("ended", resetPlayback, { once: true });
    audio.addEventListener("error", resetPlayback, { once: true });

    await audio.play();

  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("AURA speech error:", error);
      showToast("Could not play AURA's voice.");
    }

    stopSpeaking();
  }
}