import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, safeUrl } from '../shared/markdown.js';
import { validateFields, validateItem, publicContent, normalizeContent, rewriteRefs, COLLECTIONS, SINGLETONS } from '../server/schema.js';
import { parseBibtex, entryToPublication, cleanLatex, formatAuthor } from '../server/bibtex.js';
import { splitArgs, buildDockerArgs } from '../server/runner.js';
import { sanitizeMediaName, sanitizeDemoPath } from '../server/api.js';
import { html, raw } from '../site/html.js';
import { parseRange, formatBytes } from '../server/http.js';
import { loadConfig } from '../server/config.js';

test('markdown escapes raw HTML and unsafe links', () => {
  const out = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [y](JaVaScRiPt:alert(1)) ![i](data:image/png;base64,AA)');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!/href="javascript/i.test(out));
  assert.ok(!out.includes('<img'));
  assert.equal(safeUrl('java\tscript:alert(1)'), '');
  assert.equal(safeUrl('/media/cv.pdf'), '/media/cv.pdf');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
});

test('markdown renders common blocks', () => {
  const out = renderMarkdown('# Title\n\nSome **bold** and *it* and `co<de>`.\n\n- one\n- two\n\n1. a\n2. b\n\n```js\nx < 1\n```\n\n> quote');
  assert.match(out, /<h1>Title<\/h1>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<code>co&lt;de&gt;<\/code>/);
  assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(out, /<pre><code class="language-js">x &lt; 1<\/code><\/pre>/);
  assert.match(out, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.equal(renderInline('[**a**](https://x.y)'), '<a href="https://x.y" rel="noopener"><strong>a</strong></a>');
  assert.equal(renderInline('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(renderMarkdown('**Role**, Lab\nSeptember 2023 – present\n\nNext'), '<p><strong>Role</strong>, Lab<br>\nSeptember 2023 – present</p>\n<p>Next</p>');
});

test('html template escapes by default', () => {
  const evil = '"><img onerror=1>';
  assert.equal(String(html`<a title="${evil}">${evil}</a>`), '<a title="&quot;&gt;&lt;img onerror=1&gt;">&quot;&gt;&lt;img onerror=1&gt;</a>');
  assert.equal(String(html`${raw('<b>ok</b>')}`), '<b>ok</b>');
});

test('schema validation: required, defaults, unsafe urls, nested lists, unknown keys', () => {
  const { value, errors } = validateItem('demos', {
    title: 'T', slug: 'Bad Slug', embedUrl: 'javascript:alert(1)', presets: [{ label: '', args: '--x' }], evil: 1,
  });
  assert.equal(errors.slug, 'Use lowercase letters, numbers and dashes');
  assert.match(errors.embedUrl, /http/);
  assert.equal(errors['presets.0.label'], 'Name is required');
  assert.equal(value.kind, 'static');
  assert.equal(value.isolate, true);
  assert.ok(!('evil' in value));

  const ok = validateFields(COLLECTIONS.publications.fields, { title: ' Paper ', authors: 'A, B', year: '2025' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.title, 'Paper');
  assert.deepEqual(ok.value.authors, ['A', 'B']);
  assert.equal(ok.value.year, 2025);
});

test('experience: month validation and the two-sided timeline', async () => {
  assert.match(validateItem('experience', { title: 'T', organization: 'O', start: '2023-13' }).errors.start, /YYYY-MM/);
  const ok = validateItem('experience', { title: 'Intern', organization: 'Acme Web Services', start: '2025-06', end: '2025-09' });
  assert.deepEqual(ok.errors, {});
  const { experienceTimeline } = await import('../site/render.js');
  const out = String(experienceTimeline({ base: '' }, [
    { title: 'Older', organization: 'Acme Web Services', kind: 'industry', start: '2025-06', end: '2025-09' },
    { title: 'Newer', organization: 'Northfield University (NU)', kind: 'education', start: '2026-01', current: true, description: 'Hi' },
    { title: 'Award', organization: 'ACM', kind: 'award', start: '2024-10', image: '/media/acm.png' },
    { title: 'Wide', organization: 'X', kind: 'service', start: '2020-01', image: '/media/x.svg', imageFit: 'fit', imageBackground: '#1f4e79' },
    { title: 'Bad colour', organization: 'Y', kind: 'service', start: '2019-01', image: '/media/y.png', imageBackground: 'red;}<x>' },
  ]));
  assert.match(out, /class="tl-node tl-node--fill" aria-hidden/, 'images fill the circle by default');
  assert.match(out, /class="tl-node tl-node--fit" style="--node-bg: #1f4e79"/);
  assert.ok(!out.includes('red;}'), 'only hex circle colours are used');
  const order = ['Newer', 'Older', 'Award'].map((t) => out.indexOf(`>${t}<`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'newest first');
  assert.match(out, /class="tl-item tl-left tl-current"/);
  assert.match(out, /class="tl-item tl-right tl-compact"/);
  assert.match(out, /Jan 2026 – Present/);
  assert.match(out, /Jun 2025 – Sep 2025/);
  assert.match(out, />NU</, 'acronym in parentheses becomes the badge');
  assert.match(out, />AWS</, 'initials otherwise');
  assert.match(out, /<img src="\/media\/acm\.png"/);
  assert.match(out, /data-filter="award">Awards</);
});

test('themes: setting, preview override, fonts and custom link color', async () => {
  const { renderRoute } = await import('../site/render.js');
  const { THEMES } = await import('../site/themes.js');
  const base = normalizeContent({ profile: { name: 'Ada Lovelace' }, settings: { siteTheme: 'riso' } });
  const riso = renderRoute('/', base, {}).html;
  assert.match(riso, /<html lang="en" data-theme-pref="auto" data-style="riso"[ >]/);
  assert.match(riso, /family=Young\+Serif/);
  assert.match(riso, /\/assets\/themes\.css/);
  assert.match(riso, /<details class="theme-picker" data-theme-picker>/);
  assert.equal((riso.match(/data-theme-choice="/g) || []).length, Object.keys(THEMES).length, 'one menu option per theme');
  assert.match(riso, /aria-checked="true" data-theme-choice="riso" href="\/\?theme=riso"/);
  assert.match(riso, /<script type="application\/json" id="site-themes">\{"ids":\["paper"/);
  assert.ok(riso.indexOf('id="site-themes"') < riso.indexOf('/assets/theme.js'), 'theme data comes before theme.js reads it');
  assert.ok(!riso.includes('--accent:'), 'no link-color override unless one is set');
  assert.match(renderRoute('/', base, { previewTheme: 'midnight' }).html, /data-style="midnight"/);
  assert.match(renderRoute('/', base, { previewTheme: '"><script>' }).html, /data-style="riso"/, 'unknown previews are ignored');
  assert.match(renderRoute('/', normalizeContent({ profile: { name: 'A' } }), {}).html, /data-style="paper"/);
  const custom = normalizeContent({ profile: { name: 'A' }, settings: { siteTheme: 'swiss', accent: '#118833' } });
  assert.match(renderRoute('/', custom, {}).html, /--accent:#118833!important/);
  const themeField = SINGLETONS.settings.fields.find((f) => f.key === 'siteTheme');
  assert.deepEqual(themeField.options.map((o) => o.value), Object.keys(THEMES));
  assert.equal(validateFields(SINGLETONS.settings.fields, { siteTheme: 'neon' }).errors.siteTheme, 'Pick one of the listed options');
});

test('schema: unique slugs, reserved page slugs, private fields', () => {
  const existing = [{ id: 'a', slug: 'tool' }];
  assert.match(validateItem('demos', { title: 'X', slug: 'tool' }, existing).errors.slug, /already uses/);
  assert.deepEqual(validateItem('demos', { title: 'X', slug: 'tool' }, existing, 'a').errors, {});
  assert.match(validateItem('pages', { title: 'X', slug: 'admin', body: 'b' }).errors.slug, /already used by the site/);
  const content = normalizeContent({ demos: [{ id: 'd', slug: 'x', endpoint: 'https://secret', endpointToken: 'tok' }] });
  const pub = publicContent(content);
  assert.equal(pub.demos[0].endpointToken, undefined);
  assert.equal(pub.demos[0].endpoint, undefined);
});

test('schema: renaming a demo rewrites references', () => {
  const content = normalizeContent({ settings: { heroDemo: 'old' }, publications: [{ id: 'p', demo: 'old' }], projects: [{ id: 'q', demo: 'other' }] });
  rewriteRefs(content, 'demos', 'old', 'new');
  assert.equal(content.settings.heroDemo, 'new');
  assert.equal(content.publications[0].demo, 'new');
  assert.equal(content.projects[0].demo, 'other');
  rewriteRefs(content, 'demos', 'new', undefined);
  assert.equal(content.settings.heroDemo, undefined);
});

test('bibtex: parses Scholar/DBLP style entries', () => {
  const src = `
@comment{ignored}
@string{icse = "ICSE"}
@inproceedings{park2026,
  title     = {{Shapeshift}: Type Inference for {JSON}},
  author    = {Park, Robin and M{\\"u}ller, J{\\'e}r{\\^o}me and others},
  booktitle = "Proc. of the " # "Workshop on Tools",
  year      = 2026,
  month     = jun,
  doi       = {https://doi.org/10.1145/123.456},
}
@article{x, title={A Preprint}, author={Doe, Jane}, journal={arXiv preprint arXiv:2401.01234}, year={2024}}
@phdthesis{t, title="My Thesis", author="Jane Doe", school="Northfield University", year="2023", url="https://example.edu/thesis.pdf"}`;
  const entries = parseBibtex(src);
  assert.equal(entries.length, 3);
  const [a, b, c] = entries.map(entryToPublication);
  assert.equal(a.title, 'Shapeshift: Type Inference for JSON');
  assert.deepEqual(a.authors, ['Robin Park', 'Jérôme Müller', 'et al.']);
  assert.equal(a.venue, 'Proc. of the Workshop on Tools');
  assert.equal(a.type, 'workshop');
  assert.equal(a.year, 2026);
  assert.equal(a.doi, '10.1145/123.456');
  assert.match(a.bibtex, /^@inproceedings\{park2026/);
  assert.equal(b.type, 'preprint');
  assert.equal(b.arxiv, '2401.01234');
  assert.equal(c.type, 'thesis');
  assert.equal(c.pdf, 'https://example.edu/thesis.pdf');
  assert.equal(cleanLatex('Caf\\\'e -- na\\"ive \\& co'), 'Café – naïve & co');
  assert.equal(formatAuthor('{Google DeepMind}'), 'Google DeepMind');
  assert.equal(formatAuthor('King, Jr, Martin'), 'Martin King, Jr');
});

test('runner: argument splitting and sandboxed docker arguments', () => {
  assert.deepEqual(splitArgs(`tool --flag "two words" 'single quoted' a\\ b`), ['tool', '--flag', 'two words', 'single quoted', 'a b']);
  assert.throws(() => splitArgs('tool "unclosed'), /unclosed quote/);

  const stdinArgs = buildDockerArgs({ image: 'img', command: 'lint -', memoryMb: 128, cpus: 0.5 }, { args: ['--strict'], name: 'n1' });
  for (const flag of ['--rm', '--read-only', '--network', 'none', '--cap-drop', 'ALL', 'no-new-privileges', '--pull', 'never', '65534:65534', 'PYTHONUNBUFFERED=1']) {
    assert.ok(stdinArgs.includes(flag), `missing ${flag}`);
  }
  assert.deepEqual(stdinArgs.slice(-4), ['img', 'lint', '-', '--strict']);
  assert.ok(stdinArgs.includes('128m'));

  const fileArgs = buildDockerArgs({ image: 'img', command: 'pylint {args} {input}', inputFilename: 'x;rm -rf.py' }, { args: ['-v'], name: 'n2' });
  const at = fileArgs.indexOf('--entrypoint');
  assert.equal(fileArgs[at + 1], 'sh');
  assert.deepEqual(fileArgs.slice(-4), ['sh', 'pylint', '-v', '/tmp/x_rm_-rf.py']);
  assert.match(fileArgs.at(-5), /^cat > '\/tmp\/x_rm_-rf\.py' && exec "\$@"$/);
});

test('upload names and demo paths are sanitized', () => {
  assert.equal(sanitizeMediaName('My CV (final).PDF'), 'My-CV-final.pdf');
  assert.equal(sanitizeMediaName('../../etc/passwd'), null);
  assert.equal(sanitizeMediaName('run.sh'), null);
  assert.equal(sanitizeDemoPath('assets/app.wasm'), 'assets/app.wasm');
  assert.equal(sanitizeDemoPath('../secret'), null);
  assert.equal(sanitizeDemoPath('.env'), null);
  assert.equal(sanitizeDemoPath('a/./b'), null);
});

test('range header parsing', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=0-1', 1000), { start: 0, end: 1 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(parseRange('bytes=5-2', 1000), null);
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange('bytes=-', 1000), null);
});

test('uploads default to a 1 GB limit', () => {
  assert.equal(loadConfig({}).maxUploadBytes, 1024 * 1024 * 1024);
  assert.equal(loadConfig({ MAX_UPLOAD_MB: '200' }).maxUploadBytes, 200 * 1024 * 1024);
  assert.equal(formatBytes(1024 * 1024 * 1024), '1 GB');
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
});

test('sensemaking: stages, moments and video links', async () => {
  const { STAGES, STAGE_ORDER, STAGE_OPTIONS, parseMoment, formatMoment, videoSource } = await import('../site/sensemaking.js');
  assert.equal(STAGES.size, 16);
  assert.equal(new Set(STAGE_ORDER).size, 16, 'every stage appears once in the walk-through');
  assert.deepEqual([STAGE_ORDER[0], STAGE_ORDER[1], STAGE_ORDER.at(-1)], ['external-data', 'search-filter', 'search-information']);
  assert.deepEqual(STAGE_OPTIONS.map((o) => o.value), STAGE_ORDER);
  assert.equal(STAGE_OPTIONS.find((o) => o.value === 'schematize').label, 'Schematize (Evidence file → Schema)');

  assert.equal(parseMoment('1:25'), 85);
  assert.equal(parseMoment('01:02:03'), 3723);
  assert.equal(parseMoment(' 90 '), 90);
  assert.equal(parseMoment('1:75'), null);
  assert.equal(parseMoment('soon'), null);
  assert.equal(parseMoment(undefined), null);
  assert.equal(formatMoment(85), '1:25');
  assert.equal(formatMoment(3723), '1:02:03');

  const yt = videoSource('https://www.youtube.com/watch?v=abcdefghijk&list=x');
  assert.equal(yt.type, 'youtube');
  assert.equal(yt.src, 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0');
  assert.equal(yt.at(85), 'https://www.youtube.com/watch?v=abcdefghijk&t=85s');
  assert.equal(videoSource('https://youtu.be/abcdefghijk').type, 'youtube');
  assert.equal(videoSource('https://vimeo.com/123456').src, 'https://player.vimeo.com/video/123456');
  assert.deepEqual([videoSource('/media/tour.mp4').type, videoSource('/media/tour.mp4').at(12)], ['file', '/media/tour.mp4#t=12']);
});

test('sensemaking: page diagram, notes, tools and validation', async () => {
  const { renderRoute } = await import('../site/render.js');
  const page = {
    id: 'p1', title: 'How my tools help', slug: 'loop', sensemaking: 'bottom', body: 'Intro text.',
    tools: [
      {
        name: 'Tracer', venue: 'Example Conf 2026', video: 'https://youtu.be/abcdefghijk',
        figures: [{ image: '/media/overview.png', caption: 'Overview' }, { image: '/media/graph.png', caption: 'The graph' }],
        stages: [
          { stage: 'schema', text: 'Draws a graph.', figure: 2, videoAt: '1:25' },
          { stage: 'search-filter', text: 'Asks a question.', tryUrl: 'https://example.org/try' },
        ],
      },
      { name: 'Sifter <b>', video: '/media/sifter.mp4', stages: [{ stage: 'schema', text: 'Learns *rules*.', videoAt: 'later' }] },
      { name: 'Tracer', stages: [] },
    ],
  };
  const content = normalizeContent({ profile: { name: 'Sam Doe' }, pages: [page] });
  const out = renderRoute('/loop', content, {}).html;

  assert.equal((out.match(/<a class="sm-(?:node|proc)[^"]*" href="#sm-/g) || []).length, 16, 'one link per stage in the drawing');
  assert.equal((out.match(/data-sm-panel=/g) || []).length, 16, 'every stage has a panel, listed without JavaScript');
  assert.match(out, /data-sm-start="search-filter"/, 'starts on the first stage with notes, in walk-through order');
  assert.match(out, /class="sm-node has-notes" href="#sm-schema"/);
  assert.match(out, /<title>Schema, 2 notes<\/title>/);
  assert.ok(out.indexOf('Intro text.') < out.indexOf('data-sm '), 'shown below the text');
  assert.match(out, /href="\/assets\/sensemaking\.css/);
  assert.match(out, /src="\/assets\/sensemaking\.js/);

  const schema = out.slice(out.indexOf('id="sm-schema"'), out.indexOf('id="sm-build-case"'));
  assert.match(schema, /<a href="#tool-tracer">Tracer<\/a>/);
  assert.match(schema, /<a class="sm-note-fig" href="#tool-tracer-fig-2"><img src="\/media\/graph\.png"/);
  assert.match(schema, /href="https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk&amp;t=85s" data-sm-seek="tool-tracer" data-sm-at="85"/);
  assert.match(schema, /Learns <em>rules<\/em>/);
  assert.equal((schema.match(/data-sm-seek/g) || []).length, 1, 'no play link for a moment that does not parse');
  assert.match(out, /href="https:\/\/example\.org\/try"[^>]*>Try this step</);

  assert.match(out, /<iframe id="tool-tracer-video" data-sm-video="youtube" src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk\?rel=0"/);
  assert.match(out, /<video id="tool-sifter-b-video" data-sm-video="file"[^>]*><source src="\/media\/sifter\.mp4">/);
  assert.match(out, /id="tool-tracer-2"/, 'tools with the same name get distinct anchors');
  assert.match(out, /Sifter &lt;b&gt;/);
  assert.ok(!out.includes('Sifter <b>'), 'tool names are escaped');
  assert.match(out, /<figure class="sm-fig" id="tool-tracer-fig-1">/);
  assert.match(out, /<span class="sm-fig-n">Figure 2\.<\/span> The graph/);

  const plain = renderRoute('/loop', normalizeContent({ profile: { name: 'Sam Doe' }, pages: [{ ...page, sensemaking: 'none' }] }), {}).html;
  assert.ok(!plain.includes('data-sm'), 'nothing is shown when the diagram is off');
  assert.ok(!plain.includes('sensemaking.css'));

  const bad = validateItem('pages', { title: 'T', slug: 't', sensemaking: 'top', tools: [{ name: 'X', stages: [{ stage: 'nowhere', text: 'Hi' }, { stage: 'schema' }] }] });
  assert.match(bad.errors['tools.0.stages.0.stage'], /listed options/);
  assert.match(bad.errors['tools.0.stages.1.text'], /required/);
  assert.deepEqual(validateItem('pages', page, []).errors, {});
});
