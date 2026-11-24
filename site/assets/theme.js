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

// Scroll animations (Site settings → Animations). Hides the page content before first paint
// so it can animate in; site.js then takes over and reveals each part as it scrolls into view.
// Nothing is hidden for visitors who prefer reduced motion, or without JavaScript.
(function () {
  var root = document.documentElement;
  if (!root.hasAttribute('data-motion') || !('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('motion-ready');
  // If site.js never arrives (blocked, very slow network), show the content without animation.
  setTimeout(function () {
    if (!root.classList.contains('motion-live')) root.classList.remove('motion-ready');
  }, 3000);
})();
