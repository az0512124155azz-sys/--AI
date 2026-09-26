(() => {
  if (window.__aiAgentContentLoaded) return;
  window.__aiAgentContentLoaded = true;

  let lastSelection = '';
  document.addEventListener('selectionchange', () => {
    const text = window.getSelection()?.toString().trim() || '';
    if (text && text !== lastSelection) {
      lastSelection = text;
      chrome.runtime.sendMessage({ type: 'SELECTION_CHANGED', text }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      switch (msg.type) {
        case 'GET_PAGE_CONTENT':
          sendResponse(getPageContent());
          break;
        case 'GET_SELECTION':
          sendResponse({
            text: window.getSelection()?.toString().trim() || '',
            url: location.href,
            title: document.title
          });
          break;
        case 'EXECUTE_ACTION':
          sendResponse(executeAction(msg.action));
          break;
        default:
          sendResponse({ error: 'Unknown message' });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
    return true;
  });

  function getPageContent() {
    const clone = document.body?.cloneNode(true);
    if (clone) {
      clone.querySelectorAll('script,style,noscript,svg,iframe').forEach(n => n.remove());
    }
    const text = (clone?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 40000);
    return {
      url: location.href,
      title: document.title,
      text,
      selection: window.getSelection()?.toString().trim() || '',
      headings: Array.from(document.querySelectorAll('h1,h2,h3'))
        .slice(0, 30)
        .map(h => ({ level: h.tagName, text: h.innerText.trim() }))
        .filter(h => h.text),
      links: Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 100)
        .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
        .filter(l => l.text)
    };
  }

  function executeAction(action) {
    if (!action || !action.type) return { error: 'no action' };
    switch (action.type) {
      case 'click': {
        const el = document.querySelector(action.selector);
        if (!el) return { error: 'element not found: ' + action.selector };
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.click();
        return { ok: true, clicked: action.selector };
      }
      case 'type': {
        const el = document.querySelector(action.selector);
        if (!el) return { error: 'element not found: ' + action.selector };
        el.focus();
        if (el.isContentEditable) {
          el.innerText = action.text;
        } else {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;
          if (setter) setter.call(el, action.text);
          else el.value = action.text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, typed: action.text };
      }
      case 'scroll': {
        window.scrollBy({ top: action.amount || 500, behavior: 'smooth' });
        return { ok: true };
      }
      case 'extract': {
        const els = document.querySelectorAll(action.selector);
        return {
          ok: true,
          items: Array.from(els).slice(0, 200).map(e => ({
            text: e.innerText?.trim() || '',
            href: e.href || null
          }))
        };
      }
      case 'highlight': {
        document.querySelectorAll(action.selector).forEach(el => {
          el.style.outline = '3px solid #4285f4';
          el.style.outlineOffset = '2px';
          setTimeout(() => {
            el.style.outline = '';
            el.style.outlineOffset = '';
          }, 2000);
        });
        return { ok: true };
      }
      default:
        return { error: 'unknown action: ' + action.type };
    }
  }
})();