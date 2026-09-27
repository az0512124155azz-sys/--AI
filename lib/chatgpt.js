const MATCH = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
let tabId = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitLoad(id) {
  return new Promise((resolve) => {
    const fn = (tid, info) => {
      if (tid === id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, 20000);
  });
}
async function ensureTab() {
  if (tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t?.url && (t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com'))) return tabId;
    } catch {}
    tabId = null;
  }
  const found = await chrome.tabs.query({ url: MATCH });
  if (found.length) { tabId = found[0].id; return tabId; }
  const created = await chrome.tabs.create({ url: 'https://chatgpt.com', active: false });
  tabId = created.id;
  await waitLoad(tabId);
  await sleep(2500);
  return tabId;
}
export async function checkLogin() {
  try {
    const id = await ensureTab();
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const login = !!document.querySelector('button[data-testid="login-button"], a[href*="/auth"]');
        const box = !!document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], div[contenteditable="true"]');
        return box && !login;
      }
    });
    return r?.result === true;
  } catch { return false; }
}
export async function streamChatGPT({ messages, onChunk, requestId }) {
  const id = await ensureTab();
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) throw new Error('אין הודעת משתמש');
  let prompt = last.content;
  const cut = prompt.indexOf('\n\n[הקשר דף נוכחי]');
  if (cut > 0 && prompt.length > 4000) prompt = prompt.slice(0, cut) + '\n\n[הקשר דף הוסר]';
  if (prompt.length > 12000) prompt = prompt.slice(0, 12000) + '\n…';
  let gotChunks = false;
  const wrap = (t) => { gotChunks = true; onChunk?.(t); };
  if (requestId) {
    globalThis.__cgpt = globalThis.__cgpt || new Map();
    globalThis.__cgpt.set(requestId, { onChunk: wrap });
  }
  let result;
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: id },
      world: 'MAIN',
      args: [prompt, requestId || null],
      func: async (text, reqId) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const findBox = () =>
          document.querySelector('#prompt-textarea') ||
          document.querySelector('[data-testid="prompt-textarea"]') ||
          document.querySelector('div[contenteditable="true"]');
        let box = findBox();
        if (!box) { await sleep(1500); box = findBox(); }
        if (!box) return { ok: false, error: 'לא נמצא שדה קלט – התחבר ל-ChatGPT' };
        box.focus();
        await sleep(80);
        if (box.tagName === 'TEXTAREA') {
          const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (desc?.set) desc.set.call(box, text); else box.value = text;
          box.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, text);
          box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
        await sleep(350);
        const send =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label*="Send" i]') ||
          Array.from(document.querySelectorAll('button')).find((b) => !b.disabled && b.querySelector('svg'));
        if (send && !send.disabled) send.click();
        else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        const before = document.querySelectorAll('[data-message-author-role="assistant"]').length;
        let lastText = '';
        let stable = 0;
        const start = Date.now();
        while (Date.now() - start < 90000) {
          await sleep(350);
          const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
          const node = nodes.length > before ? nodes[nodes.length - 1] : nodes[nodes.length - 1];
          if (!node) continue;
          const cur = (node.innerText || '').trim();
          if (cur && cur !== lastText) {
            const delta = cur.slice(lastText.length);
            lastText = cur;
            stable = 0;
            if (reqId && delta) {
              try { chrome.runtime.sendMessage({ type: 'CGPT_CHUNK', requestId: reqId, text: delta }); } catch {}
            }
          } else if (cur) {
            stable++;
            const streaming = document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]');
            if (!streaming && stable >= 5) break;
          }
        }
        return { ok: true, text: lastText };
      }
    });
    result = r?.result;
  } finally {
    if (requestId && globalThis.__cgpt) globalThis.__cgpt.delete(requestId);
  }
  if (!result?.ok) throw new Error(result?.error || 'שגיאה ב-ChatGPT Web');
  if (!gotChunks && result.text) onChunk?.(result.text);
}
