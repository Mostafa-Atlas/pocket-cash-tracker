// Run before the stylesheet to avoid a dark flash when a saved light theme is selected.
(() => {
  function apply(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f7f5' : '#101414');
  }
  try { apply(localStorage.getItem('pocket-theme')); } catch { apply('dark'); }
  window.addEventListener('storage', event => {
    if (event.key === 'pocket-theme' || event.key === null) { apply(event.newValue); window.dispatchEvent(new Event('pocket-theme-change')); }
  });
})();
