/**
 * Builds editing forms from the schema served by GET /api/schema.
 * buildForm(fields, value, ctx) → { el, get(), setErrors(errors), isDirty(), markClean(), focusFirstError() }
 * ctx: { refs: { demos: [{ value, label }] }, pickMedia(accept) → Promise<url|null>, onChange() }
 */
import { renderMarkdown, renderInline } from '/shared/markdown.js';

let uid = 0;
const nextId = (key) => `f-${key}-${++uid}`;

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export const slugify = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

const isEmptyValue = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function matches(showWhen, values, fields) {
  if (!showWhen) return true;
  return Object.entries(showWhen).every(([key, expected]) => {
    const f = fields.find((x) => x.key === key);
    const actual = values[key] ?? f?.default;
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

// ── Widgets ────────────────────────────────────────────────────────────────

function inputWidget(field, value, id, onChange, type = 'text') {
  const input = el('input', {
    id,
    type,
    class: 'input',
    required: field.required,
    maxlength: field.type === 'number' ? undefined : field.max,
    min: field.min,
    max: field.type === 'number' ? field.max : undefined,
    step: field.step ?? (field.type === 'number' ? 'any' : undefined),
    placeholder: field.placeholder,
    autocomplete: 'off',
    spellcheck: field.type === 'string' ? undefined : 'false',
  });
  input.value = value ?? '';
  input.addEventListener('input', onChange);
  return {
    control: input,
    focus: () => input.focus(),
    get: () => {
      const v = input.value.trim();
      if (v === '') return undefined;
      return field.type === 'number' ? Number(v) : v;
    },
    set: (v) => {
      input.value = v ?? '';
    },
  };
}

function textareaWidget(field, value, id, onChange, { mono = false, rows = 3 } = {}) {
  const ta = el('textarea', { id, class: mono ? 'input input--mono' : 'input', rows: field.rows || rows, required: field.required, spellcheck: mono ? 'false' : undefined });
  ta.value = value ?? '';
  ta.addEventListener('input', onChange);
  return { control: ta, textarea: ta, focus: () => ta.focus(), get: () => (ta.value.trim() === '' ? undefined : ta.value) };
}

function markdownWidget(field, value, id, onChange) {
  const base = textareaWidget(field, value, id, onChange, { rows: field.rows || 6 });
  const preview = el('div', { class: 'md-preview prose', hidden: true });
  const toggle = el('button', { type: 'button', class: 'linkish', 'aria-pressed': 'false' }, 'Preview');
  toggle.addEventListener('click', () => {
    const on = preview.hidden;
    preview.hidden = !on;
    base.textarea.hidden = on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Edit' : 'Preview';
    if (on) preview.innerHTML = renderMarkdown(base.textarea.value) || '<p class="muted">Nothing to preview yet.</p>';
  });
  const bar = el('div', { class: 'md-bar' }, el('span', { class: 'muted' }, 'Markdown: **bold**, *italic*, [link](https://…), - lists'), toggle);
  return { ...base, control: el('div', { class: 'md' }, base.textarea, preview, bar) };
}

function booleanWidget(field, value, id, onChange) {
  const box = el('input', { id, type: 'checkbox', class: 'checkbox' });
  box.checked = Boolean(value);
  box.addEventListener('change', onChange);
  const control = el('label', { class: 'check', for: id }, box, el('span', {}, field.label));
  return { control, focus: () => box.focus(), get: () => box.checked };
}

function selectWidget(field, value, id, onChange, options) {
  const select = el('select', { id, class: 'input', required: field.required });
  if (!field.required) select.append(el('option', { value: '' }, field.type === 'ref' ? 'None' : 'Not set'));
  for (const o of options) select.append(el('option', { value: o.value }, o.label));
  if (value !== undefined && !options.some((o) => o.value === value) && value !== '') {
    select.append(el('option', { value }, `${value} (missing)`));
  }
  select.value = value ?? (field.required ? options[0]?.value ?? '' : '');
  select.addEventListener('change', onChange);
  return { control: select, focus: () => select.focus(), get: () => select.value || undefined };
}

function colorWidget(field, value, id, onChange) {
  const picker = el('input', { type: 'color', class: 'color', 'aria-label': `${field.label} picker` });
  const text = el('input', { id, type: 'text', class: 'input input--short', maxlength: 7, spellcheck: 'false' });
  picker.value = value || field.default || '#000000';
  text.value = value || '';
  picker.addEventListener('input', () => {
    text.value = picker.value;
    onChange();
  });
  text.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
    onChange();
  });
  return { control: el('div', { class: 'row-inline' }, picker, text), focus: () => text.focus(), get: () => text.value.trim() || undefined };
}

function tagsWidget(field, value, id, onChange) {
  let tags = Array.isArray(value) ? [...value] : [];
  const input = el('input', { id, type: 'text', class: 'tags-entry', autocomplete: 'off' });
  const box = el('div', { class: 'tags-input' });
  box.addEventListener('click', (e) => e.target === box && input.focus());

  const commit = (text) => {
    const parts = String(text).split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return false;
    tags.push(...parts);
    input.value = '';
    render();
    onChange();
    return true;
  };
  function render() {
    const chips = tags.map((t, i) =>
      el('span', { class: 'chip' },
        el('button', {
          type: 'button', class: 'chip-text', title: 'Edit',
          onclick: () => {
            commit(input.value);
            tags.splice(i, 1);
            input.value = t;
            render();
            input.focus();
            onChange();
          },
        }, t),
        el('button', {
          type: 'button', class: 'chip-x', 'aria-label': `Remove ${t}`,
          onclick: () => {
            tags.splice(i, 1);
            render();
            onChange();
            input.focus();
          },
        }, '×')),
    );
    input.placeholder = tags.length ? '' : 'Type, then press Enter';
    box.replaceChildren(...chips, input);
  }
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      commit(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      input.value = tags.pop();
      e.preventDefault();
      render();
      onChange();
    }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (/[,\n]/.test(text)) {
      e.preventDefault();
      commit(input.value + text);
    }
  });
  input.addEventListener('blur', () => commit(input.value));
  render();
  return {
    control: box,
    focus: () => input.focus(),
    get: () => {
      const pending = input.value.trim() ? input.value.split(',').map((t) => t.trim()).filter(Boolean) : [];
      const all = [...tags, ...pending];
      return all.length ? all : undefined;
    },
  };
}

function mediaWidget(field, value, id, onChange, ctx) {
  const base = inputWidget(field, value, id, () => {
    refresh();
    onChange();
  });
  base.control.placeholder = '/media/file.pdf or https://…';
  const thumb = el('img', { class: 'thumb', alt: '', hidden: true });
  const refresh = () => {
    const v = base.control.value.trim();
    const isImage = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(v);
    thumb.hidden = !isImage;
    if (isImage) thumb.src = v;
  };
  const choose = el('button', { type: 'button', class: 'btn btn-small' }, 'Choose…');
  choose.addEventListener('click', async () => {
    const url = await ctx.pickMedia?.(field.accept);
    if (url) {
      base.control.value = url;
      refresh();
      onChange();
    }
  });
  refresh();
  return { ...base, control: el('div', { class: 'row-inline media-field' }, thumb, base.control, choose) };
}

function listWidget(field, value, id, onChange, ctx) {
  const items = [];
  const listEl = el('ol', { class: 'list-items', id });
  const add = el('button', { type: 'button', class: 'btn btn-small' }, `Add ${field.itemLabel || 'item'}`);

  const move = (item, delta) => {
    const i = items.indexOf(item);
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    items.splice(i, 1);
    items.splice(j, 0, item);
    listEl.replaceChildren(...items.map((it) => it.li));
    onChange();
  };
  const addItem = (v, focus = false) => {
    const form = buildForm(field.fields, v || {}, { ...ctx, onChange }, { compact: true });
    const item = { form };
    const label = field.itemLabel || 'item';
    item.li = el('li', { class: 'list-item' },
      form.el,
      el('div', { class: 'list-item-actions' },
        el('button', { type: 'button', class: 'icon-btn', title: 'Move up', 'aria-label': `Move ${label} up`, onclick: () => move(item, -1) }, '↑'),
        el('button', { type: 'button', class: 'icon-btn', title: 'Move down', 'aria-label': `Move ${label} down`, onclick: () => move(item, 1) }, '↓'),
        el('button', {
          type: 'button', class: 'icon-btn icon-btn--danger', title: 'Remove', 'aria-label': `Remove ${label}`,
          onclick: () => {
            items.splice(items.indexOf(item), 1);
            item.li.remove();
            onChange();
          },
        }, '×')));
    items.push(item);
    listEl.append(item.li);
    if (focus) form.focusFirst();
  };
  (Array.isArray(value) ? value : []).forEach((v) => addItem(v));
  add.addEventListener('click', () => {
    addItem({}, true);
    onChange();
  });
  return {
    control: el('div', { class: 'list' }, listEl, add),
    focus: () => (items[0] ? items[0].form.focusFirst() : add.focus()),
    get: () => {
      const out = items.map((it) => it.form.get()).filter((v) => Object.values(v).some((x) => !isEmptyValue(x) && x !== false));
      return out.length ? out : undefined;
    },
    setErrors: (errors, prefix) => items.forEach((it, i) => it.form.setErrors(errors, `${prefix}${i}.`)),
  };
}

function createWidget(field, value, id, onChange, ctx) {
  switch (field.type) {
    case 'string':
    case 'slug':
      return inputWidget(field, value, id, onChange);
    case 'url':
      return inputWidget({ ...field, placeholder: field.placeholder || 'https://…' }, value, id, onChange);
    case 'email':
      return inputWidget(field, value, id, onChange, 'email');
    case 'date':
      return inputWidget(field, value, id, onChange, 'date');
    case 'number':
      return inputWidget(field, value, id, onChange, 'number');
    case 'text':
      return textareaWidget(field, value, id, onChange);
    case 'code':
      return textareaWidget(field, value, id, onChange, { mono: true, rows: 8 });
    case 'markdown':
      return markdownWidget(field, value, id, onChange);
    case 'boolean':
      return booleanWidget(field, value, id, onChange);
    case 'select':
      return selectWidget(field, value, id, onChange, field.options);
    case 'ref':
      return selectWidget(field, value, id, onChange, ctx.refs?.[field.collection] || []);
    case 'color':
      return colorWidget(field, value, id, onChange);
    case 'tags':
      return tagsWidget(field, value, id, onChange);
    case 'media':
      return mediaWidget(field, value, id, onChange, ctx);
    case 'list':
      return listWidget(field, value, id, onChange, ctx);
    default:
      return inputWidget(field, value, id, onChange);
  }
}

// ── Form ───────────────────────────────────────────────────────────────────

export function buildForm(fields, value = {}, ctx = {}, { compact = false } = {}) {
  const root = el('div', { class: compact ? 'form form--compact' : 'form' });
  const entries = [];
  let initial = '';

  const onChange = () => {
    updateVisibility();
    ctx.onChange?.();
  };

  for (const field of fields) {
    const id = nextId(field.key);
    const start = value[field.key] ?? field.default;
    const widget = createWidget(field, start, id, onChange, ctx);
    const error = el('p', { class: 'error', id: `${id}-error` });
    const wrap = el('div', { class: `field field--${field.type}`, dataset: { key: field.key } });
    if (field.type !== 'boolean') {
      const LabelTag = field.type === 'list' || field.type === 'tags' ? 'span' : 'label';
      wrap.append(el(LabelTag, { class: 'field-label', for: LabelTag === 'label' ? id : undefined, id: `${id}-label` }, field.label, field.required ? el('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : ''));
    }
    wrap.append(widget.control);
    if (field.help) wrap.append(el('p', { class: 'help', id: `${id}-help`, html: renderInline(field.help) }));
    wrap.append(error);
    const input = wrap.querySelector('input, textarea, select');
    if (input) input.setAttribute('aria-describedby', [field.help ? `${id}-help` : '', `${id}-error`].filter(Boolean).join(' '));
    root.append(wrap);
    entries.push({ field, widget, wrap, error });
  }

  function get() {
    const out = {};
    for (const { field, widget } of entries) {
      const v = widget.get();
      if (v !== undefined) out[field.key] = v;
    }
    return out;
  }

  function updateVisibility() {
    const values = get();
    for (const { field, wrap } of entries) wrap.hidden = !matches(field.showWhen, values, fields);
  }

  function setErrors(errors = {}, prefix = '') {
    for (const { field, widget, wrap, error } of entries) {
      const msg = errors[prefix + field.key] || '';
      error.textContent = msg;
      wrap.classList.toggle('has-error', Boolean(msg));
      if (msg) wrap.hidden = false;
      widget.setErrors?.(errors, `${prefix}${field.key}.`);
    }
  }

  updateVisibility();
  initial = JSON.stringify(get());

  return {
    el: root,
    get,
    setErrors,
    entries,
    widget: (key) => entries.find((e) => e.field.key === key)?.widget,
    isDirty: () => JSON.stringify(get()) !== initial,
    markClean: () => {
      initial = JSON.stringify(get());
    },
    focusFirst: () => entries.find((e) => !e.wrap.hidden)?.widget.focus(),
    focusFirstError: () => {
      const bad = root.querySelector('.has-error');
      bad?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      bad?.querySelector('input, textarea, select, button')?.focus({ preventScroll: true });
    },
  };
}
