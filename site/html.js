/**
 * Auto-escaping template literals: html`<p>${userText}</p>` escapes userText.
 * Wrap trusted HTML in raw() (or nest another html`` result) to insert it unescaped.
 */
import { escapeHtml } from '../shared/markdown.js';

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (s) => new SafeHtml(String(s ?? ''));

function stringify(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(stringify).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += stringify(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** JSON safe to place inside <script type="application/json"> or ld+json. */
export const jsonForScript = (data) => raw(JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
