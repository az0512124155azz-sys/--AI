import { streamGemini, listGeminiModels } from './lib/gemini.js';
import { streamOpenRouter, listOpenRouterModels } from './lib/openrouter.js';
import { streamChatGPT, checkLogin } from './lib/chatgpt.js';
import { SYSTEM_PROMPT } from './lib/prompts.js';

globalThis.__cgpt = globalThis.__cgpt || new Map();

chrome.runtime.onInstalled.addListener(async () => {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch {}
  const s = await chrome.storage.local.get('systemPrompt');
  if (!s.systemPrompt) await chrome.storage.local.set({ systemPrompt: SYSTEM_PROMPT });
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'aba-sel', title: 'שלח ל-AI Agent', contexts: ['selection'] });
  } catch {}
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'aba-sel' || !tab?.id) return;
  await chrome.storage.local.set({ pendingSelection: info.selectionText || '', lastSelection: info.selectionText || '' });
  try { await chrome.sidePanel.open({ tabId: tab.id }); }
  catch { try { await chrome.sidePanel.open({ windowId: tab.windowId }); } catch {} }
});

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function toTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
    await new Promise((r) => setTimeout(r, 250));
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'stream') return;
  let stop = false;
  port.onDisconnect.addListener(() => { stop = true; });
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'CHAT') return;
    try {
      const settings = await chrome.storage.local.get(['geminiKey', 'openrouterKey', 'systemPrompt']);
      let messages = msg.messages.map((m) => ({ role: m.role, content: m.content }));
      if (msg.withPage && msg.provider !== 'chatgpt') {
        try {
          const tab = await activeTab();
          if (tab?.id && !tab.url?.startsWith('chrome://') && !tab.url?.startsWith('chrome-extension://')) {
            const page = await toTab(tab.id, { type: 'PAGE' });
            if (page?.text) {
              const ctx = ['[הקשר דף נוכחי]', `כותרת: ${page.title || ''}`, `URL: ${page.url || ''}`,
                page.selection ? `טקסט מסומן: ${page.selection.slice(0, 2000)}` : '',
                `תוכן:\n${page.text.slice(0, 10000)}`].filter(Boolean).join('\n');
              const last = messages[messages.length - 1];
              if (last) last.content += '\n\n' + ctx;
            }
          }
        } catch (e) { console.warn('page ctx', e); }
      }
      if (msg.files?.length) {
        const block = msg.files.map((f) => `--- ${f.name} (${f.type || ''}) ---\n${String(f.content).slice(0, 30000)}`).join('\n\n');
        const last = messages[messages.length - 1];
        if (last) last.content += '\n\n[קבצים]\n' + block;
      }
      const onChunk = (text) => { if (stop) return; try { port.postMessage({ type: 'CHUNK', text }); } catch {} };
      const sys = settings.systemPrompt || SYSTEM_PROMPT;
      const rid = msg.requestId || 'r' + Date.now();
      if (msg.provider === 'gemini') {
        if (!settings.geminiKey) throw new Error('חסר Gemini API Key');
        await streamGemini({ apiKey: settings.geminiKey, model: msg.model || 'gemini-2.5-flash', messages, systemPrompt: sys, onChunk });
      } else if (msg.provider === 'openrouter') {
        if (!settings.openrouterKey) throw new Error('חסר OpenRouter API Key');
        await streamOpenRouter({ apiKey: settings.openrouterKey, model: msg.model || 'openrouter/free', messages, systemPrompt: sys, onChunk });
      } else if (msg.provider === 'chatgpt') {
        await streamChatGPT({ messages, onChunk, requestId: rid });
      } else throw new Error('ספק לא מוכר');
      if (!stop) try { port.postMessage({ type: 'DONE' }); } catch {}
    } catch (err) {
      console.error(err);
      if (!stop) try { port.postMessage({ type: 'ERROR', error: err.message || String(err) }); } catch {}
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'CGPT_CHUNK') { globalThis.__cgpt?.get(msg.requestId)?.onChunk?.(msg.text); reply({ ok: true }); return; }
      if (msg.type === 'CGPT_LOGIN') { await chrome.storage.local.set({ chatgptLoggedIn: !!msg.loggedIn }); reply({ ok: true }); return; }
      if (msg.type === 'CHECK_CGPT') { reply({ ok: true, loggedIn: await checkLogin() }); return; }
      if (msg.type === 'LIST_GEMINI') {
        const s = await chrome.storage.local.get('geminiKey');
        reply({ ok: true, models: s.geminiKey ? await listGeminiModels(s.geminiKey) : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] });
        return;
      }
      if (msg.type === 'LIST_OR') {
        const s = await chrome.storage.local.get('openrouterKey');
        reply({ ok: true, models: await listOpenRouterModels(s.openrouterKey || '') });
        return;
      }
      if (msg.type === 'PAGE') {
        const tab = await activeTab();
        if (!tab?.id) throw new Error('אין טאב');
        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) throw new Error('דפי מערכת לא נתמכים');
        reply({ ok: true, data: await toTab(tab.id, { type: 'PAGE' }) });
        return;
      }
      if (msg.type === 'ACTION') {
        const tab = await activeTab();
        if (!tab?.id) throw new Error('אין טאב');
        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) throw new Error('דפי מערכת לא נתמכים');
        reply({ ok: true, data: await toTab(tab.id, { type: 'ACTION', action: msg.action }) });
        return;
      }
      if (msg.type === 'NAVIGATE') {
        const tab = await activeTab();
        if (!tab?.id) throw new Error('אין טאב');
        await chrome.tabs.update(tab.id, { url: msg.url });
        reply({ ok: true });
        return;
      }
      if (msg.type === 'TABS') {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        reply({ ok: true, data: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })) });
        return;
      }
      if (msg.type === 'SHOT') {
        const tab = await activeTab();
        if (!tab) throw new Error('אין טאב');
        reply({ ok: true, data: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) });
        return;
      }
      if (msg.type === 'SELECTION' && sender.tab) {
        await chrome.storage.local.set({ lastSelection: msg.text || '', lastSelectionTabId: sender.tab.id });
        reply({ ok: true });
        return;
      }
      reply({ ok: false, error: 'unknown' });
    } catch (e) { reply({ ok: false, error: e.message || String(e) }); }
  })();
  return true;
});
