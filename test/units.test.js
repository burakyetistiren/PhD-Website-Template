import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, safeUrl } from '../shared/markdown.js';
import { validateFields, validateItem, publicContent, normalizeContent, rewriteRefs, COLLECTIONS } from '../server/schema.js';
import { parseBibtex, entryToPublication, cleanLatex, formatAuthor } from '../server/bibtex.js';
import { splitArgs, buildDockerArgs } from '../server/runner.js';
import { sanitizeMediaName, sanitizeDemoPath } from '../server/api.js';
import { html, raw } from '../site/html.js';

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
