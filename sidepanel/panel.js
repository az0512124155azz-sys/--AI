import { DEFAULT_SYSTEM_PROMPT } from '../lib/prompts.js';
import { listGeminiModels } from '../lib/gemini.js';
import { listOpenRouterModels } from '../lib/openrouter.js';

const GEMINI_DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
const OPENROUTER_FALLBACK = [
  'openrouter/free',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free'
];
const CHATGPT_WEB_MODELS = ['auto (הבחירה ב-UI)'];

let state = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  messages: [],
  attachedFiles: [],
  isStreaming: false,
  activePort: null
};

const $ = (id) => document.getElementById(id);
const chatContainer = $('chat-container');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const providerSelect = $('provider-select');
const modelSelect = $('model-select');
const contextBar = $('context-bar');
const contextText = $('context-text');
const filePreview = $('file-preview');
const settingsModal = $('settings-modal');

async function init() {
  await loadSettings();
  await loadHistory();
  await updateModelList();
  await checkPendingSelection();
  bindEvents();
  autoResizeInput();
  messageInput.focus();
}

async function loadSettings() {
  const s = await chrome.storage.local.get([
    'provider', 'model', 'geminiKey', 'openrouterKey', 'systemPrompt'
  ]);
  if (s.provider) state.provider = s.provider;
  if (s.model) state.model = s.model;
  providerSelect.value = state.provider;
  $('gemini-key').value = s.geminiKey || '';
  $('openrouter-key').value = s.openrouterKey || '';
  $('system-prompt').value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

async function saveSettings() {
  await chrome.storage.local.set({
    geminiKey: $('gemini-key').value.trim(),
    openrouterKey: $('openrouter-key').value.trim(),
    systemPrompt: $('system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT
  });
  hideModal();
  await updateModelList();
}

async function updateModelList() {
  modelSelect.innerHTML = '<option>טוען...</option>';
  const s = await chrome.storage.local.get(['geminiKey', 'openrouterKey']);
  let models = [];

  try {
    if (state.provider === 'chatgpt-web') {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'CHECK_CHATGPT_LOGIN' });
        if (!res?.loggedIn) showChatGPTNotLoggedIn();
        else clearChatGPTWarning();
      } catch {}
      models = CHATGPT_WEB_MODELS;
    } else if (state.provider === 'gemini') {
      models = s.geminiKey
        ? await listGeminiModels(s.geminiKey).catch(() => GEMINI_DEFAULT_MODELS)
        : GEMINI_DEFAULT_MODELS;
    } else {
      models = s.openrouterKey
        ? await listOpenRouterModels(s.openrouterKey).catch(() => OPENROUTER_FALLBACK)
        : OPENROUTER_FALLBACK;
    }
  } catch {
    models = state.provider === 'gemini' ? GEMINI_DEFAULT_MODELS : OPENROUTER_FALLBACK;
  }

  if (!models.length) {
    models = state.provider === 'gemini' ? GEMINI_DEFAULT_MODELS :
             state.provider === 'chatgpt-web' ? CHATGPT_WEB_MODELS :
             OPENROUTER_FALLBACK;
  }

  modelSelect.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  });

  const valid = Array.from(modelSelect.options).some(o => o.value === state.model);
  modelSelect.value = valid ? state.model : models[0];
  state.model = modelSelect.value;
}

function showChatGPTNotLoggedIn() {
  const existing = document.getElementById('chatgpt-login-warning');
  if (existing) return;
  const banner = document.createElement('div');
  banner.className = 'message system';
  banner.id = 'chatgpt-login-warning';
  banner.innerHTML = '⚠️ <strong>לא מחובר ל-ChatGPT</strong><br>' +
    'פתח טאב חדש של <a href="https://chatgpt.com" target="_blank">chatgpt.com</a> ' +
    'והתחבר עם החשבון שלך, ואז חזור לכאן.';
  chatContainer.prepend(banner);
}
function clearChatGPTWarning() {
  const w = document.getElementById('chatgpt-login-warning');
  if (w) w.remove();
}

async function loadHistory() {
  const s = await chrome.storage.local.get('chatHistory');
  if (s.chatHistory?.length) {
    state.messages = s.chatHistory;
    chatContainer.innerHTML = '';
    for (const m of state.messages) appendMessage(m.role, m.content, false);
  } else {
    chatContainer.innerHTML = welcomeHTML();
    bindQuickActions();
  }
}

async function saveHistory() {
  await chrome.storage.local.set({ chatHistory: state.messages.slice(-200) });
}

async function clearHistory() {
  state.messages = [];
  state.attachedFiles = [];
  chatContainer.innerHTML = welcomeHTML();
  bindQuickActions();
  await chrome.storage.local.remove('chatHistory');
  await chrome.storage.local.remove(['pendingSelection']);
  contextBar.classList.add('hidden');
  delete contextBar.dataset.fullText;
  updateFilePreview();
}

function welcomeHTML() {
  return `
    <div class="welcome">
      <div class="welcome-icon">&#10022;</div>
      <h2>שלום, איך אני יכול לעזור?</h2>
      <p>אני יכול לקרוא את הדף שלך, לסכם טקסט שסימנת, ללחוץ, להקליד ולנווט.</p>
      <div class="quick-actions">
        <button data-prompt="סכם לי את תוכן הדף הזה">סכם את הדף</button>
        <button data-prompt="מה הטקסט שסימנתי?">מה סימנתי?</button>
        <button data-prompt="תן לי את כל הקישורים בדף">כל הקישורים</button>
        <button data-prompt="פתח טאב חדש עם google.com">פתח גוגל</button>
      </div>
    </div>
  `;
}

function bindQuickActions() {
  chatContainer.querySelectorAll('[data-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value = btn.dataset.prompt;
      handleSend();
    });
  });
}

async function checkPendingSelection() {
  const s = await chrome.storage.local.get([
    'pendingSelection', 'lastSelection', 'lastSelectionTabId'
  ]);
  if (s.pendingSelection) {
    setContext(s.pendingSelection);
    await chrome.storage.local.remove('pendingSelection');
  } else if (s.lastSelection) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === s.lastSelectionTabId) setContext(s.lastSelection);
    } catch {}
  }
}

function setContext(text) {
  contextText.textContent = text.slice(0, 200);
  contextBar.classList.remove('hidden');
  contextBar.dataset.fullText = text;
}

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    try {
      const content = await readFile(file);
      state.attachedFiles.push({ name: file.name, type: file.type, content });
    } catch (err) {
      console.warn('Failed to read', file.name, err);
    }
  }
  e.target.value = '';
  updateFilePreview();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:')) {
        const comma = result.indexOf(',');
        resolve(result.slice(comma + 1));
      } else {
        resolve(result);
      }
    };
    const isText = file.type.startsWith('text/') ||
      /\.(txt|md|json|js|css|html|csv|xml|yml|yaml|log)$/i.test(file.name);
    if (isText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function updateFilePreview() {
  if (!state.attachedFiles.length) {
    filePreview.classList.add('hidden');
    filePreview.innerHTML = '';
    return;
  }
  filePreview.classList.remove('hidden');
  filePreview.innerHTML = '';
  state.attachedFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `<span class="name">📄 ${escapeHtml(f.name)}</span>`;
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.textContent = '✕';
    rm.onclick = () => {
      state.attachedFiles.splice(i, 1);
      updateFilePreview();
    };
    chip.appendChild(rm);
    filePreview.appendChild(chip);
  });
}

function appendMessage(role, content, scroll = true) {
  const welcome = chatContainer.querySelector('.welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = `message ${role}`;
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  if (role === 'assistant') contentEl.innerHTML = renderMarkdown(content);
  else contentEl.textContent = content;
  el.appendChild(contentEl);
  chatContainer.appendChild(el);
  if (scroll) scrollToBottom();
  return el;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

async function handleSend() {
  if (state.isStreaming) return;
  const text = messageInput.value.trim();
  if (!text && !state.attachedFiles.length) return;

  let fullText = text;
  const ctx = contextBar.dataset.fullText;
  if (ctx && !contextBar.classList.contains('hidden')) {
    fullText = `הטקסט שסימנתי: "${ctx}"\n\n${text}`;
  }

  state.messages.push({ role: 'user', content: fullText });
  appendMessage('user', fullText);
  messageInput.value = '';
  messageInput.style.height = 'auto';

  const aiEl = document.createElement('div');
  aiEl.className = 'message assistant';
  const aiContent = document.createElement('div');
  aiContent.className = 'content';
  aiContent.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  aiEl.appendChild(aiContent);
  chatContainer.appendChild(aiEl);
  scrollToBottom();

  state.isStreaming = true;
  sendBtn.disabled = true;

  const port = chrome.runtime.connect({ name: 'chat-stream' });
  state.activePort = port;

  let fullResponse = '';
  let firstChunk = true;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'CHUNK') {
      if (firstChunk) { aiContent.innerHTML = ''; firstChunk = false; }
      fullResponse += msg.text;
      aiContent.innerHTML = renderMarkdown(fullResponse);
      scrollToBottom();
    } else if (msg.type === 'DONE') {
      state.isStreaming = false;
      sendBtn.disabled = false;
      state.activePort = null;
      state.messages.push({ role: 'assistant', content: fullResponse });
      saveHistory();
      try { port.disconnect(); } catch {}
    } else if (msg.type === 'ERROR') {
      aiEl.className = 'message error';
      aiContent.textContent = '⚠ ' + msg.error;
      state.isStreaming = false;
      sendBtn.disabled = false;
      state.activePort = null;
      try { port.disconnect(); } catch {}
    }
  });

  port.onDisconnect.addListener(() => {
    if (state.isStreaming) {
      state.isStreaming = false;
      sendBtn.disabled = false;
      state.activePort = null;
    }
  });

  port.postMessage({
    type: 'SEND_MESSAGE',
    provider: state.provider,
    model: state.model,
    messages: state.messages.filter(m => m.role !== 'system'),
    files: state.attachedFiles
  });

  state.attachedFiles = [];
  updateFilePreview();
  if (ctx) {
    contextBar.classList.add('hidden');
    delete contextBar.dataset.fullText;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = html.split('\n');
  let out = '';
  let inList = null;
  for (const line of lines) {
    const m = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (m) {
      const type = /\d+\./.test(m[1]) ? 'ol' : 'ul';
      if (inList !== type) {
        if (inList) out += `</${inList}>`;
        out += `<${type}>`;
        inList = type;
      }
      out += `<li>${m[2]}</li>`;
    } else {
      if (inList) { out += `</${inList}>`; inList = null; }
      out += line + '\n';
    }
  }
  if (inList) out += `</${inList}>`;
  return out;
}

function bindEvents() {
  sendBtn.addEventListener('click', handleSend);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  providerSelect.addEventListener('change', async () => {
    state.provider = providerSelect.value;
    await chrome.storage.local.set({ provider: state.provider });
    await updateModelList();
    await chrome.storage.local.set({ model: state.model });
  });
  modelSelect.addEventListener('change', async () => {
    state.model = modelSelect.value;
    await chrome.storage.local.set({ model: state.model });
  });
  $('settings-btn').addEventListener('click', () => settingsModal.classList.remove('hidden'));
  $('close-settings').addEventListener('click', hideModal);
  $('save-settings').addEventListener('click', saveSettings);
  $('clear-btn').addEventListener('click', clearHistory);
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', handleFileSelect);
  $('clear-context').addEventListener('click', () => {
    contextBar.classList.add('hidden');
    delete contextBar.dataset.fullText;
  });
  bindQuickActions();
}

function hideModal() { settingsModal.classList.add('hidden'); }

function autoResizeInput() {
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.lastSelection) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id === changes.lastSelectionTabId?.newValue) {
        const text = changes.lastSelection.newValue;
        if (text) setContext(text);
      }
    });
  }
});

init().catch(err => {
  console.error('[Panel init]', err);
  chatContainer.innerHTML = `<div class="message error">שגיאת אתחול: ${err.message}</div>`;
});