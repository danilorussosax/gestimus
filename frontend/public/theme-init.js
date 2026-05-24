// Pre-React: applica il tema corrente al <html> per evitare FOUC durante il
// caricamento di React. Estratto da index.html in file separato per essere
// compatibile con `script-src 'self'` della Content-Security-Policy.
(function () {
  try {
    var stored = localStorage.getItem('conservatory_theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((stored === null || stored === 'system') && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
