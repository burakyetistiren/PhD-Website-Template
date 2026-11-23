/**
 * Small, safe Markdown renderer shared by the site (server) and the admin preview (browser).
 * Everything is HTML-escaped first; raw HTML in content is shown as text, and links only
 * accept http(s), mailto and relative addresses.
 *
 * Supports: # headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`, ```fences```,
 * [links](url), ![images](url), <https://autolinks>, - lists, 1. lists, > quotes, ---.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (!u || /[\u0000-\u001f\u007f]/.test(u)) return '';
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !['http', 'https', 'mailto'].includes(scheme[1].toLowerCase())) return '';
  return u;
}

const isExternal = (u) => /^https?:\/\//i.test(u);

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^\s_](?:[^_]*?[^\s_])?)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

export function renderInline(text, opts = {}) {
  const resolve = opts.resolveUrl || ((u) => u);
  const slots = [];
  const stash = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(text ?? '').replace(/\u0000/g, '');

  s = s.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/!\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+"([^"\n]*)")?\s*\)/g, (_, alt, url, title) => {
    const u = safeUrl(url);
    if (!u) return escapeHtml(alt);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return stash(`<img src="${escapeHtml(resolve(u))}" alt="${escapeHtml(alt)}"${t} loading="lazy">`);
  });
  s = s.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"([^"\n]*)")?\s*\)/g, (_, label, url) => {
    const u = safeUrl(url);
    const inner = emphasis(escapeHtml(label));
    if (!u) return stash(inner);
    const rel = isExternal(u) ? ' rel="noopener"' : '';
    return stash(`<a href="${escapeHtml(resolve(u))}"${rel}>${inner}</a>`);
  });
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => stash(`<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url)}</a>`));

  s = emphasis(escapeHtml(s));
  s = s.replace(/ {2,}\n|\\\n/g, '<br>\n');
  for (let i = 0; i < 4 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[n]);
  return s;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const blockStart = (line) =>
  /^```/.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line) || LIST_ITEM.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);

export function renderMarkdown(src, opts = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
  const offset = opts.headingOffset || 0;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (/^\s*$/.test(line)) {
      i++;
    } else if ((m = line.match(/^```\s*([\w+#.-]*)\s*$/))) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const cls = m[1] ? ` class="language-${escapeHtml(m[1])}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const level = Math.min(6, m[1].length + offset);
      out.push(`<h${level}>${renderInline(m[2], opts)}</h${level}>`);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), opts)}</blockquote>`);
    } else if ((m = line.match(LIST_ITEM))) {
      const ordered = /\d/.test(m[2]);
      const start = ordered ? Number.parseInt(m[2], 10) : 1;
      const items = [];
      while (i < lines.length) {
        const im = lines[i].match(LIST_ITEM);
        if (im && /\d/.test(im[2]) === ordered) {
          items.push([im[3]]);
          i++;
        } else if (items.length && /^\s+\S/.test(lines[i])) {
          items[items.length - 1].push(lines[i].trim());
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${startAttr}>${items.map((it) => `<li>${renderInline(it.join('\n'), opts)}</li>`).join('')}</${tag}>`);
    } else {
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !(buf.length && blockStart(lines[i]))) buf.push(lines[i++]);
      out.push(`<p>${renderInline(buf.join('\n'), opts)}</p>`);
    }
  }
  return out.join('\n');
}

/** Plain-text version (for meta descriptions and RSS titles). */
export function markdownToText(src) {
  return String(src ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
