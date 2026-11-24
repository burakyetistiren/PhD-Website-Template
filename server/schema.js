import { THEMES, DEFAULT_THEME } from '../site/themes.js';
import { STAGE_OPTIONS } from '../site/sensemaking.js';

/**
 * The content schema. This one file drives three things:
 *   1. validation in the API (validateFields / validateContent),
 *   2. the forms in the admin console (served as JSON from GET /api/schema),
 *   3. which fields are hidden from the public API (`private: true`).
 *
 * To add a field, add it here. The admin console and API pick it up on restart;
 * render it on the site by editing site/render.js.
 *
 * Field types: string, text, markdown, code, url, media, email, date, month, number, boolean,
 *              select, tags, list (of sub-objects), ref (a demo slug), color, slug.
 * `showWhen: { field: value | [values] }` only shows a field in the admin when siblings match.
 * `preview: 'motion'` shows a small animated sample of the chosen option under a select.
 */

const link = [
  { key: 'label', type: 'string', label: 'Label', required: true, max: 60 },
  { key: 'url', type: 'url', label: 'Address', required: true },
];

const HOME_SECTIONS = [
  { value: 'about', label: 'About (bio and interests)' },
  { value: 'news', label: 'News' },
  { value: 'publications', label: 'Publications (featured first)' },
  { value: 'demos', label: 'Demos' },
  { value: 'projects', label: 'Projects (featured first)' },
  { value: 'talks', label: 'Talks' },
  { value: 'teaching', label: 'Teaching' },
];

export const SINGLETONS = {
  profile: {
    label: 'Profile',
    description: 'Who you are. Shown at the top of every page and in search results.',
    fields: [
      { key: 'name', type: 'string', label: 'Full name', required: true, max: 120 },
      { key: 'pronouns', type: 'string', label: 'Pronouns', max: 40 },
      { key: 'position', type: 'string', label: 'Position', max: 160, help: 'For example: PhD candidate in Computer Science' },
      { key: 'affiliation', type: 'string', label: 'University or institute', max: 160 },
      { key: 'affiliationUrl', type: 'url', label: 'University website' },
      { key: 'lab', type: 'string', label: 'Lab or group', max: 160 },
      { key: 'labUrl', type: 'url', label: 'Lab website' },
      {
        key: 'advisors', type: 'list', label: 'Advisors', itemLabel: 'advisor',
        fields: [
          { key: 'name', type: 'string', label: 'Name', required: true, max: 120 },
          { key: 'url', type: 'url', label: 'Website' },
        ],
      },
      { key: 'tagline', type: 'text', label: 'Your research in one sentence', max: 300, help: 'Shown large under your name on the home page.' },
      { key: 'bio', type: 'markdown', label: 'Bio' },
      { key: 'interests', type: 'tags', label: 'Research interests' },
      { key: 'photo', type: 'media', label: 'Photo', accept: 'image/*', help: 'A square image works best. Your initials are shown when this is empty.' },
      { key: 'email', type: 'email', label: 'Email' },
      { key: 'location', type: 'string', label: 'Office or city', max: 160 },
      { key: 'cv', type: 'media', label: 'CV', accept: '.pdf', help: 'Linked from /cv.' },
      { key: 'links', type: 'list', label: 'Profile links', itemLabel: 'link', fields: link, help: 'GitHub, Google Scholar, ORCID, DBLP, Mastodon, …' },
      {
        key: 'highlightNames', type: 'tags', label: 'Your name in author lists',
        help: 'Every spelling of your name that appears in publications, such as "R. Park". These are highlighted.',
      },
    ],
  },
  settings: {
    label: 'Site settings',
    description: 'How the site looks and what the home page shows.',
    fields: [
      { key: 'siteTitle', type: 'string', label: 'Site title', max: 120, help: 'Shown in browser tabs. Defaults to your name.' },
      { key: 'description', type: 'text', label: 'Search engine description', max: 300 },
      {
        key: 'siteTheme', type: 'select', label: 'Default theme', default: DEFAULT_THEME,
        help: 'What visitors see first. They can switch to any theme from the palette menu at the top of every page, and their choice is remembered in their browser.',
        options: Object.entries(THEMES).map(([value, t]) => ({ value, label: `${t.label}: ${t.description}` })),
      },
      {
        key: 'theme', type: 'select', label: 'Light or dark', default: 'auto',
        options: [
          { value: 'auto', label: "Follow the visitor's system, with a toggle" },
          { value: 'light', label: 'Always light' },
          { value: 'dark', label: 'Always dark' },
        ],
      },
      { key: 'accent', type: 'color', label: 'Link color', help: "Optional. Leave empty to use the theme's own color." },
      { key: 'webFonts', type: 'boolean', label: 'Load fonts from Google Fonts', default: true, help: 'Turn off to use system fonts and make no third-party requests.' },
      {
        key: 'animation', type: 'select', label: 'Animations', required: true, default: 'rise', preview: 'motion',
        help: 'How content appears as visitors scroll down. Each part plays once. Visitors who ask their system for reduced motion see no animation.',
        options: [
          { value: 'none', label: 'None' },
          { value: 'fade', label: 'Fade: content fades in' },
          { value: 'rise', label: 'Rise: content fades in while sliding up' },
          { value: 'slide', label: 'Slide: content glides in from the left, timeline cards grow out of the line' },
          { value: 'focus', label: 'Focus: content sharpens out of a soft blur' },
        ],
      },
      {
        key: 'pageTransitions', type: 'boolean', label: 'Cross-fade between pages', default: true,
        help: 'The header stays put while the rest of the page fades over. Works in Chrome, Edge and Safari; other browsers switch pages as usual.',
      },
      { key: 'heroDemo', type: 'ref', collection: 'demos', label: 'Demo on the home page', help: 'Visitors can try it straight from the home page. Leave empty to hide.' },
      {
        key: 'homeSections', type: 'list', label: 'Home page sections', itemLabel: 'section',
        help: 'Shown in this order.',
        fields: [
          { key: 'section', type: 'select', label: 'Section', required: true, options: HOME_SECTIONS },
          { key: 'title', type: 'string', label: 'Heading', max: 80 },
          { key: 'limit', type: 'number', label: 'Show at most', min: 1, max: 200 },
        ],
      },
      { key: 'nav', type: 'list', label: 'Navigation links', itemLabel: 'link', fields: link },
      { key: 'footer', type: 'markdown', label: 'Footer text' },
    ],
  },
};

export const COLLECTIONS = {
  news: {
    label: 'News',
    singular: 'news item',
    titleField: 'text',
    metaField: 'date',
    orderable: false,
    sortHint: 'Shown newest first.',
    fields: [
      { key: 'date', type: 'date', label: 'Date', required: true },
      { key: 'text', type: 'markdown', label: 'What happened', required: true, max: 2000, rows: 3 },
    ],
  },
  publications: {
    label: 'Publications',
    singular: 'publication',
    titleField: 'title',
    metaField: 'venue',
    orderable: true,
    sortHint: 'Grouped by year, newest first. Within a year they keep this order.',
    fields: [
      { key: 'title', type: 'string', label: 'Title', required: true, max: 400 },
      { key: 'authors', type: 'tags', label: 'Authors', required: true, help: 'In order. Your name is highlighted automatically.' },
      { key: 'venue', type: 'string', label: 'Venue', max: 300, help: 'For example: ICSE 2026, or ACM TOSEM' },
      { key: 'year', type: 'number', label: 'Year', required: true, min: 1950, max: 2100 },
      {
        key: 'type', type: 'select', label: 'Type', default: 'conference',
        options: [
          { value: 'conference', label: 'Conference paper' },
          { value: 'journal', label: 'Journal article' },
          { value: 'workshop', label: 'Workshop paper' },
          { value: 'preprint', label: 'Preprint' },
          { value: 'thesis', label: 'Thesis' },
          { value: 'poster', label: 'Poster or demo paper' },
          { value: 'other', label: 'Other' },
        ],
      },
      { key: 'status', type: 'string', label: 'Status', max: 60, help: 'Optional, e.g. "To appear" or "Under review"' },
      { key: 'award', type: 'string', label: 'Award', max: 120 },
      { key: 'featured', type: 'boolean', label: 'Feature on the home page' },
      { key: 'pdf', type: 'media', label: 'PDF', accept: '.pdf' },
      { key: 'code', type: 'url', label: 'Code' },
      { key: 'doi', type: 'string', label: 'DOI', max: 200, help: 'Just the identifier, e.g. 10.1145/3597503.3639187' },
      { key: 'arxiv', type: 'string', label: 'arXiv ID', max: 60, help: 'e.g. 2405.01234' },
      { key: 'slides', type: 'media', label: 'Slides' },
      { key: 'video', type: 'url', label: 'Video' },
      { key: 'demo', type: 'ref', collection: 'demos', label: 'Demo' },
      { key: 'extraLinks', type: 'list', label: 'Other links', itemLabel: 'link', fields: link },
      { key: 'abstract', type: 'markdown', label: 'Abstract' },
      { key: 'bibtex', type: 'code', label: 'BibTeX', help: 'Shown behind a "BibTeX" toggle with a copy button.' },
    ],
  },
  experience: {
    label: 'Experience',
    singular: 'experience entry',
    titleField: 'title',
    metaField: 'organization',
    orderable: false,
    sortHint: 'Shown as a timeline, newest first by start month. Show it on a page by setting that page\'s "Experience timeline" option.',
    fields: [
      { key: 'title', type: 'string', label: 'Role, degree or award', required: true, max: 160 },
      { key: 'organization', type: 'string', label: 'Organization', required: true, max: 200 },
      { key: 'organizationUrl', type: 'url', label: 'Organization website' },
      {
        key: 'kind', type: 'select', label: 'Kind', default: 'research', help: 'Visitors can filter the timeline by kind.',
        options: [
          { value: 'education', label: 'Education' },
          { value: 'research', label: 'Research' },
          { value: 'industry', label: 'Industry' },
          { value: 'teaching', label: 'Teaching' },
          { value: 'service', label: 'Service' },
          { value: 'volunteering', label: 'Volunteering' },
          { value: 'award', label: 'Award' },
        ],
      },
      { key: 'start', type: 'month', label: 'Start', required: true },
      { key: 'end', type: 'month', label: 'End', help: 'Leave empty for something that happened in a single month, like an award.' },
      { key: 'current', type: 'boolean', label: 'Still ongoing', help: 'Shows "Present" as the end, and highlights the circle.' },
      { key: 'location', type: 'string', label: 'Location', max: 120 },
      { key: 'image', type: 'media', label: 'Logo or photo', accept: 'image/*', help: 'Shown in the circle on the timeline.' },
      {
        key: 'imageFit', type: 'select', label: 'How the image sits in the circle', default: 'fill',
        options: [
          { value: 'fill', label: 'Fill the circle (square icons, round seals, photos)' },
          { value: 'fit', label: 'Fit inside with a margin (wide logos and wordmarks)' },
        ],
      },
      { key: 'imageBackground', type: 'color', label: 'Circle colour behind the image', help: "Match the logo's own background so the two blend into one circle. White if empty." },
      { key: 'badge', type: 'string', label: 'Circle text', max: 6, help: "Shown in the circle when there is no image, e.g. MIT. Defaults to the organization's initials." },
      { key: 'description', type: 'markdown', label: 'Description', rows: 4 },
    ],
  },
  projects: {
    label: 'Projects',
    singular: 'project',
    titleField: 'name',
    metaField: 'tagline',
    orderable: true,
    fields: [
      { key: 'name', type: 'string', label: 'Name', required: true, max: 120 },
      { key: 'tagline', type: 'string', label: 'One-line description', max: 240 },
      {
        key: 'status', type: 'select', label: 'Status', default: 'active',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'maintained', label: 'Maintained' },
          { value: 'archived', label: 'Archived' },
        ],
      },
      { key: 'featured', type: 'boolean', label: 'Feature on the home page' },
      { key: 'url', type: 'url', label: 'Website' },
      { key: 'repo', type: 'url', label: 'Source code' },
      { key: 'demo', type: 'ref', collection: 'demos', label: 'Demo' },
      { key: 'image', type: 'media', label: 'Screenshot', accept: 'image/*' },
      { key: 'tags', type: 'tags', label: 'Tags' },
      { key: 'description', type: 'markdown', label: 'Description' },
    ],
  },
  demos: {
    label: 'Demos',
    singular: 'demo',
    titleField: 'title',
    metaField: 'kind',
    orderable: true,
    fields: [
      { key: 'title', type: 'string', label: 'Title', required: true, max: 120 },
      { key: 'slug', type: 'slug', label: 'Address', required: true, unique: true, help: 'The demo lives at /demos/<address>.' },
      { key: 'summary', type: 'string', label: 'One-line summary', max: 240 },
      {
        key: 'kind', type: 'select', label: 'How it runs', required: true, default: 'static',
        options: [
          { value: 'static', label: "In the visitor's browser: upload a built web app (HTML, JS, WASM)" },
          { value: 'playground', label: 'On this server: visitors run your tool on their own input' },
          { value: 'embed', label: 'Somewhere else: embed a page hosted elsewhere' },
        ],
      },
      { key: 'entry', type: 'string', label: 'Start page', default: 'index.html', max: 200, showWhen: { kind: 'static' } },
      {
        key: 'isolate', type: 'boolean', label: 'Sandbox the demo', default: true, showWhen: { kind: 'static' },
        help: 'Keeps the demo from reading your admin session. Turn off only if it needs localStorage, cookies or service workers.',
      },
      { key: 'embedUrl', type: 'url', label: 'Page to embed', showWhen: { kind: 'embed' }, help: 'Hugging Face Spaces, Streamlit, StackBlitz, a YouTube video, asciinema, …' },
      { key: 'height', type: 'number', label: 'Height in pixels', default: 560, min: 200, max: 2000, showWhen: { kind: ['static', 'embed'] } },
      {
        key: 'runner', type: 'select', label: 'Runs with', default: 'docker', showWhen: { kind: 'playground' },
        options: [
          { value: 'docker', label: 'A Docker image on this server, in a sandbox' },
          { value: 'http', label: 'An HTTP endpoint you host elsewhere' },
        ],
      },
      { key: 'image', type: 'string', label: 'Docker image', max: 300, showWhen: { kind: 'playground', runner: 'docker' }, help: 'For example ghcr.io/you/tool:1.2. Build or pull it on the server first.' },
      {
        key: 'command', type: 'string', label: 'Command', max: 1000, showWhen: { kind: 'playground', runner: 'docker' },
        help: 'What follows the image name in `docker run`. The input arrives on stdin; write {input} where your tool expects a file path instead.',
      },
      { key: 'inputFilename', type: 'string', label: 'Input file name', default: 'input.txt', max: 100, showWhen: { kind: 'playground', runner: 'docker' }, help: 'Used when the command contains {input}, so your tool sees the right extension.' },
      { key: 'endpoint', type: 'url', label: 'Endpoint', private: true, showWhen: { kind: 'playground', runner: 'http' }, help: 'Receives POST {"input", "args"} as JSON and returns {"stdout", "stderr", "exitCode"} or plain text.' },
      { key: 'endpointToken', type: 'string', label: 'Endpoint token', private: true, max: 500, showWhen: { kind: 'playground', runner: 'http' }, help: 'Optional. Sent as "Authorization: Bearer <token>". Never shown to visitors.' },
      { key: 'timeoutSec', type: 'number', label: 'Time limit in seconds', default: 10, min: 1, max: 120, showWhen: { kind: 'playground' } },
      { key: 'memoryMb', type: 'number', label: 'Memory limit in MB', default: 256, min: 32, max: 8192, showWhen: { kind: 'playground', runner: 'docker' }, help: 'Files your tool writes to /tmp count toward this limit.' },
      { key: 'cpus', type: 'number', label: 'CPU limit', default: 0.5, min: 0.1, max: 16, step: 0.1, showWhen: { kind: 'playground', runner: 'docker' } },
      { key: 'inputLabel', type: 'string', label: 'Input heading', default: 'Input', max: 60, showWhen: { kind: 'playground' } },
      { key: 'outputLabel', type: 'string', label: 'Output heading', default: 'Output', max: 60, showWhen: { kind: 'playground' } },
      {
        key: 'examples', type: 'list', label: 'Example inputs', itemLabel: 'example', showWhen: { kind: 'playground' },
        help: 'The first one is loaded when the page opens.',
        fields: [
          { key: 'label', type: 'string', label: 'Name', required: true, max: 80 },
          { key: 'input', type: 'code', label: 'Input', max: 100000 },
        ],
      },
      {
        key: 'presets', type: 'list', label: 'Options visitors can pick', itemLabel: 'option', showWhen: { kind: 'playground' },
        help: 'Each option adds arguments to the command (at {args}, or at the end). Visitors can only choose from this list.',
        fields: [
          { key: 'label', type: 'string', label: 'Name', required: true, max: 80 },
          { key: 'args', type: 'string', label: 'Extra arguments', max: 500 },
        ],
      },
      { key: 'repo', type: 'url', label: 'Source code' },
      { key: 'tags', type: 'tags', label: 'Tags' },
      { key: 'description', type: 'markdown', label: 'About this demo' },
    ],
  },
  talks: {
    label: 'Talks',
    singular: 'talk',
    titleField: 'title',
    metaField: 'event',
    orderable: false,
    sortHint: 'Shown newest first.',
    fields: [
      { key: 'title', type: 'string', label: 'Title', required: true, max: 300 },
      { key: 'event', type: 'string', label: 'Event', required: true, max: 200 },
      { key: 'date', type: 'date', label: 'Date', required: true },
      { key: 'location', type: 'string', label: 'Location', max: 160 },
      {
        key: 'kind', type: 'select', label: 'Kind', default: 'talk',
        options: [
          { value: 'talk', label: 'Talk' },
          { value: 'invited', label: 'Invited talk' },
          { value: 'tutorial', label: 'Tutorial' },
          { value: 'poster', label: 'Poster' },
          { value: 'demo', label: 'Tool demo' },
        ],
      },
      { key: 'slides', type: 'media', label: 'Slides' },
      { key: 'video', type: 'url', label: 'Video' },
    ],
  },
  teaching: {
    label: 'Teaching',
    singular: 'course',
    titleField: 'course',
    metaField: 'term',
    orderable: true,
    fields: [
      { key: 'course', type: 'string', label: 'Course', required: true, max: 200 },
      { key: 'role', type: 'string', label: 'Role', required: true, max: 120, help: 'e.g. Teaching assistant, Instructor of record' },
      { key: 'term', type: 'string', label: 'Term', required: true, max: 60, help: 'e.g. Fall 2025' },
      { key: 'institution', type: 'string', label: 'Institution', max: 160 },
      { key: 'url', type: 'url', label: 'Course website' },
    ],
  },
  pages: {
    label: 'Pages',
    singular: 'page',
    titleField: 'title',
    metaField: 'slug',
    orderable: true,
    fields: [
      { key: 'title', type: 'string', label: 'Title', required: true, max: 160 },
      { key: 'slug', type: 'slug', label: 'Address', required: true, unique: true, help: 'The page lives at /<address>. Add it to the navigation in Site settings.' },
      {
        key: 'timeline', type: 'select', label: 'Experience timeline', default: 'none',
        help: 'Shows your Experience entries on this page as a timeline.',
        options: [
          { value: 'none', label: "Don't show" },
          { value: 'top', label: 'Show above the text' },
          { value: 'bottom', label: 'Show below the text' },
        ],
      },
      { key: 'body', type: 'markdown', label: 'Content', rows: 16 },
      {
        key: 'sensemaking', type: 'select', label: 'Sensemaking diagram', default: 'none',
        help: "An interactive drawing of Pirolli and Card's sensemaking loop. Visitors click a stage to see what each tool below does there; each tool also gets its own section with its video and figures.",
        options: [
          { value: 'none', label: "Don't show" },
          { value: 'top', label: 'Show above the text' },
          { value: 'bottom', label: 'Show below the text' },
        ],
      },
      {
        key: 'tools', type: 'list', label: 'Tools on the diagram', itemLabel: 'tool', showWhen: { sensemaking: ['top', 'bottom'] },
        fields: [
          { key: 'name', type: 'string', label: 'Name', required: true, max: 80 },
          { key: 'venue', type: 'string', label: 'Venue', max: 80, help: 'For example: ICSE 2026' },
          { key: 'tagline', type: 'string', label: 'One-line description', max: 240 },
          { key: 'summary', type: 'markdown', label: 'Summary', rows: 4 },
          { key: 'links', type: 'list', label: 'Links', itemLabel: 'link', fields: link, help: 'The paper, the artifact, the source code…' },
          { key: 'demo', type: 'ref', collection: 'demos', label: 'Demo' },
          { key: 'video', type: 'media', label: 'Video', accept: 'video/*', help: 'An MP4 or WebM file, or a YouTube or Vimeo address. Notes can start it at a given moment.' },
          { key: 'poster', type: 'media', label: 'Video still', accept: 'image/*', help: 'Shown before a video file plays.' },
          {
            key: 'figures', type: 'list', label: 'Figures', itemLabel: 'figure', help: 'Numbered in this order. Notes refer to them by number.',
            fields: [
              { key: 'image', type: 'media', label: 'Image', required: true, accept: 'image/*' },
              { key: 'caption', type: 'string', label: 'Caption', max: 400 },
              { key: 'alt', type: 'string', label: 'Description for screen readers', max: 400, help: 'Defaults to the caption.' },
            ],
          },
          {
            key: 'stages', type: 'list', label: 'Notes on the diagram', itemLabel: 'note', help: 'What this tool does at a stage of the loop. Shown when a visitor picks that stage.',
            fields: [
              { key: 'stage', type: 'select', label: 'Stage', required: true, options: STAGE_OPTIONS },
              { key: 'text', type: 'markdown', label: 'What the tool does here', required: true, max: 2000, rows: 3 },
              { key: 'figure', type: 'number', label: 'Figure number', min: 1, max: 200, help: 'Shows that figure next to the note.' },
              { key: 'videoAt', type: 'string', label: 'Video moment', max: 9, help: 'Like 1:25. Adds a button that plays the video from there.' },
              { key: 'tryUrl', type: 'url', label: 'Try-it link', help: 'Optional. Opens the demo at this step.' },
            ],
          },
        ],
      },
    ],
  },
};

/** Addresses that pages may not take because the site already uses them. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'assets', 'shared', 'media', 'd', 'demos', 'publications', 'projects', 'talks',
  'teaching', 'news', 'cv', 'feed.xml', 'sitemap.xml', 'robots.txt', 'favicon.svg', 'favicon.ico',
]);

const DEFAULT_MAX = { string: 300, text: 2000, markdown: 100000, code: 100000, url: 2000, media: 2000, email: 254, slug: 63 };

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Accepts http(s), mailto and relative URLs. Rejects javascript:, data: and friends. */
export function isSafeUrl(value) {
  const u = String(value);
  if (/[\u0000-\u001f\u007f]/.test(u)) return false;
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i);
  return !scheme || ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase());
}

function coerce(field, raw) {
  if (raw === undefined || raw === null) return [undefined];
  const max = field.max ?? DEFAULT_MAX[field.type];
  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'code':
    case 'url':
    case 'media':
    case 'email':
    case 'slug':
    case 'ref':
    case 'color':
    case 'month':
    case 'date': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return [undefined, 'Must be text'];
      let v = String(raw);
      v = field.type === 'code' || field.type === 'markdown' ? v.replace(/\r\n?/g, '\n') : v.trim();
      if (field.type === 'markdown' || field.type === 'text') v = v.trim();
      if (v === '') return [undefined];
      if (max && v.length > max) return [undefined, `Keep this under ${max} characters`];
      if ((field.type === 'url' || field.type === 'media') && !isSafeUrl(v)) return [undefined, 'Use an http(s), mailto or relative address'];
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return [undefined, 'Enter an email address like name@university.edu'];
      if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return [undefined, 'Use the format YYYY-MM-DD'];
      if (field.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return [undefined, 'Use the format YYYY-MM, e.g. 2023-09'];
      if (field.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) return [undefined, 'Use a hex color like #2346d8'];
      if ((field.type === 'slug' || field.type === 'ref') && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) {
        return [undefined, 'Use lowercase letters, numbers and dashes'];
      }
      return [field.type === 'color' ? v.toLowerCase() : v];
    }
    case 'number': {
      if (raw === '') return [undefined];
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return [undefined, 'Must be a number'];
      if (field.min !== undefined && n < field.min) return [undefined, `Must be at least ${field.min}`];
      if (field.max !== undefined && n > field.max) return [undefined, `Must be at most ${field.max}`];
      return [n];
    }
    case 'boolean':
      return [raw === true || raw === 'true' || raw === 'on' || raw === 1];
    case 'select': {
      const v = String(raw);
      if (v === '') return [undefined];
      if (!field.options.some((o) => o.value === v)) return [undefined, 'Pick one of the listed options'];
      return [v];
    }
    case 'tags': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const out = list.map((t) => String(t).trim()).filter(Boolean);
      if (out.length > 200) return [undefined, 'Too many entries (200 at most)'];
      if (out.some((t) => t.length > 200)) return [undefined, 'Each entry must be under 200 characters'];
      return [out.length ? out : undefined];
    }
    case 'list':
      // handled in validateFields so nested errors carry their path
      return [raw];
    default:
      return [undefined, `Unknown field type ${field.type}`];
  }
}

/**
 * Validates `input` against `fields`. Unknown keys are dropped, empty values are omitted,
 * missing values take the field's default. Returns { value, errors } where errors maps
 * dotted field paths (e.g. "links.0.url") to messages.
 */
export function validateFields(fields, input, prefix = '') {
  const src = isPlainObject(input) ? input : {};
  const value = {};
  const errors = {};
  for (const field of fields) {
    const path = prefix + field.key;
    let raw = src[field.key];
    if (raw === undefined && field.default !== undefined) raw = structuredClone(field.default);

    if (field.type === 'list') {
      if (isEmpty(raw)) {
        if (field.required) errors[path] = `${field.label} needs at least one entry`;
        continue;
      }
      if (!Array.isArray(raw)) {
        errors[path] = 'Must be a list';
        continue;
      }
      if (raw.length > 200) {
        errors[path] = 'Too many entries (200 at most)';
        continue;
      }
      const items = [];
      raw.forEach((item, i) => {
        const r = validateFields(field.fields, item, `${path}.${i}.`);
        Object.assign(errors, r.errors);
        if (Object.keys(r.value).length) items.push(r.value);
      });
      if (items.length) value[field.key] = items;
      continue;
    }

    const [v, err] = coerce(field, raw);
    if (err) errors[path] = err;
    else if (field.required && isEmpty(v)) errors[path] = `${field.label} is required`;
    else if (v !== undefined) value[field.key] = v;
  }
  return { value, errors };
}

export function newId() {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

/** Validates one collection item, including uniqueness and reserved slugs. */
export function validateItem(collectionName, input, existingItems = [], selfId = null) {
  const def = COLLECTIONS[collectionName];
  const { value, errors } = validateFields(def.fields, input);
  for (const field of def.fields) {
    if (!field.unique || value[field.key] === undefined) continue;
    const clash = existingItems.find((it) => it.id !== selfId && it[field.key] === value[field.key]);
    if (clash) errors[field.key] = `Another ${def.singular} already uses "${value[field.key]}"`;
  }
  if (collectionName === 'pages' && value.slug && RESERVED_SLUGS.has(value.slug)) {
    errors.slug = `"${value.slug}" is already used by the site. Pick another address.`;
  }
  return { value, errors };
}

export function emptyContent() {
  const content = { version: 1, meta: {}, profile: { name: 'Your Name' }, settings: {} };
  for (const name of Object.keys(COLLECTIONS)) content[name] = [];
  return content;
}

/**
 * Validates a whole content document (used for imports and restores).
 * Keeps item ids, generating any that are missing.
 */
export function validateContent(input) {
  if (!isPlainObject(input)) return { value: null, errors: { '': 'Content must be a JSON object' } };
  const out = { version: 1, meta: isPlainObject(input.meta) ? { updatedAt: input.meta.updatedAt } : {} };
  const errors = {};
  for (const [name, def] of Object.entries(SINGLETONS)) {
    const r = validateFields(def.fields, input[name], `${name}.`);
    Object.assign(errors, r.errors);
    out[name] = r.value;
  }
  for (const name of Object.keys(COLLECTIONS)) {
    const items = Array.isArray(input[name]) ? input[name] : [];
    out[name] = [];
    items.forEach((item, i) => {
      const r = validateItem(name, item, out[name]);
      for (const [k, msg] of Object.entries(r.errors)) errors[`${name}.${i}.${k}`] = msg;
      const id = typeof item?.id === 'string' && /^[\w-]{1,40}$/.test(item.id) ? item.id : newId();
      out[name].push({ id, ...r.value });
    });
  }
  return { value: out, errors };
}

/** Fills in missing top-level keys so older or hand-edited content files keep working. */
export function normalizeContent(content) {
  const base = emptyContent();
  const out = { ...base, ...(isPlainObject(content) ? content : {}) };
  for (const name of Object.keys(SINGLETONS)) if (!isPlainObject(out[name])) out[name] = base[name];
  for (const name of Object.keys(COLLECTIONS)) {
    if (!Array.isArray(out[name])) out[name] = [];
    out[name] = out[name].filter(isPlainObject).map((it) => (it.id ? it : { id: newId(), ...it }));
  }
  if (!isPlainObject(out.meta)) out.meta = {};
  return out;
}

/** Applies schema defaults to a singleton for reading (e.g. settings.accent). */
export function withDefaults(fields, obj = {}) {
  const out = { ...obj };
  for (const f of fields) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = structuredClone(f.default);
  return out;
}

/** Removes fields marked `private` so content can be shown to visitors. */
export function publicContent(content) {
  const strip = (fields, obj) => {
    const out = { ...obj };
    for (const f of fields) if (f.private) delete out[f.key];
    return out;
  };
  const out = { version: content.version, meta: content.meta };
  for (const [name, def] of Object.entries(SINGLETONS)) out[name] = strip(def.fields, content[name]);
  for (const [name, def] of Object.entries(COLLECTIONS)) out[name] = content[name].map((it) => strip(def.fields, it));
  return out;
}

/** Fields of type `ref` pointing at `collection`, as [{ owner, key }] where owner is a singleton or collection name. */
export function refFields(collection) {
  const refs = [];
  for (const [name, def] of Object.entries({ ...SINGLETONS, ...COLLECTIONS })) {
    for (const f of def.fields) if (f.type === 'ref' && f.collection === collection) refs.push({ owner: name, key: f.key });
  }
  return refs;
}

/** Rewrites every reference to `from` so it points at `to` (or clears it when `to` is undefined). */
export function rewriteRefs(content, collection, from, to) {
  for (const { owner, key } of refFields(collection)) {
    const targets = SINGLETONS[owner] ? [content[owner]] : content[owner];
    for (const obj of targets) {
      if (obj[key] !== from) continue;
      if (to === undefined) delete obj[key];
      else obj[key] = to;
    }
  }
}

export function schemaForClient() {
  return { singletons: SINGLETONS, collections: COLLECTIONS, reservedSlugs: [...RESERVED_SLUGS] };
}
