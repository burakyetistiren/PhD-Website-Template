import { api, upload, session, ApiError } from './api.js';
import { buildForm, el, slugify } from './forms.js';

const app = document.getElementById('app');

/** replaceChildren that skips null/false, so `cond ? node : null` is safe. */
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const state = { schema: null, content: null, dirty: null, hash: '' };

// ── Small UI helpers ───────────────────────────────────────────────────────

function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = el('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(t);
  setTimeout(() => t.classList.add('toast--out'), kind === 'error' ? 6000 : 2800);
  setTimeout(() => t.remove(), kind === 'error' ? 6400 : 3200);
}

function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'dialog' },
      el('form', { method: 'dialog' },
        el('h2', {}, title),
        body ? el('p', {}, body) : null,
        el('div', { class: 'dialog-actions' },
          el('button', { value: 'cancel', class: 'btn' }, 'Cancel'),
          el('button', { value: 'ok', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirm))));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function fail(err, form) {
  if (err instanceof ApiError && err.fields && form) {
    form.setErrors(err.fields);
    form.focusFirstError();
  }
  toast(err.message || String(err), 'error');
}

const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const formatTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const today = () => new Date().toISOString().slice(0, 10);
const plain = (md) => String(md || '').replace(/[*_`#>[\]]/g, '').replace(/\(([^)]*)\)/g, '').replace(/\s+/g, ' ').trim();

function itemTitle(def, item) {
  const v = item[def.titleField];
  return plain(Array.isArray(v) ? v.join(', ') : v) || 'Untitled';
}
function itemMeta(name, def, item) {
  if (name === 'demos') return { static: 'Runs in the browser', playground: 'Playground', embed: 'Embedded' }[item.kind] || '';
  if (name === 'publications') return [item.venue, item.year].filter(Boolean).join(', ');
  if (name === 'pages') return `/${item.slug}${item.timeline && item.timeline !== 'none' ? ', with timeline' : ''}`;
  if (name === 'experience') return [item.organization, `${item.start || ''}${item.current ? ' to present' : item.end && item.end !== item.start ? ` to ${item.end}` : ''}`].filter(Boolean).join(', ');
  return plain(item[def.metaField]);
}

function refs() {
  return { demos: (state.content?.demos || []).map((d) => ({ value: d.slug, label: `${d.title} (/demos/${d.slug})` })) };
}

async function reloadContent() {
  state.content = await api.get('/api/content');
  renderNav();
}

// Unsaved-changes guard
function setDirtyCheck(fn) {
  state.dirty = fn;
}
window.addEventListener('beforeunload', (e) => {
  if (state.dirty?.()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Login ──────────────────────────────────────────────────────────────────

function showLogin(message) {
  setDirtyCheck(null);
  const password = el('input', { id: 'password', type: 'password', class: 'input', autocomplete: 'current-password', required: true });
  const error = el('p', { class: 'error', role: 'alert' }, message || '');
  const button = el('button', { class: 'btn btn-primary btn-wide', type: 'submit' }, 'Sign in');
  const form = el('form', { class: 'login-card' },
    el('h1', {}, 'Sign in to your site'),
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'password' }, 'Admin password'), password),
    error,
    button,
    el('p', { class: 'help' }, 'Forgot it? On the server, run ', el('code', {}, 'npm run site -- set-password'), '.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = '';
    try {
      const { token } = await api.post('/api/auth/login', { password: password.value });
      session.set(token);
      await start();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      password.select();
    }
  });
  fill(app, el('main', { class: 'login' }, form));
  password.focus();
}

// ── Shell and routing ──────────────────────────────────────────────────────

const NAV = [
  { href: '#/', label: 'Overview' },
  { href: '#/profile', label: 'Profile' },
  { href: '#/settings', label: 'Site settings' },
  { group: 'Content' },
  { collections: true }, // every collection in the schema, in schema order
  { group: 'Files and safety' },
  { href: '#/media', label: 'Media library' },
  { href: '#/history', label: 'History and backups' },
  { href: '#/account', label: 'Account' },
];

function renderShell() {
  fill(app, 
    el('div', { class: 'shell' },
      el('aside', { class: 'sidebar' },
        el('div', { class: 'brand' },
          el('span', { class: 'brand-name', id: 'brand-name' }, state.content.profile.name || 'Your site'),
          el('a', { class: 'brand-link', href: '/', target: '_blank', rel: 'noopener' }, 'View site')),
        el('nav', { id: 'nav', 'aria-label': 'Admin sections' })),
      el('main', { class: 'main', id: 'view', tabindex: '-1' })),
  );
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  document.getElementById('brand-name').textContent = state.content.profile.name || 'Your site';
  const current = location.hash || '#/';
  const list = el('ul', {});
  const items = NAV.flatMap((item) => (item.collections ? Object.keys(state.schema.collections).map((collection) => ({ collection })) : [item]));
  for (const item of items) {
    if (item.group) {
      list.append(el('li', { class: 'nav-group' }, item.group));
      continue;
    }
    const href = item.href || `#/c/${item.collection}`;
    const label = item.label || state.schema.collections[item.collection].label;
    const count = item.collection ? state.content[item.collection]?.length : null;
    const active = href === '#/' ? current === '#/' || current === '' : current === href || current.startsWith(href + '/');
    list.append(el('li', {}, el('a', { href, 'aria-current': active ? 'page' : undefined }, label, count !== null ? el('span', { class: 'nav-count' }, String(count)) : null)));
  }
  fill(nav, list);
}

async function route() {
  const hash = location.hash || '#/';
  if (state.dirty?.() && hash !== state.hash) {
    const leave = await confirmDialog({ title: 'Leave without saving?', body: 'Your changes on this page will be lost.', confirm: 'Leave', danger: true });
    if (!leave) {
      history.replaceState(null, '', state.hash);
      return;
    }
  }
  state.hash = hash;
  setDirtyCheck(null);
  renderNav();
  const view = document.getElementById('view');
  fill(view, el('p', { class: 'muted loading' }, 'Loading…'));
  const parts = hash.slice(2).split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (!parts.length) await overview(view);
    else if (parts[0] === 'profile' || parts[0] === 'settings') await singletonView(view, parts[0]);
    else if (parts[0] === 'c' && parts[1] && !parts[2]) await collectionView(view, parts[1]);
    else if (parts[0] === 'c' && parts[1] && parts[2]) await itemView(view, parts[1], parts[2] === 'new' ? null : parts[2]);
    else if (parts[0] === 'media') await mediaView(view);
    else if (parts[0] === 'history') await historyView(view);
    else if (parts[0] === 'account') await accountView(view);
    else fill(view, header('Not found', 'This admin page does not exist.'));
  } catch (err) {
    fill(view, header('Something went wrong', err.message));
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function header(title, lede, ...actions) {
  return el('header', { class: 'view-head' },
    el('div', {}, el('h1', {}, title), lede ? el('p', { class: 'lede' }, lede) : null),
    actions.length ? el('div', { class: 'view-actions' }, ...actions) : null);
}

function saveBar(...children) {
  return el('div', { class: 'save-bar' }, ...children);
}

// ── Overview ───────────────────────────────────────────────────────────────

async function overview(view) {
  const c = state.content;
  const isExample = c.profile.email === 'robin.park@example.edu';
  const runner = await api.get('/api/runner').catch(() => null);

  const newsForm = buildForm(state.schema.collections.news.fields, { date: today() }, { refs: refs() });
  const post = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Post news');
  const newsCard = el('form', { class: 'card' }, el('h2', {}, 'Post a news item'), newsForm.el, el('div', { class: 'card-actions' }, post));
  newsCard.addEventListener('submit', async (e) => {
    e.preventDefault();
    post.disabled = true;
    try {
      await api.post('/api/collections/news', newsForm.get());
      toast('Posted. It is on your home page now.');
      await reloadContent();
      route();
    } catch (err) {
      fail(err, newsForm);
    } finally {
      post.disabled = false;
    }
  });

  const counts = Object.entries(state.schema.collections).map(([name, def]) =>
    el('li', {}, el('a', { href: `#/c/${name}` }, el('strong', {}, String(c[name].length)), ` ${def.label.toLowerCase()}`)));

  const dockerLine = !runner
    ? 'Unknown'
    : runner.docker.available
      ? `Ready (Docker ${runner.docker.version}). Playground demos can run.`
      : `${runner.docker.reason}. Playground demos won't run until Docker is running on the server; browser and embedded demos are unaffected.`;

  fill(view, 
    header('Overview', c.meta.updatedAt ? `Last saved ${formatTime(c.meta.updatedAt)}.` : 'Nothing saved yet.',
      el('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'View site')),
    isExample
      ? el('section', { class: 'card card--note' },
        el('h2', {}, 'This is example content'),
        el('p', {}, 'Everything on the site belongs to a made-up student so you can see each feature. Replace it in this order:'),
        el('ol', {},
          el('li', {}, el('a', { href: '#/profile' }, 'Profile'), ': your name, photo, bio and CV.'),
          el('li', {}, el('a', { href: '#/c/publications' }, 'Publications'), ': delete the examples, then use Import BibTeX.'),
          el('li', {}, el('a', { href: '#/c/demos' }, 'Demos'), ': upload a built web app, or point a playground at your tool’s Docker image.'),
          el('li', {}, el('a', { href: '#/settings' }, 'Site settings'), ': link color, home page sections and navigation.')))
      : null,
    el('div', { class: 'grid-2' },
      newsCard,
      el('section', { class: 'card' },
        el('h2', {}, 'Your content'),
        el('ul', { class: 'counts' }, counts),
        el('h3', {}, 'Demo runner'),
        el('p', { class: runner?.docker.available ? 'ok' : 'muted' }, dockerLine))),
  );
}

// ── Profile and settings ───────────────────────────────────────────────────

async function singletonView(view, name) {
  const def = state.schema.singletons[name];
  const { value } = await api.get(`/api/${name}`);
  const status = el('span', { class: 'save-status', 'aria-live': 'polite' });
  let form = null;
  form = buildForm(def.fields, value, { refs: refs(), pickMedia, onChange: () => (status.textContent = form?.isDirty() ? 'Unsaved changes' : '') });
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
  const formEl = el('form', { class: 'editor', novalidate: true }, form.el, saveBar(save, status));
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    form.setErrors({});
    try {
      await api.put(`/api/${name}`, form.get());
      form.markClean();
      status.textContent = 'Saved';
      toast(`${def.label} saved`);
      await reloadContent();
    } catch (err) {
      fail(err, form);
    } finally {
      save.disabled = false;
    }
  });
  setDirtyCheck(form.isDirty);
  const themeField = name === 'settings' && def.fields.find((f) => f.key === 'siteTheme');
  const previews = themeField
    ? el('section', { class: 'card' },
      el('h2', {}, 'Preview themes'),
      el('p', { class: 'muted' }, 'Opens your home page in a new tab with that theme. Nothing changes until you pick one under Theme below and save.'),
      el('div', { class: 'row-inline' }, themeField.options.map((o) =>
        el('a', { class: 'btn btn-small', href: `/?theme=${encodeURIComponent(o.value)}`, target: '_blank', rel: 'noopener' }, o.label.split(':')[0]))))
    : null;
  fill(view, header(def.label, def.description, el('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'View site')), previews, formEl);
}

// ── Collections ────────────────────────────────────────────────────────────

async function collectionView(view, name) {
  const def = state.schema.collections[name];
  if (!def) throw new Error(`Unknown collection "${name}"`);
  await reloadContent();
  let items = state.content[name];
  const search = el('input', { type: 'search', class: 'input search', placeholder: `Search ${def.label.toLowerCase()}`, 'aria-label': 'Search' });
  const list = el('ul', { class: 'items' });

  const actions = [el('a', { class: 'btn btn-primary', href: `#/c/${name}/new` }, `New ${def.singular}`)];
  if (name === 'publications') actions.unshift(el('button', { class: 'btn', type: 'button', onclick: () => bibtexDialog() }, 'Import BibTeX'));

  async function saveOrder() {
    try {
      await api.post(`/api/collections/${name}/reorder`, { ids: items.map((i) => i.id) });
      await reloadContent();
    } catch (err) {
      fail(err);
      await reloadContent();
      items = state.content[name];
      render();
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((it) => !q || JSON.stringify(it).toLowerCase().includes(q));
    if (!items.length) {
      fill(list, el('li', { class: 'empty-state' },
        el('p', {}, `No ${def.label.toLowerCase()} yet.`),
        el('a', { class: 'btn btn-primary', href: `#/c/${name}/new` }, `Add a ${def.singular}`)));
      return;
    }
    if (!shown.length) {
      fill(list, el('li', { class: 'empty-state' }, el('p', {}, 'Nothing matches your search.')));
      return;
    }
    fill(list, ...shown.map((item) => {
      const index = items.indexOf(item);
      const move = (delta) => {
        const j = index + delta;
        if (j < 0 || j >= items.length) return;
        items = [...items];
        [items[index], items[j]] = [items[j], items[index]];
        render();
        saveOrder();
      };
      const viewHref = name === 'demos' ? `/demos/${item.slug}` : name === 'pages' ? `/${item.slug}` : null;
      return el('li', { class: 'item' },
        def.orderable && !q
          ? el('div', { class: 'item-order' },
            el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${itemTitle(def, item)} up`, disabled: index === 0, onclick: () => move(-1) }, '↑'),
            el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Move ${itemTitle(def, item)} down`, disabled: index === items.length - 1, onclick: () => move(1) }, '↓'))
          : null,
        el('a', { class: 'item-main', href: `#/c/${name}/${item.id}` },
          el('span', { class: 'item-title-row' }, el('span', { class: 'item-title' }, itemTitle(def, item)), item.featured ? el('span', { class: 'badge' }, 'Featured') : null),
          el('span', { class: 'item-meta' }, itemMeta(name, def, item))),
        el('div', { class: 'item-actions' },
          viewHref ? el('a', { class: 'btn btn-small btn-ghost', href: viewHref, target: '_blank', rel: 'noopener' }, 'View') : null,
          el('button', {
            class: 'btn btn-small btn-ghost', type: 'button',
            onclick: async () => {
              try {
                const { item: copy } = await api.post(`/api/collections/${name}/${item.id}/duplicate`);
                toast('Duplicated');
                location.hash = `#/c/${name}/${copy.id}`;
              } catch (err) {
                fail(err);
              }
            },
          }, 'Duplicate'),
          el('button', {
            class: 'btn btn-small btn-ghost btn-danger-text', type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: `Delete this ${def.singular}?`,
                body: `“${itemTitle(def, item)}” will be removed from the site.${name === 'demos' ? ' Its uploaded files are deleted too.' : ''} You can restore it from History.`,
                confirm: 'Delete', danger: true,
              });
              if (!ok) return;
              try {
                await api.del(`/api/collections/${name}/${item.id}`);
                toast('Deleted');
                await reloadContent();
                items = state.content[name];
                render();
              } catch (err) {
                fail(err);
              }
            },
          }, 'Delete')));
    }));
  }

  search.addEventListener('input', render);
  render();
  fill(view, 
    header(def.label, def.sortHint || (def.orderable ? 'Shown on the site in this order.' : ''), ...actions),
    items.length > 6 ? search : null,
    list,
  );
}

async function itemView(view, name, id) {
  const def = state.schema.collections[name];
  if (!def) throw new Error(`Unknown collection "${name}"`);
  await reloadContent();
  const existing = id ? state.content[name].find((it) => it.id === id) : null;
  if (id && !existing) {
    fill(view, header('Not found', `This ${def.singular} no longer exists.`), el('a', { href: `#/c/${name}` }, `Back to ${def.label.toLowerCase()}`));
    return;
  }
  const status = el('span', { class: 'save-status', 'aria-live': 'polite' });
  let form = null;
  form = buildForm(def.fields, existing || {}, {
    refs: refs(),
    pickMedia,
    onChange: () => {
      status.textContent = form?.isDirty() ? 'Unsaved changes' : '';
    },
  });

  // New items: fill the address from the title until it's edited by hand.
  const slugW = form.widget('slug');
  const titleW = form.widget(def.titleField);
  if (!existing && slugW && titleW) {
    let touched = false;
    slugW.control.addEventListener('input', () => (touched = true));
    titleW.control.addEventListener('input', () => !touched && slugW.set(slugify(titleW.get())));
  }

  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Save changes' : `Create ${def.singular}`);
  const del = existing
    ? el('button', {
      class: 'btn btn-ghost btn-danger-text push-right', type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({ title: `Delete this ${def.singular}?`, body: 'You can restore it from History.', confirm: 'Delete', danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/collections/${name}/${id}`);
          setDirtyCheck(null);
          toast('Deleted');
          location.hash = `#/c/${name}`;
        } catch (err) {
          fail(err);
        }
      },
    }, 'Delete')
    : null;
  const formEl = el('form', { class: 'editor', novalidate: true }, form.el, saveBar(save, el('a', { class: 'btn btn-ghost', href: `#/c/${name}` }, 'Cancel'), status, del));
  const extras = el('div', { class: 'extras' });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    form.setErrors({});
    try {
      const body = form.get();
      const result = existing ? await api.put(`/api/collections/${name}/${id}`, body) : await api.post(`/api/collections/${name}`, body);
      form.markClean();
      toast(existing ? 'Saved' : `${def.singular[0].toUpperCase()}${def.singular.slice(1)} created`);
      await reloadContent();
      if (!existing) {
        setDirtyCheck(null);
        location.hash = `#/c/${name}/${result.item.id}`;
      } else {
        status.textContent = 'Saved';
        if (name === 'demos') renderDemoTools(extras, result.item);
      }
    } catch (err) {
      fail(err, form);
    } finally {
      save.disabled = false;
    }
  });

  setDirtyCheck(form.isDirty);
  fill(view, 
    el('p', { class: 'crumbs' }, el('a', { href: `#/c/${name}` }, def.label)),
    header(existing ? itemTitle(def, existing) : `New ${def.singular}`, existing ? null : def.sortHint),
    formEl,
    extras,
  );
  if (name === 'demos' && existing) renderDemoTools(extras, existing);
  if (!existing) form.focusFirst();
}

// ── Demo tools: file uploads, runner checks, test runs ─────────────────────

function renderDemoTools(container, demo) {
  fill(container, );
  if (demo.kind === 'static') container.append(staticFilesPanel(demo));
  if (demo.kind === 'playground') {
    if ((demo.runner || 'docker') === 'docker') container.append(runnerPanel(demo));
    container.append(tryPanel(demo));
  }
  if (demo.kind === 'embed' && demo.embedUrl) {
    container.append(el('section', { class: 'card' }, el('h2', {}, 'Preview'),
      el('iframe', { class: 'preview-frame', src: demo.embedUrl, title: `Preview of ${demo.title}`, loading: 'lazy' })));
  }
}

function staticFilesPanel(demo) {
  const base = `/api/demos/${encodeURIComponent(demo.slug)}/files`;
  const list = el('div', { class: 'files' });
  const progress = el('progress', { max: 1, value: 0, hidden: true });
  const message = el('p', { class: 'muted', 'aria-live': 'polite' });
  const replace = el('input', { type: 'checkbox', id: 'replace-files', checked: true });
  const folderInput = el('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true });
  const filesInput = el('input', { type: 'file', multiple: true, hidden: true });

  async function refresh() {
    const { files, totalSize } = await api.get(base);
    const entry = demo.entry || 'index.html';
    const hasEntry = files.some((f) => f.path === entry);
    fill(list, 
      files.length
        ? el('p', {}, `${files.length} file${files.length === 1 ? '' : 's'}, ${formatBytes(totalSize)}. `, hasEntry
          ? el('a', { href: `/d/${demo.slug}/${entry}`, target: '_blank', rel: 'noopener' }, 'Open the demo')
          : el('strong', { class: 'warn' }, `No ${entry} found. Upload a folder that contains it, or change the start page.`))
        : el('p', { class: 'muted' }, 'No files yet. Upload the folder your build produces (for example dist/ or build/).'),
      files.length
        ? el('details', {}, el('summary', {}, 'Show files'),
          el('ul', { class: 'file-list' }, files.slice(0, 500).map((f) => el('li', {}, el('code', {}, f.path), el('span', { class: 'muted' }, formatBytes(f.size))))))
        : null,
    );
  }

  async function send(fileList, stripFolder) {
    const files = [...fileList].filter((f) => !f.name.startsWith('.'));
    if (!files.length) return;
    progress.hidden = false;
    progress.value = 0;
    try {
      if (replace.checked) await api.del(`${base}/`);
      const total = files.reduce((n, f) => n + f.size, 0) || 1;
      let done = 0;
      for (const [i, file] of files.entries()) {
        let rel = file.webkitRelativePath || file.name;
        if (stripFolder && rel.includes('/')) rel = rel.split('/').slice(1).join('/');
        if (rel.split('/').some((p) => p.startsWith('.'))) continue;
        message.textContent = `Uploading ${i + 1} of ${files.length}: ${rel}`;
        await upload(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, file, (p) => (progress.value = (done + p * file.size) / total));
        done += file.size;
      }
      message.textContent = `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}.`;
      toast('Demo files uploaded');
    } catch (err) {
      message.textContent = '';
      fail(err);
    } finally {
      progress.hidden = true;
      await refresh();
    }
  }

  folderInput.addEventListener('change', () => send(folderInput.files, true).then(() => (folderInput.value = '')));
  filesInput.addEventListener('change', () => send(filesInput.files, false).then(() => (filesInput.value = '')));
  refresh().catch(fail);

  return el('section', { class: 'card' },
    el('h2', {}, 'Demo files'),
    el('p', { class: 'muted' }, 'Build your tool for the web (a JS bundle, Pyodide, or WebAssembly via Emscripten or wasm-pack) and upload the output folder. It is served at ', el('code', {}, `/d/${demo.slug}/`), '.'),
    list,
    el('div', { class: 'row-inline' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => folderInput.click() }, 'Upload a folder'),
      el('button', { class: 'btn', type: 'button', onclick: () => filesInput.click() }, 'Upload files'),
      el('label', { class: 'check', for: 'replace-files' }, replace, el('span', {}, 'Replace existing files'))),
    progress, message, folderInput, filesInput);
}

function runnerPanel(demo) {
  const body = el('div', {}, el('p', { class: 'muted' }, 'Checking Docker…'));
  async function refresh() {
    const [runner, image] = await Promise.all([api.get('/api/runner'), api.get(`/api/demos/${encodeURIComponent(demo.slug)}/image`)]);
    const rows = [
      el('dt', {}, 'Docker'),
      el('dd', { class: runner.docker.available ? 'ok' : 'warn' }, runner.docker.available ? `Running (version ${runner.docker.version})` : runner.docker.reason),
      el('dt', {}, 'Image'),
      el('dd', {}, demo.image ? el('code', {}, demo.image) : el('span', { class: 'warn' }, 'Not set')),
    ];
    if (runner.docker.available && demo.image) {
      const pulling = image.pull?.state === 'pulling';
      rows.push(el('dt', {}, 'On this server'), el('dd', { class: image.present ? 'ok' : 'warn' },
        image.present ? `Yes, ${formatBytes(image.size || 0)}` : pulling ? 'Downloading…' : 'Not yet',
        image.pull?.state === 'failed' ? el('span', { class: 'warn' }, ` Last download failed: ${image.pull.error}`) : null));
      if (pulling) setTimeout(() => refresh().catch(() => {}), 3000);
    }
    rows.push(el('dt', {}, 'Limits'), el('dd', {}, `${runner.limits.concurrent} runs at a time, ${runner.limits.perVisitorPer10Min} runs per visitor every 10 minutes, ${formatBytes(runner.limits.maxInputBytes)} of input`));
    const pull = el('button', {
      class: 'btn', type: 'button', disabled: !runner.docker.available || !demo.image || image.pull?.state === 'pulling',
      onclick: async () => {
        try {
          await api.post(`/api/demos/${encodeURIComponent(demo.slug)}/image/pull`);
          toast('Download started');
          refresh();
        } catch (err) {
          fail(err);
        }
      },
    }, 'Download image from registry');
    fill(body, 
      el('dl', { class: 'facts' }, rows),
      el('div', { class: 'row-inline' }, pull, el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => refresh() }, 'Check again')),
      el('p', { class: 'help' }, 'Images built on the server count too, for example: ', el('code', {}, `docker build -t ${demo.image || 'my-tool'} path/to/Dockerfile-folder`)),
    );
  }
  refresh().catch((err) => fill(body, el('p', { class: 'warn' }, err.message)));
  return el('section', { class: 'card' }, el('h2', {}, 'Runner'), body);
}

function tryPanel(demo) {
  const input = el('textarea', { class: 'input input--mono', rows: 8, spellcheck: 'false', 'aria-label': 'Test input' });
  input.value = demo.examples?.[0]?.input || '';
  const preset = demo.presets?.length
    ? el('select', { class: 'input input--auto', 'aria-label': 'Option' }, demo.presets.map((p, i) => el('option', { value: i }, p.label)))
    : null;
  const output = el('pre', { class: 'output' }, 'Output appears here. Runs from the admin skip the visitor rate limit.');
  const meta = el('span', { class: 'muted', 'aria-live': 'polite' });
  const run = el('button', { class: 'btn btn-primary', type: 'button' }, 'Run');
  run.addEventListener('click', async () => {
    run.disabled = true;
    meta.textContent = 'Running…';
    try {
      const r = await api.post(`/api/demos/${encodeURIComponent(demo.slug)}/run`, { input: input.value, preset: preset?.value });
      output.textContent = [r.error, r.stdout, r.stderr && `--- stderr ---\n${r.stderr}`].filter(Boolean).join('\n') || '(no output)';
      meta.textContent = r.timedOut ? 'Stopped at the time limit' : `Exit code ${r.exitCode} in ${r.durationMs} ms${r.truncated ? ', output truncated' : ''}`;
    } catch (err) {
      output.textContent = err.message;
      meta.textContent = '';
    } finally {
      run.disabled = false;
    }
  });
  return el('section', { class: 'card' },
    el('h2', {}, 'Try it'),
    el('p', { class: 'muted' }, 'Runs the saved version of this demo, exactly as visitors will.'),
    input,
    el('div', { class: 'row-inline' }, preset, run, meta),
    output);
}

// ── BibTeX import ──────────────────────────────────────────────────────────

function bibtexDialog() {
  const textarea = el('textarea', { class: 'input input--mono', rows: 12, spellcheck: 'false', placeholder: '@inproceedings{key,\n  title = {…},\n  author = {Last, First and …},\n  booktitle = {…},\n  year = {2026}\n}' });
  const file = el('input', { type: 'file', accept: '.bib,.txt,text/plain' });
  const result = el('div', { class: 'bib-result', 'aria-live': 'polite' });
  const previewBtn = el('button', { class: 'btn', type: 'button' }, 'Preview');
  const importBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Import');
  const close = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Close');
  const dialog = el('dialog', { class: 'dialog dialog--wide' },
    el('h2', {}, 'Import publications from BibTeX'),
    el('p', { class: 'muted' }, 'Paste entries from your .bib file, Google Scholar, DBLP or Zotero. Publications you already have are skipped.'),
    textarea,
    el('div', { class: 'row-inline' }, el('label', { class: 'muted' }, 'Or choose a file: ', file)),
    result,
    el('div', { class: 'dialog-actions' }, close, previewBtn, importBtn));

  file.addEventListener('change', async () => {
    if (file.files[0]) textarea.value = await file.files[0].text();
  });
  textarea.addEventListener('input', () => {
    importBtn.disabled = true;
    fill(result, );
  });
  const show = (r, done) => {
    fill(result, 
      el('p', {}, done ? `Imported ${r.added.length} publication${r.added.length === 1 ? '' : 's'}.` : `${r.added.length} new, ${r.skipped.length} skipped.`),
      r.added.length ? el('ul', {}, r.added.map((p) => el('li', {}, el('strong', {}, p.title), el('span', { class: 'muted' }, ` ${[p.venue, p.year].filter(Boolean).join(', ')}`)))) : null,
      r.skipped.length ? el('ul', { class: 'muted' }, r.skipped.map((s) => el('li', {}, `${s.title}: ${s.reason}`))) : null,
    );
  };
  previewBtn.addEventListener('click', async () => {
    try {
      const r = await api.post('/api/publications/import-bibtex', { bibtex: textarea.value, dryRun: true });
      show(r, false);
      importBtn.disabled = !r.added.length;
      importBtn.textContent = r.added.length ? `Import ${r.added.length}` : 'Import';
    } catch (err) {
      fill(result, el('p', { class: 'error' }, err.message));
    }
  });
  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    try {
      const r = await api.post('/api/publications/import-bibtex', { bibtex: textarea.value });
      show(r, true);
      toast(`Imported ${r.added.length} publications`);
      previewBtn.disabled = true;
    } catch (err) {
      fill(result, el('p', { class: 'error' }, err.message));
    }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    route();
  });
  document.body.append(dialog);
  dialog.showModal();
  textarea.focus();
}

// ── Media ──────────────────────────────────────────────────────────────────

const isImage = (name) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name);

async function uploadMedia(files, message) {
  const uploaded = [];
  for (const [i, file] of [...files].entries()) {
    if (message) message.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name}`;
    uploaded.push(await upload(`/api/media/${encodeURIComponent(file.name)}`, file));
  }
  if (message) message.textContent = '';
  return uploaded;
}

function mediaGrid(items, { onPick, onChange } = {}) {
  if (!items.length) return el('p', { class: 'muted' }, 'No files yet. Upload a photo, your CV, slides or paper PDFs.');
  return el('ul', { class: 'media-grid' }, items.map((m) =>
    el('li', { class: 'media-card' },
      el('div', { class: 'media-thumb' }, isImage(m.name) ? el('img', { src: m.url, alt: '', loading: 'lazy' }) : el('span', {}, m.name.split('.').pop().toUpperCase())),
      el('p', { class: 'media-name', title: m.name }, m.name),
      el('p', { class: 'muted' }, formatBytes(m.size)),
      el('div', { class: 'row-inline' },
        onPick
          ? el('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => onPick(m.url) }, 'Use this file')
          : [
            el('button', {
              class: 'btn btn-small', type: 'button',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(m.url);
                  toast(`Copied ${m.url}`);
                } catch {
                  prompt('Copy this address:', m.url);
                }
              },
            }, 'Copy address'),
            el('button', {
              class: 'btn btn-small btn-ghost btn-danger-text', type: 'button',
              onclick: async () => {
                const ok = await confirmDialog({ title: `Delete ${m.name}?`, body: 'Pages that link to it will show a broken link. This cannot be undone.', confirm: 'Delete', danger: true });
                if (!ok) return;
                try {
                  await api.del(`/api/media/${encodeURIComponent(m.name)}`);
                  toast('Deleted');
                  onChange?.();
                } catch (err) {
                  fail(err);
                }
              },
            }, 'Delete'),
          ]))));
}

async function mediaView(view) {
  const message = el('p', { class: 'muted', 'aria-live': 'polite' });
  const input = el('input', { type: 'file', multiple: true, hidden: true });
  const gridHolder = el('div', {});
  async function refresh() {
    const { items } = await api.get('/api/media');
    fill(gridHolder, mediaGrid(items, { onChange: refresh }));
  }
  const handle = async (files) => {
    try {
      await uploadMedia(files, message);
      toast('Uploaded');
    } catch (err) {
      fail(err);
    }
    refresh();
  };
  input.addEventListener('change', () => handle(input.files));
  const drop = el('div', { class: 'dropzone' }, el('p', {}, 'Drop files here, or ', el('button', { class: 'linkish', type: 'button', onclick: () => input.click() }, 'choose files'), '.'), el('p', { class: 'muted' }, 'Images, PDFs, slides, videos and asciinema recordings. Use the address (like /media/cv.pdf) anywhere on the site.'));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dropzone--over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dropzone--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dropzone--over');
    handle(e.dataTransfer.files);
  });
  await refresh();
  fill(view, header('Media library', 'Files you can link from your profile, publications and pages.', el('button', { class: 'btn btn-primary', type: 'button', onclick: () => input.click() }, 'Upload files')), drop, message, gridHolder, input);
}

function pickMedia(accept) {
  return new Promise(async (resolve) => {
    let picked = null;
    const filter = (items) => {
      if (accept === 'image/*') return items.filter((m) => isImage(m.name));
      if (accept === '.pdf') return items.filter((m) => /\.pdf$/i.test(m.name));
      return items;
    };
    const holder = el('div', { class: 'picker-grid' }, el('p', { class: 'muted' }, 'Loading…'));
    const input = el('input', { type: 'file', accept: accept || undefined, hidden: true });
    const dialog = el('dialog', { class: 'dialog dialog--wide' },
      el('h2', {}, 'Choose a file'),
      el('div', { class: 'row-inline' }, el('button', { class: 'btn', type: 'button', onclick: () => input.click() }, 'Upload a new file'), input),
      holder,
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dialog.close() }, 'Cancel')));
    const choose = (url) => {
      picked = url;
      dialog.close();
    };
    const refresh = async () => fill(holder, mediaGrid(filter((await api.get('/api/media')).items), { onPick: choose }));
    input.addEventListener('change', async () => {
      try {
        const [m] = await uploadMedia(input.files);
        choose(m.url);
      } catch (err) {
        fail(err);
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(picked);
    });
    document.body.append(dialog);
    dialog.showModal();
    refresh().catch(fail);
  });
}

// ── History ────────────────────────────────────────────────────────────────

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function historyView(view) {
  const { backups } = await api.get('/api/backups');
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    let data;
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast('That file is not valid JSON', 'error');
      return;
    }
    const ok = await confirmDialog({ title: 'Replace all content with this file?', body: `Everything on the site will be replaced by ${f.name}. The current version is backed up first.`, confirm: 'Replace content', danger: true });
    if (!ok) return;
    try {
      await api.put('/api/content', data);
      toast('Content restored from file');
      await reloadContent();
      route();
    } catch (err) {
      const details = err.fields ? ` (${Object.entries(err.fields).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')})` : '';
      toast(err.message + details, 'error');
    }
  });

  const rows = backups.map((b) =>
    el('li', { class: 'item' },
      el('div', { class: 'item-main' }, el('span', { class: 'item-title' }, formatTime(b.savedAt)), el('span', { class: 'item-meta' }, formatBytes(b.size))),
      el('div', { class: 'item-actions' },
        el('button', {
          class: 'btn btn-small btn-ghost', type: 'button',
          onclick: async () => download(b.name, await api.get(`/api/backups/${b.name}`)),
        }, 'Download'),
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: 'Restore this version?', body: `The site goes back to how it was on ${formatTime(b.savedAt)}. The current version is backed up first, so you can undo this.`, confirm: 'Restore' });
            if (!ok) return;
            try {
              await api.post(`/api/backups/${b.name}/restore`);
              toast('Restored');
              await reloadContent();
              route();
            } catch (err) {
              fail(err);
            }
          },
        }, 'Restore'))));

  fill(view, 
    header('History and backups', 'Every save keeps the previous version. The last 50 are kept.',
      el('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Restore from a file'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => download(`site-content-${today()}.json`, await api.get('/api/content')) }, 'Download all content')),
    el('p', { class: 'muted' }, 'Content backups cover text and settings. Uploaded media and demo files live in the data/ folder on the server; back that folder up too.'),
    backups.length ? el('ul', { class: 'items' }, rows) : el('p', { class: 'muted' }, 'No earlier versions yet. They appear after your first save.'),
    fileInput,
  );
}

// ── Account ────────────────────────────────────────────────────────────────

async function accountView(view) {
  const info = await api.get('/api/auth/session');
  const fields = [
    { key: 'current', type: 'string', label: 'Current password', required: true },
    { key: 'next', type: 'string', label: 'New password', required: true, help: 'At least 8 characters.' },
    { key: 'confirm', type: 'string', label: 'New password again', required: true },
  ];
  const form = buildForm(fields, {});
  for (const { widget, field } of form.entries) {
    widget.control.type = 'password';
    widget.control.autocomplete = field.key === 'current' ? 'current-password' : 'new-password';
  }
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password');
  const pwForm = el('form', { class: 'card', novalidate: true }, el('h2', {}, 'Password'), form.el, el('div', { class: 'card-actions' }, save));
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = form.get();
    if (v.next !== v.confirm) {
      form.setErrors({ confirm: 'The two new passwords are different' });
      return;
    }
    save.disabled = true;
    try {
      const { token } = await api.post('/api/auth/password', { current: v.current, next: v.next });
      session.set(token);
      toast('Password changed. Other devices are signed out.');
      route();
    } catch (err) {
      fail(err, form);
    } finally {
      save.disabled = false;
    }
  });

  const origin = location.origin;
  fill(view, 
    header('Account', `Signed in until ${formatTime(info.expiresAt)}.`,
      el('button', {
        class: 'btn', type: 'button',
        onclick: () => {
          session.clear();
          showLogin('You are signed out.');
        },
      }, 'Sign out')),
    info.passwordFromEnv
      ? el('section', { class: 'card' }, el('h2', {}, 'Password'), el('p', {}, 'The password is set by the ', el('code', {}, 'ADMIN_PASSWORD'), ' environment variable on the server. Change it there and restart.'))
      : pwForm,
    el('section', { class: 'card' },
      el('h2', {}, 'Update from the terminal'),
      el('p', { class: 'muted' }, 'The same API powers a command-line tool, handy in scripts and CI. From a copy of this repository:'),
      el('pre', { class: 'output' }, [
        `npm run site -- login --url ${origin}`,
        'npm run site -- news "Our paper was accepted to ICSE!"',
        'npm run site -- bibtex papers.bib',
        'npm run site -- push-demo my-tool ./dist',
      ].join('\n'))),
  );
}

// ── Start ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    [state.schema, state.content] = await Promise.all([api.get('/api/schema'), api.get('/api/content')]);
  } catch (err) {
    if (err.status === 401) return showLogin();
    fill(app, el('main', { class: 'login' }, el('div', { class: 'login-card' }, el('h1', {}, "Couldn't load the admin"), el('p', {}, err.message))));
    return;
  }
  renderShell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:expired', () => showLogin('Your session ended. Sign in again.'));
if (session.token) start();
else showLogin();
