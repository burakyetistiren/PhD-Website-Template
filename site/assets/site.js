// Progressive enhancements for the public site. Everything works without this file
// except running playground demos.

// Light/dark toggle
for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {}
  });
}

// Copy BibTeX
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const pre = button.parentElement.querySelector('pre');
  try {
    await navigator.clipboard.writeText(pre.textContent);
    button.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(pre);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    button.textContent = 'Selected';
  }
  setTimeout(() => (button.textContent = 'Copy'), 1600);
});

// Publication type filters
const filters = document.querySelector('[data-pub-filters]');
if (filters) {
  filters.hidden = false;
  filters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    const type = button.dataset.filter;
    for (const b of filters.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
    for (const pub of document.querySelectorAll('.pub[data-type]')) pub.hidden = Boolean(type) && pub.dataset.type !== type;
    for (const group of document.querySelectorAll('[data-year-group]')) {
      group.hidden = !group.querySelector('.pub:not([hidden])');
    }
  });
}

// Playground demos
for (const root of document.querySelectorAll('[data-playground]')) setupPlayground(root);

function setupPlayground(root) {
  const input = root.querySelector('[data-input]');
  const output = root.querySelector('[data-output]');
  const button = root.querySelector('[data-run-button]');
  const status = root.querySelector('[data-status]');
  const exampleSelect = root.querySelector('[data-examples]');
  const presetSelect = root.querySelector('[data-preset]');
  let examples = [];
  try {
    examples = JSON.parse(root.querySelector('[data-examples-json]')?.textContent || '[]');
  } catch {}
  if (root.hasAttribute('data-offline')) return;

  exampleSelect?.addEventListener('change', () => {
    input.value = examples[Number(exampleSelect.value)] ?? '';
    input.focus();
  });

  // Tab indents inside the editor. Press Escape first to move focus out with Tab.
  let releaseTab = false;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    } else if (event.key === 'Escape') {
      releaseTab = true;
    } else if (event.key === 'Tab' && !releaseTab && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const { selectionStart: s, selectionEnd: e, value } = input;
      input.value = value.slice(0, s) + '  ' + value.slice(e);
      input.selectionStart = input.selectionEnd = s + 2;
    } else {
      releaseTab = false;
    }
  });

  button.addEventListener('click', run);

  const line = (cls, text) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    return span;
  };
  const seconds = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    button.disabled = true;
    button.textContent = 'Running…';
    root.setAttribute('aria-busy', 'true');
    delete status.dataset.state;
    const started = performance.now();
    const tick = setInterval(() => {
      status.textContent = `Running, ${((performance.now() - started) / 1000).toFixed(1)} s`;
    }, 100);
    try {
      const res = await fetch(root.dataset.run, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.value, preset: presetSelect ? presetSelect.value : undefined }),
      });
      const data = await res.json().catch(() => ({ error: `The server answered with status ${res.status}.` }));
      if (!res.ok) {
        output.replaceChildren(line('err', data.error || `The server answered with status ${res.status}.`));
        status.textContent = '';
      } else {
        show(data);
      }
    } catch {
      output.replaceChildren(line('err', "Couldn't reach the server. Check your connection and try again."));
      status.textContent = '';
    } finally {
      clearInterval(tick);
      running = false;
      button.disabled = false;
      button.textContent = 'Run';
      root.removeAttribute('aria-busy');
    }
  }

  function show(d) {
    const parts = [];
    if (d.error) parts.push(line('err', d.error + (d.stdout || d.stderr ? '\n' : '')));
    if (d.stdout) parts.push(line('', d.stdout));
    if (d.stderr) parts.push(line('err', (d.stdout && !d.stdout.endsWith('\n') ? '\n' : '') + d.stderr));
    if (!d.error && !d.stdout && !d.stderr) parts.push(line('dim', 'The tool finished without printing anything.'));
    if (d.truncated) parts.push(line('dim', '\n… output cut off here'));
    output.replaceChildren(...parts);
    output.scrollTop = 0;
    if (d.timedOut) {
      status.textContent = 'Stopped: hit the time limit';
      status.dataset.state = 'fail';
    } else if (Number.isInteger(d.exitCode)) {
      status.textContent = `Exit ${d.exitCode} in ${seconds(d.durationMs)}`;
      status.dataset.state = d.exitCode === 0 ? 'ok' : 'fail';
    } else {
      status.textContent = '';
    }
  }
}
