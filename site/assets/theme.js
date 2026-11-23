// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var root = document.documentElement;
  var pref = root.getAttribute('data-theme-pref') || 'auto';
  if (pref !== 'auto') {
    root.setAttribute('data-theme', pref);
    return;
  }
  var stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (e) {}
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', stored === 'light' || stored === 'dark' ? stored : dark ? 'dark' : 'light');
})();
