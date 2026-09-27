(() => {
  if (window.__abaLoaded) return;
  window.__abaLoaded = true;
  let lastSel = '';
  let timer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const t = window.getSelection()?.toString().trim() || '';
      if (t && t !== lastSel) {
        lastSel = t;
        chrome.runtime.sendMessage({ type: 'SELECTION', text: t }).catch(() => {});
      } else if (!t) lastSel = '';
    }, 200);
  });
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    try {
      if (msg.type === 'PAGE') reply(readPage());
      else if (msg.type === 'SELECTION_GET') {
        reply({ text: window.getSelection()?.toString().trim() || '', url: location.href, title: document.title });
      } else if (msg.type === 'ACTION') reply(runAction(msg.action));
      else reply({ error: 'unknown' });
    } catch (e) { reply({ error: e.message }); }
    return true;
  });
  function readPage() {
    let text = '';
    try {
      const c = document.body?.cloneNode(true);
      if (c) {
        c.querySelectorAll('script,style,noscript,svg,iframe,canvas,template,[aria-hidden="true"]').forEach(n => n.remove());
        text = (c.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
      }
    } catch { text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim(); }
    text = text.slice(0, 45000);
    const headings = [];
    try {
      document.querySelectorAll('h1,h2,h3').forEach((h, i) => {
        if (i >= 40) return;
        const t = h.innerText.trim().slice(0, 200);
        if (t) headings.push({ level: h.tagName, text: t });
      });
    } catch {}
    const links = [];
    try {
      const seen = new Set();
      document.querySelectorAll('a[href]').forEach(a => {
        if (links.length >= 80) return;
        const href = a.href, t = a.innerText.trim().slice(0, 100);
        if (!t || !href.startsWith('http') || seen.has(href)) return;
        seen.add(href);
        links.push({ text: t, href });
      });
    } catch {}
    return { url: location.href, title: document.title, text, selection: window.getSelection()?.toString().trim() || '', headings, links };
  }
  function qs(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch { return null; }
  }
  function setVal(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d?.set) d.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function runAction(action) {
    if (!action?.type) return { error: 'no action' };
    switch (action.type) {
      case 'click': {
        const el = qs(action.selector);
        if (!el) return { error: 'not found: ' + action.selector };
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { el.focus(); } catch {}
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
        return { ok: true, action: 'click' };
      }
      case 'type': {
        const el = qs(action.selector);
        if (!el) return { error: 'not found: ' + action.selector };
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { el.focus(); } catch {}
        const text = action.text ?? '';
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') setVal(el, text);
        else if (el.isContentEditable) {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
        } else return { error: 'not editable' };
        return { ok: true, action: 'type' };
      }
      case 'scroll': {
        const n = Number(action.amount) || 400;
        window.scrollBy({ top: action.direction === 'up' ? -n : n, behavior: 'smooth' });
        return { ok: true, action: 'scroll' };
      }
      case 'extract': {
        const el = qs(action.selector);
        if (!el) return { error: 'not found: ' + action.selector };
        return { ok: true, text: (el.innerText || '').slice(0, 10000), html: (el.outerHTML || '').slice(0, 4000) };
      }
      case 'highlight': {
        const el = qs(action.selector);
        if (!el) return { error: 'not found: ' + action.selector };
        el.classList.add('__aba-hl');
        setTimeout(() => el.classList.remove('__aba-hl'), 2800);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return { ok: true, action: 'highlight' };
      }
      case 'get_page': return { ok: true, data: readPage() };
      default: return { error: 'unknown: ' + action.type };
    }
  }
})();
