import { streamGemini } from './lib/gemini.js';
import { streamOpenRouter } from './lib/openrouter.js';
import { streamChatGPTWeb, checkChatGPTLogin } from './lib/chatgpt-web.js';
import { DEFAULT_SYSTEM_PROMPT } from './lib/prompts.js';

globalThis.__chatgptWebRequests = globalThis.__chatgptWebRequests || new Map();

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const existing = await chrome.storage.local.get(['systemPrompt']);
  if (!existing.systemPrompt) {
    await chrome.storage.local.set({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
  }
  chrome.contextMenus.create({
    id: 'send-selection',
    title: 'שלח ל-AI Agent',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'send-selection' && tab?.id) {
    await chrome.storage.local.set({
      pendingSelection: info.selectionText,
      pendingTabId: tab.id
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chat-stream') return;
  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'SEND_MESSAGE') return;

    try {
      const settings = await chrome.storage.local.get([
        'geminiKey', 'openrouterKey', 'systemPrompt'
      ]);

      let apiMessages = [...msg.messages];

      if (msg.files?.length) {
        const fileContext = msg.files.map(f =>
          `--- קובץ: ${f.name} (${f.type || 'unknown'}) ---\n${f.content}`
        ).join('\n\n');
        apiMessages[apiMessages.length - 1].content += '\n\n[קבצים מצורפים]\n' + fileContext;
      }

      const onChunk = (text) => {
        if (aborted) return;
        try { port.postMessage({ type: 'CHUNK', text }); } catch {}
      };

      const systemPrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

      if (msg.provider === 'gemini') {
        if (!settings.geminiKey) throw new Error('חסר Gemini API Key בהגדרות');
        await streamGemini({
          apiKey: settings.geminiKey,
          model: msg.model || 'gemini-2.5-flash',
          messages: apiMessages,
          systemPrompt,
          onChunk
        });
      } else if (msg.provider === 'openrouter') {
        if (!settings.openrouterKey) throw new Error('חסר OpenRouter API Key בהגדרות');
        await streamOpenRouter({
          apiKey: settings.openrouterKey,
          model: msg.model || 'openrouter/free',
          messages: apiMessages,
          systemPrompt,
          onChunk
        });
      } else if (msg.provider === 'chatgpt-web') {
        await streamChatGPTWeb({ messages: apiMessages, onChunk });
      } else {
        throw new Error('ספק לא מוכר: ' + msg.provider);
      }

      if (!aborted) port.postMessage({ type: 'DONE' });
    } catch (error) {
      console.error('[Agent]', error);
      if (!aborted) port.postMessage({ type: 'ERROR', error: error.message || String(error) });
    }
  });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function safeSendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) {
      throw new Error('לא ניתן לתקשר עם הדף (דפי chrome:// חסומים)');
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'CHATGPT_WEB_CHUNK') {
        const req = globalThis.__chatgptWebRequests?.get(msg.requestId);
        if (req?.onChunk) { try { req.onChunk(msg.text); } catch {} }
        sendResponse({ ok: true }); return;
      }
      if (msg.type === 'CHATGPT_WEB_LOGIN_STATE') {
        chrome.storage.local.set({ chatgptWebLoggedIn: msg.loggedIn });
        sendResponse({ ok: true }); return;
      }
      if (msg.type === 'CHECK_CHATGPT_LOGIN') {
        const loggedIn = await checkChatGPTLogin();
        sendResponse({ ok: true, loggedIn }); return;
      }
      if (msg.type === 'GET_PAGE_CONTENT') {
        const tab = await getActiveTab();
        if (!tab?.id) throw new Error('אין טאב פעיל');
        const data = await safeSendToTab(tab.id, { type: 'GET_PAGE_CONTENT' });
        sendResponse({ ok: true, data: { ...data, tabId: tab.id } }); return;
      }
      if (msg.type === 'GET_SELECTION') {
        const tab = await getActiveTab();
        if (!tab?.id) throw new Error('אין טאב פעיל');
        const data = await safeSendToTab(tab.id, { type: 'GET_SELECTION' });
        sendResponse({ ok: true, data }); return;
      }
      if (msg.type === 'EXECUTE_ACTION') {
        const tab = await getActiveTab();
        if (!tab?.id) throw new Error('אין טאב פעיל');
        const data = await safeSendToTab(tab.id, { type: 'EXECUTE_ACTION', action: msg.action });
        sendResponse({ ok: true, data }); return;
      }
      if (msg.type === 'NAVIGATE') {
        const tab = await getActiveTab();
        await chrome.tabs.update(tab.id, { url: msg.url });
        sendResponse({ ok: true }); return;
      }
      if (msg.type === 'LIST_TABS') {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        sendResponse({
          ok: true,
          data: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }))
        });
        return;
      }
      if (msg.type === 'SCREENSHOT') {
        const tab = await getActiveTab();
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        sendResponse({ ok: true, data: dataUrl }); return;
      }
      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SELECTION_CHANGED' && sender.tab) {
    chrome.storage.local.set({
      lastSelection: msg.text,
      lastSelectionTabId: sender.tab.id
    });
  }
});