(() => {
  if (window.__aiAgentChatGPTWebLoaded) return;
  window.__aiAgentChatGPTWebLoaded = true;

  const SELECTORS = {
    input: [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"].ProseMirror',
      'textarea[placeholder*="Message"]'
    ],
    sendButton: [
      '[data-testid="send-button"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="שלח"]'
    ],
    stopButton: [
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="עצור"]'
    ],
    assistantMessage: ['[data-message-author-role="assistant"]'],
    loginButton: [
      'button[data-testid="login-button"]',
      'a[href*="/auth/login"]'
    ]
  };

  function queryFirst(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isLoggedIn() {
    const input = queryFirst(SELECTORS.input);
    const login = queryFirst(SELECTORS.loginButton);
    return !!input && !login;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setInputValue(el, text) {
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.focus();
      el.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
  }

  function waitForNewAssistantMessage() {
    return new Promise((resolve, reject) => {
      const existing = document.querySelectorAll(SELECTORS.assistantMessage[0]);
      const existingCount = existing.length;

      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error('פסק זמן: ChatGPT לא הגיב תוך 120 שניות'));
      }, 120000);

      const observer = new MutationObserver(() => {
        const all = document.querySelectorAll(SELECTORS.assistantMessage[0]);
        if (all.length > existingCount) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve(all[all.length - 1]);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function streamResponse(requestId) {
    return new Promise(async (resolve, reject) => {
      let responseEl;
      try {
        responseEl = await waitForNewAssistantMessage();
      } catch (e) { reject(e); return; }

      let lastText = '';
      const sendChunk = (delta) => {
        chrome.runtime.sendMessage({
          type: 'CHATGPT_WEB_CHUNK',
          requestId,
          text: delta
        }).catch(() => {});
      };

      const tick = () => {
        const current = responseEl.innerText || '';
        if (current !== lastText) {
          const delta = current.slice(lastText.length);
          lastText = current;
          sendChunk(delta);
        }
      };

      const observer = new MutationObserver(tick);
      observer.observe(responseEl, {
        childList: true, subtree: true, characterData: true
      });

      const doneCheck = setInterval(() => {
        const stop = queryFirst(SELECTORS.stopButton);
        if (!stop) {
          setTimeout(() => {
            tick();
            clearInterval(doneCheck);
            observer.disconnect();
            resolve({ text: lastText });
          }, 800);
        }
      }, 500);

      setTimeout(() => {
        clearInterval(doneCheck);
        observer.disconnect();
        resolve({ text: lastText });
      }, 180000);
    });
  }

  async function sendToChatGPT(text, requestId) {
    const input = queryFirst(SELECTORS.input);
    if (!input) throw new Error('לא נמצא שדה הקלט של ChatGPT. ודא שאתה מחובר.');

    setInputValue(input, text);
    await sleep(150);

    const sendBtn = queryFirst(SELECTORS.sendButton);
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
    }

    return await streamResponse(requestId);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHATGPT_WEB_PING') {
      sendResponse({ ok: true, loggedIn: isLoggedIn() });
      return true;
    }
    if (msg.type === 'CHATGPT_WEB_SEND') {
      sendToChatGPT(msg.text, msg.requestId)
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === 'CHATGPT_WEB_NEW_CHAT') {
      const newChatBtn = document.querySelector(
        '[data-testid="create-new-chat-button"], a[href="/"]'
      );
      if (newChatBtn) newChatBtn.click();
      sendResponse({ ok: true });
      return true;
    }
  });

  let lastLoginState = null;
  setInterval(() => {
    const state = isLoggedIn();
    if (state !== lastLoginState) {
      lastLoginState = state;
      chrome.runtime.sendMessage({
        type: 'CHATGPT_WEB_LOGIN_STATE',
        loggedIn: state
      }).catch(() => {});
    }
  }, 3000);

  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'CHATGPT_WEB_LOGIN_STATE',
      loggedIn: isLoggedIn()
    }).catch(() => {});
  }, 1000);
})();