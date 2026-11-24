/**
 * Server-side rendering for the public site. Every page is rendered from content.json on
 * request, so edits made in the admin console show up immediately, and search engines and
 * visitors without JavaScript see the full page.
 *
 * To change the layout, edit the templates below and site/assets/site.css.
 */
import { html, raw, jsonForScript } from './html.js';
import { renderMarkdown, renderInline, markdownToText, safeUrl, escapeHtml } from '../shared/markdown.js';
import { SINGLETONS, withDefaults } from '../server/schema.js';
import { THEMES, resolveTheme, themeFontsUrl } from './themes.js';
import { renderSensemaking } from './sensemaking.js';

// Values of Site settings → Animations that animate (everything except "none").
const MOTION_STYLES = new Set(['fade', 'rise', 'slide', 'focus']);
// Cross-document view transitions: both pages must opt in. The header keeps its own
// transition name so it stays put while the rest of the page cross-fades.
const PAGE_TRANSITION_CSS = '@media (prefers-reduced-motion: no-preference){@view-transition{navigation:auto}.masthead{view-transition-name:masthead}}';

const DEFAULT_SECTIONS = [
  { section: 'about' },
  { section: 'news', limit: 5 },
  { section: 'publications', limit: 6 },
  { section: 'demos' },
  { section: 'projects', limit: 4 },
];
const SECTION_TITLES = {
  about: 'About',
  news: 'News',
  publications: 'Selected publications',
  demos: 'Demos',
  projects: 'Projects',
  talks: 'Talks',
  teaching: 'Teaching',
};
const DEMO_KIND_LABEL = {
  static: 'Runs in your browser',
  playground: 'Runs on this server',
  embed: 'Hosted elsewhere',
};
const EXPERIENCE_KIND_LABEL = {
  education: 'Education',
  research: 'Research',
  industry: 'Industry',
  teaching: 'Teaching',
  service: 'Service',
  volunteering: 'Volunteering',
  award: 'Awards',
};
const PUB_TYPE_LABEL = {
  conference: 'Conference',
  journal: 'Journal',
  workshop: 'Workshop',
  preprint: 'Preprint',
  thesis: 'Thesis',
  poster: 'Poster & demo',
  other: 'Other',
};

// ── Helpers ────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso, { day = true } = {}) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return String(iso || '');
  const month = MONTHS[Number(m[2]) - 1];
  return day && m[3] ? `${month} ${Number(m[3])}, ${m[1]}` : `${month} ${m[1]}`;
}

const formatMonth = (ym) => {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
};

const byDateDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

/** Prefixes site-internal URLs with the base path (used by static export to subfolders). */
function href(ctx, url) {
  const s = safeUrl(url);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return (ctx.base || '') + s;
  return s;
}

const md = (ctx, src, opts = {}) => raw(renderMarkdown(src, { resolveUrl: (u) => href(ctx, u), ...opts }));
const mdInline = (ctx, src) => raw(renderInline(src, { resolveUrl: (u) => href(ctx, u) }));
const ext = (url) => (/^https?:\/\//i.test(url) ? raw(' rel="noopener"') : '');

function a(ctx, url, label, attrs = '') {
  const h = href(ctx, url);
  if (!h) return html`${label}`;
  return html`<a href="${h}"${ext(h)}${raw(attrs)}>${label}</a>`;
}

function initials(name) {
  const words = String(name || '?').trim().split(/\s+/);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

const HEX = /^#[0-9a-f]{6}$/i;

export function faviconSvg(content) {
  const settings = withDefaults(SINGLETONS.settings.fields, content.settings);
  const theme = THEMES[resolveTheme(settings.siteTheme)];
  const bg = HEX.test(settings.accent || '') ? settings.accent : theme.favicon.bg;
  const fg = HEX.test(settings.accent || '') ? '#ffffff' : theme.favicon.fg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${escapeHtml(bg)}"/><text x="32" y="42" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="${escapeHtml(fg)}">${escapeHtml(initials(content.profile.name))}</text></svg>`;
}

/** A custom link color from Site settings overrides the theme's, lightened for dark mode. */
function accentOverride(accent) {
  if (!HEX.test(accent || '')) return '';
  const dark = `color-mix(in oklab, ${accent} 55%, white)`;
  return `:root{--accent:${accent}!important;--link:${accent}!important}`
    + `:root[data-theme="dark"],:root[data-theme-pref="dark"]{--link:${dark}!important}`
    + `@media (prefers-color-scheme:dark){:root[data-theme-pref="auto"]:not([data-theme]){--link:${dark}!important}}`;
}

function nameMatcher(profile) {
  const norm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  const names = new Set([profile.name, ...(profile.highlightNames || [])].filter(Boolean).map(norm));
  return (author) => names.has(norm(author));
}

function authorList(authors, isMe) {
  const parts = (authors || []).map((name) => (isMe(name) ? html`<mark class="me">${name}</mark>` : html`${name}`));
  if (parts.length <= 1) return parts;
  if (parts.length === 2) return html`${parts[0]} and ${parts[1]}`;
  return html`${parts.slice(0, -1).map((p) => html`${p}, `)}and ${parts[parts.length - 1]}`;
}

// ── Page shell ─────────────────────────────────────────────────────────────

function layout(content, ctx, { title, description, body, path, wide = false, ogType = 'website' }) {
  const { profile } = content;
  const settings = withDefaults(SINGLETONS.settings.fields, content.settings);
  const siteTitle = settings.siteTitle || profile.name;
  const fullTitle = title ? `${title} | ${siteTitle}` : siteTitle;
  const desc = description || settings.description || markdownToText(profile.tagline || profile.bio || '').slice(0, 200);
  const canonical = ctx.siteUrl ? ctx.siteUrl + (path === '/' ? '/' : path) : '';
  const photo = profile.photo ? (ctx.siteUrl && profile.photo.startsWith('/') ? ctx.siteUrl + profile.photo : profile.photo) : '';
  const nav = settings.nav || [];
  const isCurrent = (url) => url === path || (url !== '/' && path.startsWith(url + '/'));
  const v = ctx.assetVersion ? `?v=${ctx.assetVersion}` : '';
  const style = resolveTheme(settings.siteTheme, ctx.previewTheme);
  const accentCss = accentOverride(settings.accent);
  // Scroll animations: theme.js and site.js act on data-motion; site.css has the styles.
  const motion = MOTION_STYLES.has(settings.animation) ? html` data-motion="${settings.animation}"` : '';

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.position || undefined,
    affiliation: profile.affiliation ? { '@type': 'Organization', name: profile.affiliation, url: profile.affiliationUrl || undefined } : undefined,
    email: profile.email ? `mailto:${profile.email}` : undefined,
    url: ctx.siteUrl || undefined,
    image: photo || undefined,
    sameAs: (profile.links || []).map((l) => l.url).filter((u) => /^https?:/.test(u)),
    knowsAbout: profile.interests?.length ? profile.interests : undefined,
  };

  const footerUpdated = content.meta?.updatedAt ? html`<p class="foot-updated">Updated ${formatDate(content.meta.updatedAt.slice(0, 10))}</p>` : '';

  return html`<!doctype html>
<html lang="en" data-theme-pref="${settings.theme}" data-style="${style}"${motion}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}">
${canonical ? html`<meta property="og:url" content="${canonical}">` : ''}
${photo ? html`<meta property="og:image" content="${photo}">` : ''}
<meta name="twitter:card" content="summary">
<link rel="icon" href="${href(ctx, '/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${siteTitle}: news" href="${href(ctx, '/feed.xml')}">
${settings.webFonts
    ? html`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${themeFontsUrl(style)}">`
    : ''}
<link rel="stylesheet" href="${href(ctx, '/assets/site.css')}${v}">
<link rel="stylesheet" href="${href(ctx, '/assets/themes.css')}${v}">
${accentCss ? html`<style>${raw(accentCss)}</style>` : ''}
${settings.pageTransitions ? raw(`<style>${PAGE_TRANSITION_CSS}</style>`) : ''}
<script src="${href(ctx, '/assets/theme.js')}${v}"></script>
<script type="application/ld+json">${jsonForScript(person)}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="page${wide ? ' page--wide' : ''}">
<header class="masthead">
  <a class="wordmark" href="${href(ctx, '/')}">${profile.name}</a>
  <nav class="nav" aria-label="Main">
    <ul>${nav.map((l) => html`<li><a href="${href(ctx, l.url)}"${isCurrent(l.url) ? raw(' aria-current="page"') : ''}${ext(l.url)}>${l.label}</a></li>`)}</ul>
    ${settings.theme === 'auto'
    ? html`<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch between light and dark">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" fill="currentColor"/></svg>
    </button>`
    : ''}
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  ${settings.footer ? html`<div class="foot-text">${md(ctx, settings.footer)}</div>` : ''}
  ${footerUpdated}
</footer>
</div>
<script src="${href(ctx, '/assets/site.js')}${v}" defer></script>
</body>
</html>`;
}

// ── Building blocks ────────────────────────────────────────────────────────

function portrait(ctx, profile, cls = 'portrait') {
  if (profile.photo) return html`<img class="${cls}" src="${href(ctx, profile.photo)}" alt="${profile.name}" width="120" height="120">`;
  return html`<div class="${cls} ${cls}--initials" aria-hidden="true">${initials(profile.name)}</div>`;
}

function intro(content, ctx) {
  const p = content.profile;
  const affiliation = [
    p.lab ? a(ctx, p.labUrl, p.lab) : null,
    p.affiliation ? a(ctx, p.affiliationUrl, p.affiliation) : null,
  ].filter(Boolean);
  const links = [
    ...(p.email ? [html`<li><a href="mailto:${p.email}">${p.email}</a></li>`] : []),
    ...(p.cv ? [html`<li><a href="${href(ctx, '/cv')}">CV</a></li>`] : []),
    ...(p.links || []).map((l) => html`<li>${a(ctx, l.url, l.label)}</li>`),
  ];
  return html`<header class="intro">
  ${portrait(ctx, p)}
  <div class="intro-text">
    <h1 class="intro-name">${p.name}${p.pronouns ? html` <span class="pronouns">(${p.pronouns})</span>` : ''}</h1>
    <p class="intro-role">${p.position || ''}${affiliation.length ? html`<br>${affiliation.map((x, i) => html`${i ? ', ' : ''}${x}`)}` : ''}</p>
    ${p.tagline ? html`<p class="intro-tagline">${p.tagline}</p>` : ''}
    ${links.length ? html`<ul class="intro-links">${links}</ul>` : ''}
  </div>
</header>`;
}

function demoFrameSrc(ctx, demo) {
  const entry = (demo.entry || 'index.html').replace(/^\/+/, '');
  return href(ctx, `/d/${demo.slug}/${entry}`);
}

export function demoWidget(demo, ctx, { headingLevel = 2, showTitle = true } = {}) {
  const title = showTitle ? html`<span class="bench-title">${demo.title}</span>` : html`<span class="bench-title">${DEMO_KIND_LABEL[demo.kind]}</span>`;
  const height = Math.min(2000, Math.max(200, Number(demo.height) || 560));

  if (demo.kind === 'static' || demo.kind === 'embed') {
    const src = demo.kind === 'static' ? demoFrameSrc(ctx, demo) : href(ctx, demo.embedUrl);
    if (!src) return html`<p class="notice">This demo has no address yet.</p>`;
    // The live server isolates browser demos with a `Content-Security-Policy: sandbox` header,
    // which also covers "Open in a new tab". Static hosts can't send headers, so exported
    // pages use the iframe attribute instead.
    const sandbox = demo.kind === 'static' && demo.isolate !== false && ctx.staticExport
      ? raw(' sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"')
      : '';
    return html`<figure class="bench bench--frame">
  <figcaption class="bench-bar">${title}<a class="bench-open" href="${src}" target="_blank"${ext(src)}>Open in a new tab</a></figcaption>
  <iframe class="bench-frame" src="${src}" title="${demo.title}" loading="lazy" style="height:${height}px"${sandbox} allow="clipboard-write; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</figure>`;
  }

  // playground
  const examples = demo.examples || [];
  const presets = demo.presets || [];
  const id = `pg-${demo.slug}`;
  const runUrl = `${ctx.apiBase || ctx.base || ''}/api/demos/${encodeURIComponent(demo.slug)}/run`;
  const canRun = ctx.canRun !== false;
  return html`<section class="bench bench--play" data-playground data-run="${runUrl}"${canRun ? '' : raw(' data-offline')} aria-label="${demo.title}">
  <div class="bench-bar">${title}<span class="bench-status" data-status aria-live="polite"></span></div>
  <div class="bench-panes">
    <div class="bench-pane">
      <div class="bench-pane-head">
        <label for="${id}-in">${demo.inputLabel || 'Input'}</label>
        ${examples.length > 1
    ? html`<select data-examples aria-label="Load an example">${examples.map((ex, i) => html`<option value="${i}">${ex.label}</option>`)}</select>`
    : ''}
      </div>
      <textarea id="${id}-in" class="bench-input" data-input spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off">${examples[0]?.input || ''}</textarea>
    </div>
    <div class="bench-pane">
      <div class="bench-pane-head">
        <span>${demo.outputLabel || 'Output'}</span>
        <span class="bench-controls">
          ${presets.length
    ? html`<select data-preset aria-label="Option">${presets.map((pr, i) => html`<option value="${i}">${pr.label}</option>`)}</select>`
    : ''}
          <button type="button" class="bench-run" data-run-button${canRun ? '' : raw(' disabled')}>Run</button>
        </span>
      </div>
      <pre class="bench-output" data-output tabindex="0">${canRun
    ? html`<span class="dim">Press Run, or Ctrl + Enter in the input.</span>`
    : html`<span class="dim">This copy of the site can't run demos.</span>`}</pre>
    </div>
  </div>
  <script type="application/json" data-examples-json>${jsonForScript(examples.map((e) => e.input || ''))}</script>
</section>`;
}

function newsList(ctx, items) {
  return html`<ol class="rows">${items.map(
    (n) => html`<li class="row"><time class="margin" datetime="${n.date}">${formatDate(n.date)}</time><div class="row-body news-text">${mdInline(ctx, n.text)}</div></li>`,
  )}</ol>`;
}

function pubLinks(ctx, p, demosBySlug) {
  const links = [];
  if (p.pdf) links.push(a(ctx, p.pdf, 'PDF'));
  if (p.code) links.push(a(ctx, p.code, 'Code'));
  if (p.arxiv) links.push(a(ctx, `https://arxiv.org/abs/${encodeURIComponent(p.arxiv).replace(/%2F/g, '/')}`, 'arXiv'));
  if (p.doi) links.push(a(ctx, `https://doi.org/${p.doi}`, 'DOI'));
  if (p.slides) links.push(a(ctx, p.slides, 'Slides'));
  if (p.video) links.push(a(ctx, p.video, 'Video'));
  for (const l of p.extraLinks || []) links.push(a(ctx, l.url, l.label));
  const demo = p.demo && demosBySlug.get(p.demo);
  if (demo) links.unshift(html`<a class="try" href="${href(ctx, `/demos/${demo.slug}`)}">Try the demo</a>`);
  return links;
}

function publication(ctx, p, isMe, demosBySlug) {
  const links = pubLinks(ctx, p, demosBySlug);
  const titleLink = p.pdf || p.doi || (p.arxiv && `https://arxiv.org/abs/${p.arxiv}`);
  return html`<li class="pub" data-type="${p.type || 'other'}">
  <h3 class="pub-title">${titleLink ? a(ctx, p.pdf ? p.pdf : p.doi ? `https://doi.org/${p.doi}` : `https://arxiv.org/abs/${p.arxiv}`, p.title) : p.title}</h3>
  <p class="pub-authors">${authorList(p.authors, isMe)}</p>
  <p class="pub-venue">${p.venue ? html`<cite>${p.venue}</cite>` : ''}${p.status ? html` <span class="pub-status">${p.status}</span>` : ''}${p.award ? html` <span class="award">${p.award}</span>` : ''}</p>
  ${links.length || p.abstract || p.bibtex
    ? html`<div class="pub-links">${links}${p.abstract
      ? html`<details class="pub-more"><summary>Abstract</summary><div class="pub-abstract">${md(ctx, p.abstract)}</div></details>`
      : ''}${p.bibtex
      ? html`<details class="pub-more"><summary>BibTeX</summary><div class="bib"><pre>${p.bibtex}</pre><button type="button" class="copy" data-copy>Copy</button></div></details>`
      : ''}</div>`
    : ''}
</li>`;
}

function publicationsByYear(ctx, pubs, content) {
  const isMe = nameMatcher(content.profile);
  const demosBySlug = new Map(content.demos.map((d) => [d.slug, d]));
  const years = new Map();
  for (const p of pubs) {
    const y = p.year || 'Undated';
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(p);
  }
  const sorted = [...years.entries()].sort((x, y) => (Number(y[0]) || 0) - (Number(x[0]) || 0));
  return html`<ol class="rows">${sorted.map(
    ([year, list]) => html`<li class="row" data-year-group><div class="margin margin--year">${year}</div><ol class="row-body pubs">${list.map((p) => publication(ctx, p, isMe, demosBySlug))}</ol></li>`,
  )}</ol>`;
}

function projectList(ctx, projects, content) {
  const demosBySlug = new Map(content.demos.map((d) => [d.slug, d]));
  const statusLabel = { active: 'Active', maintained: 'Maintained', archived: 'Archived' };
  return html`<ol class="rows">${projects.map((p) => {
    const demo = p.demo && demosBySlug.get(p.demo);
    const links = [
      demo ? html`<a class="try" href="${href(ctx, `/demos/${demo.slug}`)}">Try the demo</a>` : null,
      p.url ? a(ctx, p.url, 'Website') : null,
      p.repo ? a(ctx, p.repo, 'Code') : null,
    ].filter(Boolean);
    return html`<li class="row project">
  <div class="margin">${statusLabel[p.status] || ''}</div>
  <div class="row-body">
    <h3 class="item-title">${p.url || p.repo ? a(ctx, p.url || p.repo, p.name) : p.name}</h3>
    ${p.tagline ? html`<p class="item-sub">${p.tagline}</p>` : ''}
    ${p.image ? html`<img class="project-shot" src="${href(ctx, p.image)}" alt="Screenshot of ${p.name}" loading="lazy">` : ''}
    ${p.description ? html`<div class="prose prose--small">${md(ctx, p.description, { headingOffset: 3 })}</div>` : ''}
    ${p.tags?.length ? html`<ul class="tags">${p.tags.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
    ${links.length ? html`<p class="links">${links}</p>` : ''}
  </div>
</li>`;
  })}</ol>`;
}

function demoList(ctx, demos) {
  return html`<ol class="rows">${demos.map(
    (d) => html`<li class="row">
  <div class="margin">${DEMO_KIND_LABEL[d.kind] || ''}</div>
  <div class="row-body">
    <h3 class="item-title"><a href="${href(ctx, `/demos/${d.slug}`)}">${d.title}</a></h3>
    ${d.summary ? html`<p class="item-sub">${d.summary}</p>` : ''}
    ${d.tags?.length ? html`<ul class="tags">${d.tags.map((t) => html`<li>${t}</li>`)}</ul>` : ''}
  </div>
</li>`,
  )}</ol>`;
}

function talkList(ctx, talks) {
  const kindLabel = { invited: 'Invited talk', tutorial: 'Tutorial', poster: 'Poster', demo: 'Tool demo' };
  return html`<ol class="rows">${talks.map((t) => {
    const links = [t.slides ? a(ctx, t.slides, 'Slides') : null, t.video ? a(ctx, t.video, 'Video') : null].filter(Boolean);
    return html`<li class="row">
  <time class="margin" datetime="${t.date}">${formatDate(t.date, { day: false })}</time>
  <div class="row-body">
    <h3 class="item-title">${t.title}</h3>
    <p class="item-sub">${kindLabel[t.kind] ? html`${kindLabel[t.kind]}, ` : ''}${t.event}${t.location ? html`, ${t.location}` : ''}</p>
    ${links.length ? html`<p class="links">${links}</p>` : ''}
  </div>
</li>`;
  })}</ol>`;
}

function teachingList(ctx, items) {
  return html`<ol class="rows">${items.map(
    (t) => html`<li class="row">
  <div class="margin">${t.term}</div>
  <div class="row-body">
    <h3 class="item-title">${t.url ? a(ctx, t.url, t.course) : t.course}</h3>
    <p class="item-sub">${t.role}${t.institution ? html`, ${t.institution}` : ''}</p>
  </div>
</li>`,
  )}</ol>`;
}

function block(id, title, inner, more) {
  return html`<section class="block" id="${id}" aria-labelledby="h-${id}">
  <h2 class="block-title" id="h-${id}">${title}</h2>
  ${inner}
  ${more || ''}
</section>`;
}

const moreLink = (ctx, path, label) => html`<p class="more"><a href="${href(ctx, path)}">${label}</a></p>`;

function homeSection(content, ctx, cfg) {
  const title = cfg.title || SECTION_TITLES[cfg.section];
  const limit = cfg.limit || Infinity;
  const p = content.profile;
  switch (cfg.section) {
    case 'about': {
      if (!p.bio && !p.interests?.length && !p.advisors?.length) return '';
      return block('about', title, html`<div class="prose">${p.bio ? md(ctx, p.bio, { headingOffset: 2 }) : ''}</div>
  ${p.advisors?.length
    ? html`<p class="aside">Advised by ${p.advisors.map((ad, i) => html`${i ? (i === p.advisors.length - 1 ? ' and ' : ', ') : ''}${a(ctx, ad.url, ad.name)}`)}.</p>`
    : ''}
  ${p.interests?.length ? html`<div class="interests"><h3>Research interests</h3><ul class="tags">${p.interests.map((t) => html`<li>${t}</li>`)}</ul></div>` : ''}`);
    }
    case 'news': {
      const items = [...content.news].sort(byDateDesc);
      if (!items.length) return '';
      return block('news', title, newsList(ctx, items.slice(0, limit)), items.length > limit ? moreLink(ctx, '/news', 'All news') : '');
    }
    case 'publications': {
      const all = content.publications;
      if (!all.length) return '';
      const featured = all.filter((x) => x.featured);
      const list = (featured.length ? featured : all).slice(0, limit);
      return block('publications', title, publicationsByYear(ctx, list, content), moreLink(ctx, '/publications', `All publications (${all.length})`));
    }
    case 'demos': {
      if (!content.demos.length) return '';
      const list = content.demos.slice(0, limit);
      return block('demos', title, demoList(ctx, list), content.demos.length > list.length ? moreLink(ctx, '/demos', 'All demos') : '');
    }
    case 'projects': {
      const all = content.projects;
      if (!all.length) return '';
      const featured = all.filter((x) => x.featured);
      const list = (featured.length ? featured : all).slice(0, limit);
      return block('projects', title, projectList(ctx, list, content), all.length > list.length ? moreLink(ctx, '/projects', 'All projects') : '');
    }
    case 'talks': {
      const items = [...content.talks].sort(byDateDesc);
      if (!items.length) return '';
      return block('talks', title, talkList(ctx, items.slice(0, limit)), items.length > limit ? moreLink(ctx, '/talks', 'All talks') : '');
    }
    case 'teaching': {
      if (!content.teaching.length) return '';
      return block('teaching', title, teachingList(ctx, content.teaching.slice(0, limit)), content.teaching.length > limit ? moreLink(ctx, '/teaching', 'All teaching') : '');
    }
    default:
      return '';
  }
}

// ── Pages ──────────────────────────────────────────────────────────────────

function homePage(content, ctx) {
  const settings = withDefaults(SINGLETONS.settings.fields, content.settings);
  const sections = settings.homeSections?.length ? settings.homeSections : DEFAULT_SECTIONS;
  const hero = settings.heroDemo && content.demos.find((d) => d.slug === settings.heroDemo);
  const body = html`${intro(content, ctx)}
${hero
    ? html`<section class="hero-demo" aria-labelledby="h-hero">
  <div class="hero-demo-head">
    <h2 id="h-hero">Try ${hero.title}</h2>
    ${hero.summary ? html`<p>${hero.summary}</p>` : ''}
    <a href="${href(ctx, `/demos/${hero.slug}`)}">About this demo</a>
  </div>
  ${demoWidget(hero, ctx)}
</section>`
    : ''}
${sections.map((s) => homeSection(content, ctx, s))}`;
  return layout(content, ctx, { body, path: '/', wide: true, ogType: 'profile' });
}

function pageHeader(title, lede) {
  return html`<header class="page-head"><h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}</header>`;
}

function empty(message) {
  return html`<p class="empty">${message}</p>`;
}

function publicationsPage(content, ctx) {
  const pubs = content.publications;
  const types = [...new Set(pubs.map((p) => p.type || 'other'))];
  const filters = types.length > 1
    ? html`<div class="filters" data-pub-filters hidden role="group" aria-label="Show publications of type">
  <button type="button" aria-pressed="true" data-filter="">All <span class="count">${pubs.length}</span></button>
  ${types.map((t) => html`<button type="button" aria-pressed="false" data-filter="${t}">${PUB_TYPE_LABEL[t] || t} <span class="count">${pubs.filter((p) => (p.type || 'other') === t).length}</span></button>`)}
</div>`
    : '';
  const body = html`${pageHeader('Publications')}
${filters}
${pubs.length ? publicationsByYear(ctx, pubs, content) : empty('No publications yet.')}`;
  return layout(content, ctx, { title: 'Publications', body, path: '/publications' });
}

function listPage(content, ctx, { path, title, items, render, emptyText }) {
  const body = html`${pageHeader(title)}${items.length ? render(ctx, items, content) : empty(emptyText)}`;
  return layout(content, ctx, { title, body, path });
}

function demoPage(content, ctx, demo) {
  const pubs = content.publications.filter((p) => p.demo === demo.slug);
  const projects = content.projects.filter((p) => p.demo === demo.slug);
  const isMe = nameMatcher(content.profile);
  const demosBySlug = new Map(content.demos.map((d) => [d.slug, d]));
  const related = pubs.length || projects.length || demo.repo;
  const body = html`${pageHeader(demo.title, demo.summary)}
${demoWidget(demo, ctx, { showTitle: false })}
<div class="demo-about">
  ${demo.description ? html`<div class="prose">${md(ctx, demo.description, { headingOffset: 1 })}</div>` : ''}
  ${related
    ? html`<section class="block block--tight" aria-labelledby="h-related">
    <h2 class="block-title" id="h-related">Related</h2>
    ${demo.repo ? html`<p class="links">${a(ctx, demo.repo, 'Source code')}</p>` : ''}
    ${projects.length ? html`<ul class="plain">${projects.map((p) => html`<li>Project: ${p.url || p.repo ? a(ctx, p.url || p.repo, p.name) : p.name}${p.tagline ? html`, ${p.tagline}` : ''}</li>`)}</ul>` : ''}
    ${pubs.length ? html`<ol class="pubs">${pubs.map((p) => publication(ctx, p, isMe, demosBySlug))}</ol>` : ''}
  </section>`
    : ''}
</div>`;
  return layout(content, ctx, { title: demo.title, description: demo.summary, body, path: `/demos/${demo.slug}`, wide: true });
}

// ── Experience timeline ───────────────────────────────────────────────────
// A vertical line with one circle per entry (the organization's logo, or its initials).
// Entries alternate left and right on wide screens; the dates sit on the opposite side.

function experienceWhen(e) {
  const start = formatMonth(e.start);
  if (e.current) return `${start} – Present`;
  if (!e.end || e.end === e.start) return start;
  return `${start} – ${formatMonth(e.end)}`;
}

const BADGE_SKIP = new Set(['of', 'the', 'and', 'for', 'at', 'in', 'inc', 'inc.', 'ltd', 'llc', 'gmbh']);
function badgeFor(e) {
  if (e.badge) return e.badge;
  const acronym = String(e.organization || '').match(/\(([A-Z0-9]{2,6})\)/);
  if (acronym) return acronym[1];
  const words = String(e.organization || '').split(/[\s,/-]+/).filter((w) => w && !BADGE_SKIP.has(w.toLowerCase()));
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('') || '•';
}

export function experienceTimeline(ctx, entries) {
  // Newest first; entries that start in the same month keep their saved order.
  const sorted = [...entries].sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
  const order = Object.keys(EXPERIENCE_KIND_LABEL);
  const kinds = [...new Set(sorted.map((e) => e.kind || 'research'))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const filters = kinds.length > 1
    ? html`<div class="filters tl-filters" data-tl-filters hidden role="group" aria-label="Show experience of kind">
  <button type="button" aria-pressed="true" data-filter="">All</button>
  ${kinds.map((k) => html`<button type="button" aria-pressed="false" data-filter="${k}">${EXPERIENCE_KIND_LABEL[k] || k}</button>`)}
</div>`
    : '';
  return html`<section class="timeline" data-timeline aria-label="Experience timeline">
${filters}
<ol class="tl">${sorted.map((e, i) => {
    const badge = badgeFor(e);
    const node = e.image
      ? html`<img src="${href(ctx, e.image)}" alt="" loading="lazy">`
      : html`<span class="tl-badge tl-badge--${Math.min(badge.length, 5)}">${badge}</span>`;
    const nodeClass = e.image ? `tl-node tl-node--${e.imageFit === 'fit' ? 'fit' : 'fill'}` : 'tl-node';
    const nodeBg = e.image && /^#[0-9a-f]{6}$/i.test(e.imageBackground || '') ? html` style="--node-bg: ${e.imageBackground}"` : '';
    const cls = ['tl-item', i % 2 ? 'tl-right' : 'tl-left', e.current ? 'tl-current' : '', e.description ? '' : 'tl-compact'].filter(Boolean).join(' ');
    return html`<li class="${cls}" data-kind="${e.kind || 'research'}">
  <div class="${nodeClass}"${nodeBg} aria-hidden="true">${node}</div>
  <p class="tl-when">${experienceWhen(e)}</p>
  <div class="tl-card">
    <h3 class="tl-title">${e.title}</h3>
    <p class="tl-org">${a(ctx, e.organizationUrl, e.organization)}${e.location ? html`, ${e.location}` : ''}</p>
    ${e.description ? html`<div class="tl-desc">${md(ctx, e.description, { headingOffset: 3 })}</div>` : ''}
  </div>
</li>`;
  })}</ol>
</section>`;
}

function customPage(content, ctx, page) {
  const where = page.timeline || 'none';
  const tl = where !== 'none' && content.experience?.length ? experienceTimeline(ctx, content.experience) : '';
  const text = page.body ? html`<div class="prose">${md(ctx, page.body)}</div>` : '';
  // Sensemaking diagram (site/sensemaking.js): the diagram, then one section per tool.
  const smWhere = page.sensemaking || 'none';
  const sm = smWhere !== 'none' ? renderSensemaking(page, content, {
    href: (u) => href(ctx, u), a: (u, label, attrs) => a(ctx, u, label, attrs), md: (src, opts) => md(ctx, src, opts), ext, assetVersion: ctx.assetVersion,
  }) : null;
  const smParts = sm ? html`${sm.diagram}${sm.tools}` : '';
  const body = html`${pageHeader(page.title)}${where === 'top' ? tl : ''}${smWhere === 'top' ? smParts : ''}${text}${smWhere === 'bottom' ? smParts : ''}${where === 'bottom' ? tl : ''}`;
  return layout(content, ctx, { title: page.title, description: markdownToText(page.body || '').slice(0, 200), body, path: `/${page.slug}`, wide: Boolean(tl || sm) });
}

export function notFoundPage(content, ctx) {
  const body = html`${pageHeader("This page doesn't exist", 'It may have moved, or the address has a typo.')}<p class="more"><a href="${href(ctx, '/')}">Go to the home page</a></p>`;
  return layout(content, ctx, { title: 'Not found', body, path: '' });
}

/**
 * Renders a path. Returns { status, html } or { status, redirect } or null for "not mine".
 * ctx: { base, apiBase, siteUrl, canRun, assetVersion }
 */
export function renderRoute(pathname, content, ctx = {}) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const ok = (h) => ({ status: 200, html: String(h) });
  switch (path) {
    case '/':
      return ok(homePage(content, ctx));
    case '/publications':
      return ok(publicationsPage(content, ctx));
    case '/projects':
      return ok(listPage(content, ctx, { path, title: 'Projects', items: content.projects, render: projectList, emptyText: 'No projects yet.' }));
    case '/demos':
      return ok(listPage(content, ctx, { path, title: 'Demos', items: content.demos, render: (c, items) => demoList(c, items), emptyText: 'No demos yet.' }));
    case '/talks':
      return ok(listPage(content, ctx, { path, title: 'Talks', items: [...content.talks].sort(byDateDesc), render: (c, items) => talkList(c, items), emptyText: 'No talks yet.' }));
    case '/teaching':
      return ok(listPage(content, ctx, { path, title: 'Teaching', items: content.teaching, render: (c, items) => teachingList(c, items), emptyText: 'No teaching yet.' }));
    case '/news':
      return ok(listPage(content, ctx, { path, title: 'News', items: [...content.news].sort(byDateDesc), render: (c, items) => newsList(c, items), emptyText: 'No news yet.' }));
    case '/cv':
      return content.profile.cv ? { status: 302, redirect: href(ctx, content.profile.cv) } : null;
    default:
      break;
  }
  let m = path.match(/^\/demos\/([a-z0-9-]+)$/);
  if (m) {
    const demo = content.demos.find((d) => d.slug === m[1]);
    return demo ? ok(demoPage(content, ctx, demo)) : null;
  }
  m = path.match(/^\/([a-z0-9-]+)$/);
  if (m) {
    const page = content.pages.find((p) => p.slug === m[1]);
    return page ? ok(customPage(content, ctx, page)) : null;
  }
  return null;
}

/** Every page path, for static export and the sitemap. */
export function listRoutes(content) {
  const routes = ['/', '/publications', '/projects', '/demos', '/talks', '/teaching', '/news'];
  for (const d of content.demos) routes.push(`/demos/${d.slug}`);
  for (const p of content.pages) routes.push(`/${p.slug}`);
  return routes;
}

export function renderSitemap(content, siteUrl) {
  const urls = listRoutes(content).map((r) => `  <url><loc>${escapeHtml(siteUrl + (r === '/' ? '/' : r))}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function renderFeed(content, siteUrl) {
  const settings = withDefaults(SINGLETONS.settings.fields, content.settings);
  const title = settings.siteTitle || content.profile.name;
  const items = [...content.news].sort(byDateDesc).slice(0, 30).map((n) => {
    const text = markdownToText(n.text);
    const date = new Date(`${n.date}T12:00:00Z`).toUTCString();
    return `  <item>
    <title>${escapeHtml(text.length > 100 ? `${text.slice(0, 97)}…` : text)}</title>
    <link>${escapeHtml(`${siteUrl}/news`)}</link>
    <guid isPermaLink="false">${escapeHtml(n.id)}</guid>
    <pubDate>${date}</pubDate>
    <description>${escapeHtml(renderInline(n.text))}</description>
  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeHtml(title)}: news</title>
  <link>${escapeHtml(`${siteUrl}/`)}</link>
  <description>${escapeHtml(settings.description || `News from ${content.profile.name}`)}</description>
${items.join('\n')}
</channel>
</rss>
`;
}
