/**
 * A forgiving BibTeX reader: enough to turn the .bib file you already maintain
 * (or export from Google Scholar, DBLP, Zotero) into publication entries.
 */

const MONTHS = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

const ACCENTS = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ć', S: 'Ś' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', O: 'Ö', U: 'Ü' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
  '.': { z: 'ż', I: 'İ', e: 'ė' },
  c: { c: 'ç', s: 'ş', C: 'Ç', S: 'Ş' },
  v: { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', n: 'ň', C: 'Č', S: 'Š', Z: 'Ž', R: 'Ř' },
  u: { g: 'ğ', a: 'ă', G: 'Ğ' },
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  k: { a: 'ą', e: 'ę' },
};

export function cleanLatex(input) {
  let s = String(input ?? '');
  s = s.replace(/\\(?:textbf|textit|emph|texttt|textsc|textrm|mbox|text|url|mathrm)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\{?\\([`'"^~=.]|[cvuHk](?![a-zA-Z]{2}))\s*\{?\\?([a-zA-Z])\}?\}?/g, (m, acc, ch) => ACCENTS[acc]?.[ch] ?? ch);
  s = s
    .replace(/\\ss(?![a-zA-Z])/g, 'ß')
    .replace(/\\aa(?![a-zA-Z])/g, 'å')
    .replace(/\\AA(?![a-zA-Z])/g, 'Å')
    .replace(/\\ae(?![a-zA-Z])/g, 'æ')
    .replace(/\\o(?![a-zA-Z])/g, 'ø')
    .replace(/\\O(?![a-zA-Z])/g, 'Ø')
    .replace(/\\l(?![a-zA-Z])/g, 'ł')
    .replace(/\\L(?![a-zA-Z])/g, 'Ł')
    .replace(/\\i(?![a-zA-Z])/g, 'ı');
  s = s.replace(/\\([&%$#_{}])/g, '$1');
  s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/``|''/g, '"').replace(/~/g, ' ');
  s = s.replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Splits on top-level " and " (not inside braces). */
function splitAuthors(raw) {
  const parts = [];
  let depth = 0;
  let cur = '';
  const s = String(raw);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth === 0 && /\s/.test(c) && /^and\s/i.test(s.slice(i + 1, i + 5))) {
      parts.push(cur);
      cur = '';
      i += 4;
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function formatAuthor(raw) {
  const name = String(raw).trim();
  if (/^others$/i.test(name)) return 'et al.';
  const pieces = [];
  let depth = 0;
  let cur = '';
  for (const c of name) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      pieces.push(cur);
      cur = '';
    } else cur += c;
  }
  pieces.push(cur);
  const [last, ...rest] = pieces.map((p) => cleanLatex(p));
  if (!rest.length) return last;
  // "Last, Jr, First" or "Last, First"
  const first = rest.length === 2 ? rest[1] : rest[0];
  const suffix = rest.length === 2 ? `, ${rest[0]}` : '';
  return `${first} ${last}${suffix}`.trim();
}

export function parseBibtex(src) {
  const s = String(src ?? '');
  const entries = [];
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf('@', i);
    if (at === -1) break;
    const head = /^@\s*([a-zA-Z]+)\s*([({])/.exec(s.slice(at, at + 80));
    if (!head) {
      i = at + 1;
      continue;
    }
    const type = head[1].toLowerCase();
    const closeChar = head[2] === '{' ? '}' : ')';
    const start = at + head[0].length;
    let depth = 0;
    let k = start;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0 && closeChar === '}') break;
        depth--;
      } else if (c === ')' && closeChar === ')' && depth === 0) break;
    }
    const body = s.slice(start, k);
    const raw = s.slice(at, k + 1).trim();
    i = k + 1;
    if (['comment', 'preamble', 'string'].includes(type)) continue;

    const keyMatch = /^\s*([^,\s]*)\s*,/.exec(body);
    const key = keyMatch ? keyMatch[1] : '';
    let p = keyMatch ? keyMatch[0].length : 0;
    const fields = {};
    const skipWs = () => {
      while (p < body.length && /\s/.test(body[p])) p++;
    };
    while (p < body.length) {
      const fm = /^\s*([\w:.+-]+)\s*=\s*/.exec(body.slice(p));
      if (!fm) break;
      const name = fm[1].toLowerCase();
      p += fm[0].length;
      const parts = [];
      while (p < body.length) {
        skipWs();
        const c = body[p];
        if (c === '{') {
          let d = 0;
          let q = p;
          for (; q < body.length; q++) {
            if (body[q] === '{') d++;
            else if (body[q] === '}' && --d === 0) break;
          }
          parts.push(body.slice(p + 1, q));
          p = q + 1;
        } else if (c === '"') {
          let d = 0;
          let q = p + 1;
          for (; q < body.length; q++) {
            if (body[q] === '{') d++;
            else if (body[q] === '}') d--;
            else if (body[q] === '"' && d === 0 && body[q - 1] !== '\\') break;
          }
          parts.push(body.slice(p + 1, q));
          p = q + 1;
        } else {
          const word = /^[^,#\s}]+/.exec(body.slice(p));
          if (!word) break;
          parts.push(MONTHS[word[0].toLowerCase()] || word[0]);
          p += word[0].length;
        }
        skipWs();
        if (body[p] === '#') {
          p++;
          continue;
        }
        break;
      }
      fields[name] = parts.join('');
      while (p < body.length && body[p] !== ',') p++;
      p++;
    }
    entries.push({ type, key, fields, raw });
  }
  return entries;
}

export function entryToPublication(entry) {
  const f = entry.fields;
  const c = (k) => (f[k] ? cleanLatex(f[k]) : '');
  const journal = c('journal');
  const booktitle = c('booktitle');
  const url = (f.url || '').trim();

  let arxiv = '';
  if (f.eprint && (/arxiv/i.test(f.archiveprefix || '') || /arxiv/i.test(journal))) arxiv = f.eprint.trim();
  const arxivUrl = url.match(/arxiv\.org\/(?:abs|pdf)\/([\w.\-/]+?)(?:v\d+)?(?:\.pdf)?$/i);
  if (!arxiv && arxivUrl) arxiv = arxivUrl[1];
  if (!arxiv) {
    const corr = journal.match(/arXiv[:\s]*(?:preprint\s*)?(?:arXiv:)?\s*(\d{4}\.\d{4,5})/i);
    if (corr) arxiv = corr[1];
  }

  let type = 'other';
  if (['inproceedings', 'conference', 'proceedings'].includes(entry.type)) type = /workshop/i.test(booktitle) ? 'workshop' : 'conference';
  else if (entry.type === 'article') type = /arxiv|corr|preprint/i.test(journal) ? 'preprint' : 'journal';
  else if (['phdthesis', 'mastersthesis', 'thesis'].includes(entry.type)) type = 'thesis';
  else if (['misc', 'unpublished', 'techreport', 'online'].includes(entry.type) && arxiv) type = 'preprint';

  const doi = (f.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const pdf = (f.pdf || '').trim() || (/\.pdf($|\?)/i.test(url) && !arxivUrl ? url : '');
  const extraLinks = [];
  if (url && !arxivUrl && url !== pdf && !/doi\.org\//i.test(url)) extraLinks.push({ label: 'Website', url });

  const year = Number.parseInt(f.year, 10);
  const pub = {
    title: c('title'),
    authors: splitAuthors(f.author || '').map(formatAuthor),
    venue: booktitle || journal || c('school') || c('institution') || c('howpublished') || c('publisher'),
    year: Number.isFinite(year) ? year : undefined,
    type,
    doi: doi || undefined,
    arxiv: arxiv || undefined,
    pdf: pdf || undefined,
    code: (f.code || f.github || '').trim() || undefined,
    abstract: c('abstract') || undefined,
    extraLinks: extraLinks.length ? extraLinks : undefined,
    bibtex: entry.raw,
  };
  for (const k of Object.keys(pub)) if (pub[k] === undefined) delete pub[k];
  return pub;
}

export const normalizeTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
