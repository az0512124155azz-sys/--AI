const MATCH = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
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
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      resolve();
    }, 15000);
  });
}

async function getStoredWorkspace() {
  const s = await chrome.storage.local.get(['cgptWindowId', 'cgptTabId']);
  return { windowId: s.cgptWindowId || null, tabId: s.cgptTabId || null };
}

async function setStoredWorkspace(windowId, tabId) {
  await chrome.storage.local.set({ cgptWindowId: windowId || null, cgptTabId: tabId || null });
}

/**
 * Open (or focus) a dedicated popup window with chatgpt.com.
 * Closest thing to an embedded "Chrome with GPT" — real browser, not iframe.
 */
export async function openChatGPTWorkspace() {
  const stored = await getStoredWorkspace();

  if (stored.windowId) {
    try {
      await chrome.windows.get(stored.windowId);
      if (stored.tabId) {
        try {
          const t = await chrome.tabs.get(stored.tabId);
          if (t?.url && (t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com'))) {
            await chrome.windows.update(stored.windowId, { focused: true });
            await chrome.tabs.update(stored.tabId, { active: true });
            return { windowId: stored.windowId, tabId: stored.tabId };
          }
        } catch {}
      }
      const tabs = await chrome.tabs.query({ windowId: stored.windowId });
      const cg = tabs.find((t) => t.url && (t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com')));
      if (cg) {
        await setStoredWorkspace(stored.windowId, cg.id);
        await chrome.windows.update(stored.windowId, { focused: true });
        await chrome.tabs.update(cg.id, { active: true });
        return { windowId: stored.windowId, tabId: cg.id };
      }
    } catch {
      await setStoredWorkspace(null, null);
    }
  }

  // Reuse any existing chatgpt tab in a popup-style window if present
  const existing = await chrome.tabs.query({ url: MATCH });
  if (existing.length) {
    const t = existing[0];
    try {
      await chrome.windows.update(t.windowId, { focused: true });
      await chrome.tabs.update(t.id, { active: true });
      await setStoredWorkspace(t.windowId, t.id);
      return { windowId: t.windowId, tabId: t.id };
    } catch {}
  }

  const win = await chrome.windows.create({
    url: 'https://chatgpt.com/',
    type: 'popup',
    width: 980,
    height: 720,
    focused: true
  });
  const tabId = win.tabs?.[0]?.id;
  if (tabId) {
    await waitLoad(tabId);
    await sleep(1500);
  }
  await setStoredWorkspace(win.id, tabId || null);
  return { windowId: win.id, tabId: tabId || null };
}

/** Prefer dedicated workspace tab, then any chatgpt tab, else create one */
async function ensureTab() {
  const stored = await getStoredWorkspace();
  if (stored.tabId) {
    try {
      const t = await chrome.tabs.get(stored.tabId);
      if (t?.url && (t.url.includes('chatgpt.com') || t.url.includes('chat.openai.com'))) {
        return t.id;
      }
    } catch {
      await setStoredWorkspace(null, null);
    }
  }

  const all = await chrome.tabs.query({ url: MATCH });
  if (all.length) {
    const preferred = all.find((t) => t.id === stored.tabId) || all.find((t) => t.active) || all[0];
    await setStoredWorkspace(preferred.windowId, preferred.id);
    return preferred.id;
  }

  const { tabId } = await openChatGPTWorkspace();
  if (!tabId) throw new Error('לא הצלחתי לפתוח חלון ChatGPT');
  return tabId;
}

export async function checkLogin() {
  try {
    const id = await ensureTab();
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const hasComposer =
          !!document.querySelector('#prompt-textarea') ||
          !!document.querySelector('[data-testid="prompt-textarea"]') ||
          !!document.querySelector('div.ProseMirror[contenteditable="true"]') ||
          !!document.querySelector('div[contenteditable="true"]');
        const loginBtn = document.querySelector(
          'button[data-testid="login-button"], a[href*="/auth/login"]'
        );
        return hasComposer && !loginBtn;
      }
    });
    return r?.result === true;
  } catch {
    return false;
  }
}

export async function streamChatGPT({ messages, onChunk }) {
  const id = await ensureTab();

  const loggedIn = await checkLogin();
  if (!loggedIn) {
    await openChatGPTWorkspace();
    throw new Error(
      'לא מחובר ל-ChatGPT. התחבר בחלון שנפתח (אפשר עם Google), ואז שלח שוב.'
    );
  }

  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) throw new Error('אין הודעת משתמש');

  let prompt = last.content;
  const cut = prompt.indexOf('\n\n[הקשר דף נוכחי]');
  if (cut > 0 && prompt.length > 3500) prompt = prompt.slice(0, cut);
  if (prompt.length > 10000) prompt = prompt.slice(0, 10000) + '\n…';

  const [inj] = await chrome.scripting.executeScript({
    target: { tabId: id },
    args: [prompt],
    func: async (text) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const findBox = () =>
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('div.ProseMirror[contenteditable="true"]') ||
        document.querySelector('form div[contenteditable="true"]') ||
        document.querySelector('div[contenteditable="true"]');

      let box = findBox();
      for (let i = 0; i < 8 && !box; i++) {
        await sleep(400);
        box = findBox();
      }
      if (!box) return { ok: false, error: 'לא נמצא שדה הקלדה ב-ChatGPT' };

      box.focus();
      await sleep(100);

      if (box.tagName === 'TEXTAREA') {
        const desc = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        );
        if (desc?.set) desc.set.call(box, text);
        else box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        box.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(box);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        const ok = document.execCommand('insertText', false, text);
        if (!ok) box.textContent = text;
        box.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
          })
        );
      }

      await sleep(400);

      const findSend = () =>
        document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[data-testid="fruitjuice-send-button"]') ||
        document.querySelector('button[aria-label="Send message"]') ||
        document.querySelector('button[aria-label*="Send" i]') ||
        Array.from(document.querySelectorAll('form button, main button')).find(
          (b) =>
            !b.disabled &&
            b.querySelector('svg') &&
            !/stop|cancel|attach|upload|photo|voice|mic/i.test(
              (b.getAttribute('aria-label') || '') + (b.getAttribute('data-testid') || '')
            )
        );

      let send = findSend();
      for (let i = 0; i < 6 && (!send || send.disabled); i++) {
        await sleep(300);
        send = findSend();
      }

      if (send && !send.disabled) send.click();
      else {
        box.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
          })
        );
      }

      const countAssistant = () =>
        document.querySelectorAll('[data-message-author-role="assistant"]').length;

      const readLastAssistant = () => {
        const nodes = document.querySelectorAll(
          '[data-message-author-role="assistant"]'
        );
        if (nodes.length) {
          const n = nodes[nodes.length - 1];
          return (n.innerText || n.textContent || '').trim();
        }
        const articles = document.querySelectorAll('article, div[data-message-id]');
        if (articles.length) {
          return (articles[articles.length - 1].innerText || '').trim();
        }
        return '';
      };

      const before = countAssistant();
      let lastText = '';
      let stable = 0;
      const start = Date.now();
      const LIMIT = 55000;

      while (Date.now() - start < LIMIT) {
        await sleep(400);
        const after = countAssistant();
        const cur = readLastAssistant();
        const stopping = document.querySelector(
          'button[data-testid="stop-button"], button[aria-label*="Stop" i]'
        );

        if (cur && cur !== lastText && (after > before || lastText === '')) {
          lastText = cur;
          stable = 0;
        } else if (cur && cur === lastText) {
          stable++;
          if (!stopping && stable >= 6) break;
        }
      }

      if (!lastText) {
        return {
          ok: false,
          error:
            'ChatGPT לא החזיר תשובה בזמן. ודא שהחלון פתוח ומחובר, ונסה שוב.'
        };
      }
      return { ok: true, text: lastText };
    }
  });

  const result = inj?.result;
  if (!result?.ok) throw new Error(result?.error || 'שגיאה ב-ChatGPT Web');
  if (result.text) onChunk?.(result.text);
}
