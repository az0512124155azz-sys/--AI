(() => {
  if (window.__abaCgpt) return;
  window.__abaCgpt = true;
  function report() {
    const box = !!document.querySelector('#prompt-textarea,[data-testid="prompt-textarea"],div[contenteditable="true"]');
    const login = !!document.querySelector('button[data-testid="login-button"],a[href*="/auth"]');
    chrome.runtime.sendMessage({ type: 'CGPT_LOGIN', loggedIn: box && !login }).catch(() => {});
  }
  report();
  setInterval(report, 15000);
})();
