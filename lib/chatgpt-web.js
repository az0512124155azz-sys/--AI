const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
let activeChatGPTTabId = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

async function ensureChatGPTTab() {
  if (activeChatGPTTabId) {
    try {
      const tab = await chrome.tabs.get(activeChatGPTTabId);
      if (tab && tab.url && /chatgpt\.com|chat\.openai\.com/.test(tab.url)) {
        return tab.id;
      }
    } catch { activeChatGPTTabId = null; }
  }

  const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
  if (tabs.length > 0) {
    activeChatGPTTabId = tabs[0].id;
    return tabs[0].id;
  }

  const newTab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: false });
  activeChatGPTTabId = newTab.id;
  await waitForTabLoad(newTab.id);
  await sleep(2500);
  return newTab.id;
}

export async function checkChatGPTLogin() {
  try {
    const tabId = await ensureChatGPTTab();
    const res = await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_WEB_PING' });
    return res?.loggedIn === true;
  } catch { return false; }
}

export async function streamChatGPTWeb({ messages, onChunk }) {
  const tabId = await ensureChatGPTTab();
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) throw new Error('אין הודעת משתמש לשלוח');

  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  globalThis.__chatgptWebRequests = globalThis.__chatgptWebRequests || new Map();
  globalThis.__chatgptWebRequests.set(requestId, { onChunk });

  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'CHATGPT_WEB_SEND',
      text: lastUser.content,
      requestId
    });
    if (!result?.ok) throw new Error(result?.error || 'שגיאה בשליחה ל-ChatGPT');
    return result.text;
  } finally {
    globalThis.__chatgptWebRequests.delete(requestId);
  }
}

export async function newChatGPTConversation() {
  const tabId = await ensureChatGPTTab();
  await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_WEB_NEW_CHAT' });
}