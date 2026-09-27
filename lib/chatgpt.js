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

/** Prefer the tab the user already has open on chatgpt.com */
async function ensureTab() {
  const all = await chrome.tabs.query({ url: MATCH });
  if (all.length) {
    const active = all.find((t) => t.active) || all[0];
    return active.id;
  }
  const created = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
  await waitLoad(created.id);
  await sleep(2000);
  return created.id;
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
          'button[data-testid="login-button"], a[href*="/auth/login"], button[data-testid="login-button"]'
        );
        return hasComposer && !loginBtn;
      }
    });
    return r?.result === true;
  } catch {
    return false;
  }
}

/**
 * Drive ChatGPT web UI: type prompt, click send, poll for assistant reply.
 * Hard timeout so the side panel never spins forever.
 */
export async function streamChatGPT({ messages, onChunk, requestId }) {
  const id = await ensureTab();

  const loggedIn = await checkLogin();
  if (!loggedIn) {
    throw new Error(
      'לא מחובר ל-ChatGPT. פתח chatgpt.com, התחבר (אפשר עם Google), ואז נסה שוב.'
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

      // Clear + insert text
      if (box.tagName === 'TEXTAREA') {
        const desc = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        );
        if (desc?.set) desc.set.call(box, text);
        else box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // contenteditable / ProseMirror
        box.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(box);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        // Prefer insertText for React controlled inputs
        const ok = document.execCommand('insertText', false, text);
        if (!ok) {
          box.textContent = text;
        }
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

      if (send && !send.disabled) {
        send.click();
      } else {
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
        document.querySelectorAll(
          '[data-message-author-role="assistant"], [data-testid*="assistant"], div[class*="agent-turn"]'
        ).length;

      const readLastAssistant = () => {
        const nodes = document.querySelectorAll(
          '[data-message-author-role="assistant"]'
        );
        if (nodes.length) {
          const n = nodes[nodes.length - 1];
          return (n.innerText || n.textContent || '').trim();
        }
        // Fallback: last markdown prose block in conversation
        const articles = document.querySelectorAll(
          'article, [data-testid="conversation-turn-3"], div[data-message-id]'
        );
        if (articles.length) {
          const last = articles[articles.length - 1];
          return (last.innerText || '').trim();
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
          'button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="עצור"]'
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
            'ChatGPT לא החזיר תשובה בזמן. ודא שהטאב פתוח, שאתה מחובר, ונסה שוב.'
        };
      }
      return { ok: true, text: lastText };
    }
  });

  const result = inj?.result;
  if (!result?.ok) {
    throw new Error(result?.error || 'שגיאה ב-ChatGPT Web');
  }
  if (result.text) onChunk?.(result.text);
}
