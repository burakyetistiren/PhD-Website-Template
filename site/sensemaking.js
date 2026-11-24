/**
 * The sensemaking diagram for custom pages: an interactive redrawing of Pirolli and Card's
 * notional model of sensemaking (2005), with what each of your tools does at every stage,
 * followed by one section per tool (summary, links, video, figures, demo).
 *
 * Content comes from a page's `sensemaking` and `tools` fields (server/schema.js).
 * Everything is rendered here, on the server: without JavaScript, the diagram's stages are
 * links to a list of every stage and its notes. site/assets/sensemaking.js turns that list
 * into one panel that follows the selected stage, and makes "Play from 1:25" buttons seek
 * the tool's video in place.
 */
import { html } from './html.js';

export const CITATION = {
  text: 'Adapted from P. Pirolli and S. Card, "The sensemaking process and leverage points for analyst technology as identified through cognitive task analysis," International Conference on Intelligence Analysis, 2005.',
};

// The six representations, from raw data (bottom left) to a finished story (top right).
const DATA = [
  { id: 'external-data', label: 'External data sources', lines: ['External data', 'sources'], about: 'Everything that might be relevant: raw, unfiltered and too much to read.' },
  { id: 'shoebox', label: 'Shoebox', about: 'A smaller collection, kept because it looks relevant.' },
  { id: 'evidence-file', label: 'Evidence file', about: 'The snippets pulled out of the shoebox, ready to be connected.' },
  { id: 'schema', label: 'Schema', about: 'The evidence re-represented (as a graph, a timeline, a set of rules) so that patterns show.' },
  { id: 'hypotheses', label: 'Hypotheses', about: 'Tentative explanations, each backed by the schema.' },
  { id: 'presentation', label: 'Presentation', about: 'The conclusion, told to someone else.' },
];

// The processes between representation i and i + 1: one bottom-up, one top-down.
const PROCESSES = [
  { up: ['search-filter', 'Search & filter', 'Pick out the material worth a closer look.'], down: ['search-information', 'Search for information', 'Go back to the raw sources for material the shoebox is missing.'] },
  { up: ['read-extract', 'Read & extract', 'Read closely and pull out the pieces that matter.'], down: ['search-relations', 'Search for relations', 'Look for more items connected to what was already extracted.'] },
  { up: ['schematize', 'Schematize', 'Arrange the evidence so that its structure shows.'], down: ['search-evidence', 'Search for evidence', 'Look for evidence that fills gaps in the schema.'] },
  { up: ['build-case', 'Build case', 'Argue for an explanation, with the evidence for and against it.'], down: ['search-support', 'Search for support', 'Check the schema for support, or for counter-evidence.'] },
  { up: ['tell-story', 'Tell story', 'Turn the strongest explanation into something others can follow.'], down: ['reevaluate', 'Reevaluate', 'Feedback on the story sends the analysis back to its hypotheses.'] },
];

/** Every stage, keyed by id: { id, label, about, kind: 'data'|'up'|'down', loop, index }. */
export const STAGES = new Map();
DATA.forEach((d, i) => STAGES.set(d.id, { ...d, kind: 'data', index: i, loop: i < 3 ? 'foraging' : 'sensemaking' }));
PROCESSES.forEach((p, i) => {
  const loop = i < 2 ? 'foraging' : 'sensemaking';
  STAGES.set(p.up[0], { id: p.up[0], label: p.up[1], about: p.up[2], kind: 'up', index: i, loop, from: DATA[i].label, to: DATA[i + 1].label });
  STAGES.set(p.down[0], { id: p.down[0], label: p.down[1], about: p.down[2], kind: 'down', index: i, loop, from: DATA[i + 1].label, to: DATA[i].label });
});

/** Tour order: up the staircase (representations and bottom-up steps), then back down. */
export const STAGE_ORDER = [
  ...DATA.flatMap((d, i) => (i < PROCESSES.length ? [d.id, PROCESSES[i].up[0]] : [d.id])),
  ...PROCESSES.map((p) => p.down[0]).reverse(),
];

/** Options for the "Stage" select in the admin, in tour order. */
export const STAGE_OPTIONS = STAGE_ORDER.map((id) => {
  const s = STAGES.get(id);
  const label = s.kind === 'data' ? s.label : `${s.label} (${s.from} → ${s.to})`;
  return { value: id, label };
});

const KIND_LABEL = {
  data: 'Representation',
  up: 'Bottom-up: from data toward a story',
  down: 'Top-down: from a story back to the data',
};
const LOOP_LABEL = { foraging: 'Foraging loop', sensemaking: 'Sensemaking loop' };

/** "1:25", "01:02:03" or "85" → seconds; anything else → null. */
export function parseMoment(value) {
  const m = String(value ?? '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/);
  if (!m) return null;
  if (m[4] !== undefined) return Number(m[4]);
  const secs = Number(m[3]);
  if (secs > 59) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + secs;
}

export function formatMoment(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Works out how a video link plays: a YouTube or Vimeo address becomes an embedded player,
 * anything else is treated as a video file. Returns { type, src, at(seconds) } where `src` is
 * what goes in the page and `at` is a link to that moment for visitors without JavaScript.
 */
export function videoSource(url) {
  const u = String(url || '').trim();
  let m = u.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([\w-]{11})/i);
  if (m) {
    const id = m[1];
    return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, at: (t) => `https://www.youtube.com/watch?v=${id}&t=${t}s` };
  }
  m = u.match(/^https?:\/\/(?:www\.)?(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/i);
  if (m) {
    const id = m[1];
    return { type: 'vimeo', src: `https://player.vimeo.com/video/${id}`, at: (t) => `https://vimeo.com/${id}#t=${t}s` };
  }
  return { type: 'file', src: u, at: (t) => `${u}#t=${t}` };
}

const slugify = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Tools with stable, unique anchor ids, and their notes grouped by stage. */
function prepare(tools) {
  const used = new Set();
  const list = (tools || []).filter((t) => t && t.name).map((tool) => {
    let id = `tool-${slugify(tool.name) || 'item'}`;
    for (let n = 2; used.has(id); n++) id = `tool-${slugify(tool.name) || 'item'}-${n}`;
    used.add(id);
    return { ...tool, anchor: id, figures: tool.figures || [], video: tool.video ? videoSource(tool.video) : null };
  });
  const notes = new Map([...STAGES.keys()].map((k) => [k, []]));
  for (const tool of list) {
    for (const note of tool.stages || []) if (notes.has(note.stage) && note.text) notes.get(note.stage).push({ tool, note });
  }
  return { list, notes };
}

// ── The diagram ────────────────────────────────────────────────────────────
// Geometry in SVG units. Representation i sits at (X0 + i·DX, Y0 − i·DY). Between i and i+1
// the bottom-up arrow leaves i's right edge and rises into i+1; the top-down arrow leaves
// i+1's left edge and drops onto i. Bottom-up labels sit to the right of their arrow,
// top-down labels to the left, so nothing crosses.
const W = 156;
const H = 56;
const DX = 132;
const DY = 76;
const X0 = 116; // leaves room for the first top-down label, which sits left of its arrow
const Y0 = 24 + 5 * DY;
const VIEW_W = X0 + 5 * DX + W / 2 + 10 + 120; // the last bottom-up label is the rightmost thing
const VIEW_H = Y0 + H + 18;

const nodeX = (i) => X0 + i * DX;
const nodeY = (i) => Y0 - i * DY;

function noteDots(count, cx, y) {
  if (!count) return '';
  const n = Math.min(count, 6);
  const start = cx - ((n - 1) * 9) / 2;
  return html`<g class="sm-dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => html`<circle cx="${start + k * 9}" cy="${y}" r="2.6"></circle>`)}</g>`;
}

function stageTitle(stage, count) {
  const tail = count ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : '';
  return stage.kind === 'data' ? `${stage.label}${tail}` : `${stage.label}, ${stage.from} to ${stage.to}${tail}`;
}

function nodeMark(stage, n) {
  const i = stage.index;
  const x = nodeX(i);
  const y = nodeY(i);
  const lines = DATA[i].lines || [stage.label];
  const textY = y + H / 2 - (lines.length - 1) * 8 - (n ? 4 : 0);
  return html`<a class="sm-node${n ? ' has-notes' : ''}" href="#sm-${stage.id}" data-sm-stage="${stage.id}" data-loop="${stage.loop}">
  <title>${stageTitle(stage, n)}</title>
  <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8"></rect>
  <text class="sm-node-label" x="${x + W / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central">${lines.map((line, k) => html`<tspan x="${x + W / 2}" dy="${k ? 16 : 0}">${line}</tspan>`)}</text>
  ${noteDots(n, x + W / 2, y + H - 10)}
</a>`;
}

// The wide invisible `sm-hit` stroke makes the arrow easy to click; it stops short of the boxes
// so clicks on a box's edge still pick the box.
function processMark(stage, n) {
  const x = nodeX(stage.index);
  const y = nodeY(stage.index);
  const dot = n ? html`<tspan class="sm-proc-count" dx="${stage.kind === 'up' ? 5 : -5}">•</tspan>` : '';
  let line;
  let hit;
  let label;
  if (stage.kind === 'up') {
    const turn = x + DX + W / 2; // right of box i, then up into box i + 1
    line = `M${x + W} ${y + H / 2}H${turn}V${y - DY + H + 3}`;
    hit = `M${x + W + 12} ${y + H / 2}H${turn}V${y - DY + H + 12}`;
    label = html`<text class="sm-proc-label" x="${turn + 10}" y="${y + 6}">${stage.label}${dot}</text>`;
  } else {
    const turn = x + W / 2; // left of box i + 1, then down onto box i
    line = `M${x + DX} ${y - DY + H / 2}H${turn}V${y - 3}`;
    hit = `M${x + DX - 12} ${y - DY + H / 2}H${turn}V${y - 12}`;
    label = html`<text class="sm-proc-label" x="${turn - 10}" y="${y - DY + H / 2 + 24}" text-anchor="end">${dot}${n ? ' ' : ''}${stage.label}</text>`;
  }
  return html`<a class="sm-proc sm-proc--${stage.kind}${n ? ' has-notes' : ''}" href="#sm-${stage.id}" data-sm-stage="${stage.id}" data-loop="${stage.loop}">
  <title>${stageTitle(stage, n)}</title>
  <path class="sm-hit" d="${hit}"></path>
  <path class="sm-line" d="${line}" marker-end="url(#sm-head)"></path>
  ${label}
</a>`;
}

/** The drawing. Marks are emitted in walk-through order, so Tab and the arrow keys follow the loop. */
function diagramSvg(notes) {
  const marks = STAGE_ORDER.map((id) => {
    const stage = STAGES.get(id);
    const n = notes.get(id).length;
    return stage.kind === 'data' ? nodeMark(stage, n) : processMark(stage, n);
  });
  return html`<svg class="sm-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" role="group" aria-label="Pirolli and Card's sensemaking loop. Each stage is a link.">
<defs><marker id="sm-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5L8 5L1 8.5" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></marker></defs>
${marks}
</svg>`;
}

// ── Stage panels ───────────────────────────────────────────────────────────

function noteCard(h, { tool, note }) {
  const fig = note.figure ? tool.figures[note.figure - 1] : null;
  const secs = parseMoment(note.videoAt);
  const seek = tool.video && secs !== null
    ? html`<a class="sm-play" href="${h.href(tool.video.at(secs))}" data-sm-seek="${tool.anchor}" data-sm-at="${secs}"${tool.video.type === 'file' ? '' : h.ext(tool.video.at(secs))}><span aria-hidden="true">▶</span> Play from ${formatMoment(secs)}</a>`
    : '';
  const tryIt = note.tryUrl ? h.a(note.tryUrl, 'Try this step', ' class="try"') : '';
  return html`<article class="sm-note">
  <h4 class="sm-note-tool"><a href="#${tool.anchor}">${tool.name}</a></h4>
  <div class="sm-note-text">${h.md(note.text, { headingOffset: 4 })}</div>
  ${fig?.image ? html`<a class="sm-note-fig" href="#${tool.anchor}-fig-${note.figure}"><img src="${h.href(fig.image)}" alt="" loading="lazy"><span>Figure ${note.figure}${fig.caption ? html`: ${fig.caption}` : ''}</span></a>` : ''}
  ${seek || tryIt ? html`<p class="links sm-note-links">${seek}${tryIt}</p>` : ''}
</article>`;
}

function panel(h, stage, items) {
  const pos = STAGE_ORDER.indexOf(stage.id);
  const prev = STAGES.get(STAGE_ORDER[(pos - 1 + STAGE_ORDER.length) % STAGE_ORDER.length]);
  const next = STAGES.get(STAGE_ORDER[(pos + 1) % STAGE_ORDER.length]);
  const where = stage.kind === 'data' ? '' : html` <span class="sm-panel-route">${stage.from} → ${stage.to}</span>`;
  return html`<section class="sm-panel" id="sm-${stage.id}" data-sm-panel="${stage.id}" data-loop="${stage.loop}" aria-labelledby="sm-${stage.id}-title">
  <p class="sm-panel-kind">${LOOP_LABEL[stage.loop]} · ${KIND_LABEL[stage.kind]}</p>
  <h3 class="sm-panel-title" id="sm-${stage.id}-title">${stage.label}${where}</h3>
  <p class="sm-panel-about">${stage.about}</p>
  ${items.length ? html`<div class="sm-notes">${items.map((it) => noteCard(h, it))}</div>` : html`<p class="sm-panel-empty">None of the tools below has a note for this stage yet.</p>`}
  <nav class="sm-step" aria-label="Walk through the loop">
    <a href="#sm-${prev.id}" data-sm-stage="${prev.id}" rel="prev"><span aria-hidden="true">←</span> ${prev.label}</a>
    <a href="#sm-${next.id}" data-sm-stage="${next.id}" rel="next">${next.label} <span aria-hidden="true">→</span></a>
  </nav>
</section>`;
}

// ── Tool sections ──────────────────────────────────────────────────────────

function videoPlayer(h, tool) {
  const v = tool.video;
  if (!v) return '';
  const label = `Video: ${tool.name}`;
  if (v.type === 'file') {
    const src = h.href(v.src);
    if (!src) return '';
    return html`<div class="sm-video"><video id="${tool.anchor}-video" data-sm-video="file" controls preload="metadata" playsinline${tool.poster ? html` poster="${h.href(tool.poster)}"` : ''} aria-label="${label}"><source src="${src}">Your browser can't play this video. <a href="${src}">Download it</a>.</video></div>`;
  }
  return html`<div class="sm-video sm-video--embed"><iframe id="${tool.anchor}-video" data-sm-video="${v.type}" src="${v.src}" title="${label}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

function toolSection(h, tool, demosBySlug) {
  const demo = tool.demo && demosBySlug.get(tool.demo);
  const links = [
    demo ? html`<a class="try" href="${h.href(`/demos/${demo.slug}`)}">Try the demo</a>` : null,
    ...(tool.links || []).map((l) => h.a(l.url, l.label)),
  ].filter(Boolean);
  const figures = tool.figures.filter((f) => f.image);
  return html`<section class="sm-tool" id="${tool.anchor}" aria-labelledby="${tool.anchor}-title">
  <header class="sm-tool-head">
    <h2 class="sm-tool-title" id="${tool.anchor}-title">${tool.name}${tool.venue ? html` <span class="sm-tool-venue">${tool.venue}</span>` : ''}</h2>
    ${tool.tagline ? html`<p class="sm-tool-tagline">${tool.tagline}</p>` : ''}
  </header>
  ${tool.summary ? html`<div class="prose">${h.md(tool.summary, { headingOffset: 2 })}</div>` : ''}
  ${links.length ? html`<p class="links">${links}</p>` : ''}
  ${videoPlayer(h, tool)}
  ${figures.length
    ? html`<div class="sm-figs">${tool.figures.map((f, i) => (f.image
      ? html`<figure class="sm-fig" id="${tool.anchor}-fig-${i + 1}">
    <a href="${h.href(f.image)}"><img src="${h.href(f.image)}" alt="${f.alt || f.caption || ''}" loading="lazy"></a>
    <figcaption><span class="sm-fig-n">Figure ${i + 1}.</span> ${f.caption || ''}</figcaption>
  </figure>`
      : ''))}</div>`
    : ''}
</section>`;
}

/**
 * The diagram and the tool sections for a page, as parts that go straight into <main>
 * (so scroll animations treat each as one part). `h` is the page renderer's helpers:
 * { href(url), a(url, label, attrs), md(src, opts), ext(url), assetVersion }.
 */
export function renderSensemaking(page, content, h) {
  const { list, notes } = prepare(page.tools);
  const start = STAGE_ORDER.find((id) => notes.get(id).length) || STAGE_ORDER[0];
  const demosBySlug = new Map((content.demos || []).map((d) => [d.slug, d]));
  const v = h.assetVersion ? `?v=${h.assetVersion}` : '';
  const diagram = html`<section class="sm" data-sm data-sm-start="${start}" aria-label="Sensemaking loop">
  <link rel="stylesheet" href="${h.href('/assets/sensemaking.css')}${v}">
  <figure class="sm-figure">
    <div class="sm-canvas">${diagramSvg(notes)}</div>
    <figcaption class="sm-caption">
      <span class="sm-key"><span class="sm-key-swatch" data-loop="foraging"></span>Foraging loop</span>
      <span class="sm-key"><span class="sm-key-swatch" data-loop="sensemaking"></span>Sensemaking loop</span>
      <span class="sm-key"><span class="sm-key-line"></span>Bottom-up</span>
      <span class="sm-key"><span class="sm-key-line sm-key-line--down"></span>Top-down</span>
      <span class="sm-cite">${CITATION.text}</span>
    </figcaption>
  </figure>
  <div class="sm-panels" data-sm-panels>${STAGE_ORDER.map((id) => panel(h, STAGES.get(id), notes.get(id)))}</div>
  <script src="${h.href('/assets/sensemaking.js')}${v}" defer></script>
</section>`;
  return { diagram, tools: list.map((t) => toolSection(h, t, demosBySlug)) };
}
