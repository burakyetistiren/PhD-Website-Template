import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from '../server/config.js';
import { createApp } from '../server/app.js';
import { exportSite } from '../site/export.js';

let app;
let base;
let token;
let tmp;
const PASSWORD = 'correct horse battery';

const call = async (method, p, { body, raw, auth = true, headers = {} } = {}) => {
  const h = { ...headers };
  if (auth && token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
};

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'phd-site-test-'));
  const config = {
    ...loadConfig({}),
    dataDir: path.join(tmp, 'data'),
    adminPassword: PASSWORD,
    dockerBin: path.join(ROOT, 'tools', 'fake-docker.js'),
    runRateLimit: 3,
    runMaxInputBytes: 1024,
  };
  app = await createApp(config, { log: () => {} });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await app.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

test('public pages render from seed content', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Robin Park/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await call('GET', '/publications')).status, 200);
  assert.equal((await call('GET', '/demos/tidylint')).status, 200);
  assert.equal((await call('GET', '/contact')).status, 200);
  assert.equal((await call('GET', '/missing-page')).status, 404);
  const cv = await call('GET', '/cv');
  assert.equal(cv.status, 302);
  assert.equal(cv.headers.get('location'), '/media/cv.pdf');
});

test('admin endpoints require a valid token', async () => {
  assert.equal((await call('GET', '/api/schema', { auth: false })).status, 401);
  assert.equal((await call('GET', '/api/content', { auth: false, headers: { Authorization: 'Bearer v1.forged.sig' } })).status, 401);
  const bad = await call('POST', '/api/auth/login', { body: { password: 'nope' }, auth: false });
  assert.equal(bad.status, 401);
  const good = await call('POST', '/api/auth/login', { body: { password: PASSWORD }, auth: false });
  assert.equal(good.status, 200);
  token = good.json.token;
  assert.equal((await call('GET', '/api/schema')).status, 200);
});

test('create, validate, update, reorder and delete collection items', async () => {
  const invalid = await call('POST', '/api/collections/news', { body: { text: 'Missing date' } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.fields.date, 'Date is required');

  const created = await call('POST', '/api/collections/news', { body: { date: '2026-11-01', text: 'Hello <script>alert(1)</script> **world**' } });
  assert.equal(created.status, 200);
  const id = created.json.item.id;
  const home = await call('GET', '/');
  assert.ok(home.text.includes('Hello &lt;script&gt;alert(1)&lt;/script&gt; <strong>world</strong>'));
  assert.ok(!home.text.includes('<script>alert(1)'));

  const updated = await call('PUT', `/api/collections/news/${id}`, { body: { date: '2026-11-02', text: 'Edited' } });
  assert.equal(updated.json.item.text, 'Edited');

  const { json: list } = await call('GET', '/api/collections/projects');
  const ids = list.items.map((p) => p.id).reverse();
  assert.equal((await call('POST', '/api/collections/projects/reorder', { body: { ids } })).status, 200);
  assert.deepEqual((await call('GET', '/api/collections/projects')).json.items.map((p) => p.id), ids);
  assert.equal((await call('POST', '/api/collections/projects/reorder', { body: { ids: ids.slice(1) } })).status, 409);

  assert.equal((await call('DELETE', `/api/collections/news/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/collections/news/${id}`)).status, 404);
});

test('renaming a demo moves its files and updates references', async () => {
  const demos = (await call('GET', '/api/collections/demos')).json.items;
  const shapeshift = demos.find((d) => d.slug === 'shapeshift');
  const res = await call('PUT', `/api/collections/demos/${shapeshift.id}`, { body: { ...shapeshift, slug: 'shapeshift-v2' } });
  assert.equal(res.status, 200);
  const content = (await call('GET', '/api/content')).json;
  assert.equal(content.settings.heroDemo, 'shapeshift-v2');
  assert.equal(content.publications.find((p) => p.id === 'p1').demo, 'shapeshift-v2');
  assert.equal((await call('GET', '/d/shapeshift-v2/')).status, 200);
  assert.equal((await call('GET', '/d/shapeshift/')).status, 404);
  await call('PUT', `/api/collections/demos/${shapeshift.id}`, { body: shapeshift });
});

test('static demo files: upload, sandbox headers, traversal protection', async () => {
  const up = await call('PUT', '/api/demos/shapeshift/files/assets/data.json', { raw: '{"ok":true}' });
  assert.equal(up.status, 200);
  const file = await call('GET', '/d/shapeshift/assets/data.json');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  const entry = await call('GET', '/d/shapeshift/index.html');
  assert.match(entry.headers.get('content-security-policy'), /^sandbox allow-scripts/, 'the start page itself is sandboxed');
  assert.equal(file.headers.get('access-control-allow-origin'), '*');
  assert.equal((await call('PUT', '/api/demos/shapeshift/files/..%2F..%2Fcontent.json', { raw: 'x' })).status, 422);
  assert.equal((await call('PUT', '/api/demos/shapeshift/files/.hidden', { raw: 'x' })).status, 422);
  assert.equal((await call('GET', '/d/shapeshift/..%2F..%2Fcontent.json')).status, 404);
  assert.equal((await call('GET', '/d/tidylint/')).status, 404, 'playground demos do not serve files');
  const files = await call('GET', '/api/demos/shapeshift/files');
  assert.ok(files.json.files.some((f) => f.path === 'assets/data.json'));
});

test('media uploads are renamed safely and active types are sandboxed', async () => {
  const up = await call('PUT', '/api/media/My%20Photo.SVG', { raw: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
  assert.equal(up.status, 200);
  assert.equal(up.json.name, 'My-Photo.svg');
  const again = await call('PUT', '/api/media/My%20Photo.SVG', { raw: '<svg/>' });
  assert.equal(again.json.name, 'My-Photo-2.svg');
  const served = await call('GET', '/media/My-Photo.svg');
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await call('PUT', '/api/media/evil.html', { raw: '<b>' })).status, 422);
  assert.equal((await call('DELETE', '/api/media/My-Photo-2.svg')).status, 200);
});

test('playground runs through the sandboxed runner with limits', async () => {
  const run = await call('POST', '/api/demos/tidylint/run', { body: { input: 'import os\n', preset: '1' }, auth: false });
  assert.equal(run.status, 200);
  assert.match(run.json.stdout, /T001\s+Unused import/);
  assert.equal(run.json.exitCode, 1);

  const tooBig = await call('POST', '/api/demos/tidylint/run', { body: { input: 'x'.repeat(2000) }, auth: false });
  assert.equal(tooBig.status, 413);
  const badPreset = await call('POST', '/api/demos/tidylint/run', { body: { input: '', preset: 9 }, auth: false });
  assert.equal(badPreset.status, 422);
  const limited = await call('POST', '/api/demos/tidylint/run', { body: { input: '' }, auth: false });
  assert.equal(limited.status, 429, 'fourth anonymous run in the window is rate limited');
  const asAdmin = await call('POST', '/api/demos/tidylint/run', { body: { input: 'x = 1\n' } });
  assert.equal(asAdmin.status, 200, 'admin runs skip the rate limit');
  assert.match(asAdmin.json.stdout, /no problems found/);
  assert.equal((await call('POST', '/api/demos/shapeshift/run', { body: { input: '' } })).status, 400);
});

test('playground time limit stops runaway tools', { timeout: 15000 }, async () => {
  const created = await call('POST', '/api/collections/demos', { body: { title: 'Sleepy', slug: 'sleepy', kind: 'playground', image: 'sleepy', command: 'sleep', timeoutSec: 1 } });
  assert.equal(created.status, 200);
  const started = Date.now();
  const run = await call('POST', '/api/demos/sleepy/run', { body: { input: '' } });
  assert.equal(run.json.timedOut, true);
  assert.ok(Date.now() - started < 8000);
  const missing = await call('POST', '/api/collections/demos', { body: { title: 'Missing', slug: 'missing', kind: 'playground', image: 'missing' } });
  assert.equal(missing.status, 200);
  const r = await call('POST', '/api/demos/missing/run', { body: { input: '' } });
  assert.equal(r.json.exitCode, 125);
  assert.match(r.json.error, /could not start/);
  const status = await call('GET', '/api/demos/missing/image');
  assert.equal(status.json.present, false);
});

test('BibTeX import previews, imports and skips duplicates', async () => {
  const bibtex = '@inproceedings{a, title={A New Paper}, author={Park, Robin}, booktitle={ICSE}, year={2027}}\n@article{b, title={Shapeshift: Lightweight Type Inference for JSON-Heavy Codebases}, author={Park, Robin}, journal={X}, year={2026}}';
  const dry = await call('POST', '/api/publications/import-bibtex', { body: { bibtex, dryRun: true } });
  assert.equal(dry.json.added.length, 1);
  assert.equal(dry.json.skipped.length, 1);
  const before = (await call('GET', '/api/collections/publications')).json.items.length;
  const real = await call('POST', '/api/publications/import-bibtex', { body: { bibtex } });
  assert.equal(real.json.added.length, 1);
  const items = (await call('GET', '/api/collections/publications')).json.items;
  assert.equal(items.length, before + 1);
  assert.equal(items[0].title, 'A New Paper');
});

test('backups are kept and can be restored', async () => {
  const backups = (await call('GET', '/api/backups')).json.backups;
  assert.ok(backups.length > 3);
  const oldest = backups.at(-1);
  const restored = await call('POST', `/api/backups/${oldest.name}/restore`);
  assert.equal(restored.status, 200);
  assert.equal((await call('POST', '/api/backups/..%2Fauth.json/restore')).status, 400);
  const bad = await call('PUT', '/api/content', { body: { profile: {}, news: [{ text: 'no date' }] } });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.fields['profile.name']);
});

test('public content API hides private fields and allows CORS', async () => {
  const res = await call('GET', '/api/public/content', { auth: false, headers: { Origin: 'https://example.org' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.ok(Array.isArray(res.json.publications));
  const pre = await fetch(`${base}/api/demos/tidylint/run`, { method: 'OPTIONS', headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
});

test('feeds, sitemap and admin shell', async () => {
  assert.match((await call('GET', '/feed.xml')).text, /<rss version="2.0">/);
  assert.match((await call('GET', '/sitemap.xml')).text, /<loc>http:\/\/127\.0\.0\.1:\d+\/demos\/tidylint<\/loc>/);
  const admin = await call('GET', '/admin/');
  assert.equal(admin.status, 200);
  assert.equal(admin.headers.get('x-frame-options'), 'DENY');
  assert.equal((await call('GET', '/admin')).status, 301);
});

test('static export writes every page with the base path', async () => {
  const out = path.join(tmp, 'dist');
  const r = await exportSite({ store: app.store, root: ROOT, outDir: out, base: '/site', siteUrl: 'https://u.github.io' });
  assert.ok(r.pages >= 8);
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /href="\/site\/publications"/);
  assert.match(home, /src="\/site\/d\/shapeshift\/index\.html"[^>]* sandbox="allow-scripts/);
  assert.ok(fs.existsSync(path.join(out, 'demos', 'tidylint', 'index.html')));
  assert.match(fs.readFileSync(path.join(out, 'demos', 'tidylint', 'index.html'), 'utf8'), /can't run demos/);
  assert.ok(fs.existsSync(path.join(out, 'd', 'shapeshift', 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'media', 'cv.pdf')));
  assert.ok(fs.existsSync(path.join(out, 'sitemap.xml')));
  assert.ok(!fs.readFileSync(path.join(out, 'content.json'), 'utf8').includes('endpointToken'));
});
