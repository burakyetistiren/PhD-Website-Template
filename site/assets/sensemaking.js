// The sensemaking diagram on custom pages (markup: site/sensemaking.js).
// Without this script every stage's notes are listed under the drawing and the stages link to
// them. With it, one panel follows the selected stage, the address remembers it (#sm-schema),
// arrow keys walk the loop, and "Play from 1:25" links start the tool's video on this page.

for (const root of document.querySelectorAll('[data-sm]')) setup(root);

function setup(root) {
  const box = root.querySelector('[data-sm-panels]');
  const panels = new Map([...root.querySelectorAll('[data-sm-panel]')].map((p) => [p.dataset.smPanel, p]));
  const marks = [...root.querySelectorAll('.sm-svg [data-sm-stage]')]; // in walk-through order
  if (!box || !panels.size) return;
  box.setAttribute('aria-live', 'polite');
  root.classList.add('sm--live');

  function show(id) {
    if (!panels.has(id)) return false;
    for (const [key, panel] of panels) panel.hidden = key !== id;
    for (const mark of marks) {
      const on = mark.dataset.smStage === id;
      mark.classList.toggle('is-current', on);
      if (on) mark.setAttribute('aria-current', 'true');
      else mark.removeAttribute('aria-current');
    }
    return true;
  }

  // On narrow screens the drawing scrolls sideways: bring the selected stage into view.
  // getBBox works in drawing units, so scroll animations that transform the page don't skew it.
  const canvas = root.querySelector('.sm-canvas');
  const svg = root.querySelector('.sm-svg');
  function reveal(id) {
    const mark = marks.find((m) => m.dataset.smStage === id);
    if (!mark || !canvas || canvas.scrollWidth <= canvas.clientWidth) return;
    const box = mark.getBBox();
    const scale = svg.clientWidth / svg.viewBox.baseVal.width;
    canvas.scrollLeft = (box.x + box.width / 2) * scale - canvas.clientWidth / 2;
  }

  const hashStage = () => (location.hash.startsWith('#sm-') ? decodeURIComponent(location.hash.slice(4)) : '');
  const first = show(hashStage()) ? hashStage() : root.dataset.smStart;
  show(first);
  reveal(first);
  window.addEventListener('hashchange', () => show(hashStage()) && reveal(hashStage()));

  root.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const play = e.target.closest('[data-sm-seek]');
    if (play) {
      const player = document.getElementById(`${play.dataset.smSeek}-video`);
      if (!player) return;
      e.preventDefault();
      seek(player, Number(play.dataset.smAt) || 0);
      return;
    }
    const link = e.target.closest('[data-sm-stage]');
    if (!link || !show(link.dataset.smStage)) return;
    e.preventDefault();
    history.replaceState(null, '', `#sm-${link.dataset.smStage}`);
    // The walk-through links sit at the bottom of a panel: keep the new panel's top in view.
    const panel = panels.get(link.dataset.smStage);
    if (!link.closest('.sm-svg') && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  });

  root.querySelector('.sm-svg')?.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const i = marks.indexOf(document.activeElement);
    if (!step || i < 0) return;
    e.preventDefault();
    const next = marks[(i + step + marks.length) % marks.length];
    next.focus();
    show(next.dataset.smStage);
    reveal(next.dataset.smStage);
    history.replaceState(null, '', `#sm-${next.dataset.smStage}`);
  });
}

function scrollBehavior() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** Starts a tool's video at `t` seconds: a <video> seeks; YouTube and Vimeo players reload at that time. */
function seek(player, t) {
  const frame = player.closest('.sm-video') || player;
  frame.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  if (player.tagName === 'VIDEO') {
    const go = () => {
      player.currentTime = t;
      player.play().catch(() => {});
    };
    if (player.readyState >= 1) go();
    else player.addEventListener('loadedmetadata', go, { once: true });
  } else {
    player.dataset.smBase ||= player.src.split('#')[0];
    const url = new URL(player.dataset.smBase);
    url.searchParams.set('autoplay', '1');
    if (player.dataset.smVideo === 'youtube') {
      url.searchParams.set('start', String(t));
      player.src = url.href;
    } else {
      player.src = `${url.href}#t=${t}s`;
    }
  }
  frame.classList.remove('is-cued');
  void frame.offsetWidth; // restart the highlight
  frame.classList.add('is-cued');
  setTimeout(() => frame.classList.remove('is-cued'), 1600);
}
