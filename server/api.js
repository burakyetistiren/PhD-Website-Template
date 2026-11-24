import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HttpError, receiveFile, readJson, safeJoin, mimeType } from './http.js';
import {
  COLLECTIONS, SINGLETONS, newId, validateFields, validateItem, publicContent, rewriteRefs, schemaForClient,
} from './schema.js';
import { parseBibtex, entryToPublication, normalizeTitle } from './bibtex.js';
import { splitArgs } from './runner.js';
import { createRateLimiter } from './auth.js';

const MEDIA_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.pdf', '.txt', '.md', '.bib', '.csv',
  '.json', '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.cast', '.zip', '.pptx', '.key', '.tex',
]);
const NEW_ITEMS_FIRST = new Set(['news', 'publications', 'talks']);

export function sanitizeMediaName(name) {
  const base = path.basename(String(name || '')).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const ext = path.extname(base).toLowerCase();
  const stem = path.basename(base, path.extname(base)).replace(/\s+/g, '-').replace(/[^\w.-]/g, '').replace(/^[.-]+/, '').slice(0, 100);
  if (!stem || !MEDIA_EXT.has(ext)) return null;
  return stem + ext;
}

/** Validates a relative path inside a demo folder, e.g. "assets/app.wasm". */
export function sanitizeDemoPath(rel) {
  const parts = String(rel || '').split('/').filter((p) => p !== '');
  if (!parts.length || parts.length > 20) return null;
  for (const p of parts) {
    if (p === '.' || p === '..' || p.startsWith('.') || p.length > 200) return null;
    if (/[\u0000-\u001f\\:*?"<>|]/.test(p)) return null;
  }
  return parts.join('/');
}

async function walk(dir, prefix = '', out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= 5000) break;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(path.join(dir, e.name), rel, out);
    else if (e.isFile()) out.push({ path: rel, size: (await fsp.stat(path.join(dir, e.name))).size });
  }
  return out;
}

export function registerApi(router, { store, auth, runner, config }) {
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const runLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: config.runRateLimit });
  // Uploads are written here first and moved into place once complete. Same disk as media/ and
  // demos/, so the move is instant; *.tmp is already in data/.gitignore.
  const incomingDir = path.join(store.dataDir, 'incoming');

  const admin = (handler) => (ctx) => {
    if (!ctx.admin) throw new HttpError(401, 'Sign in to the admin to do this');
    return handler(ctx);
  };
  const collection = (name) => {
    const def = COLLECTIONS[name];
    if (!def) throw new HttpError(404, `There is no collection called "${name}"`);
    return def;
  };
  const singleton = (name) => {
    const def = SINGLETONS[name];
    if (!def) throw new HttpError(404, `Unknown section "${name}"`);
    return def;
  };
  const fieldErrors = (errors) => {
    if (Object.keys(errors).length) throw new HttpError(422, 'Some fields need attention', { fields: errors });
  };
  const findDemo = (slug, content = store.read()) => {
    const demo = content.demos.find((d) => d.slug === slug);
    if (!demo) throw new HttpError(404, `There is no demo at /demos/${slug}`);
    return demo;
  };
  const demoDir = (slug) => {
    const dir = safeJoin(store.demosDir, slug);
    if (!dir || dir === path.resolve(store.demosDir)) throw new HttpError(400, 'Invalid demo address');
    return dir;
  };

  // ── Health and public content ────────────────────────────────────────────
  router.get('/api/health', () => ({ ok: true, updatedAt: store.read().meta.updatedAt }));
  router.get('/api/public/content', () => publicContent(store.read()));

  // ── Auth ─────────────────────────────────────────────────────────────────
  router.post('/api/auth/login', async (ctx) => {
    const limit = loginLimiter.take(ctx.ip);
    if (!limit.ok) throw new HttpError(429, `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`);
    const { password, client } = await readJson(ctx.req);
    if (!auth.checkPassword(password)) throw new HttpError(401, 'That password is not correct');
    const ttlSeconds = client === 'cli' ? 90 * 24 * 3600 : 7 * 24 * 3600;
    return auth.issueToken({ ttlSeconds, client: client === 'cli' ? 'cli' : 'admin' });
  });

  router.get('/api/auth/session', admin((ctx) => ({
    signedIn: true,
    client: ctx.admin.client,
    expiresAt: new Date(ctx.admin.exp * 1000).toISOString(),
    passwordFromEnv: auth.passwordFromEnv,
  })));

  router.post('/api/auth/password', admin(async (ctx) => {
    const { current, next } = await readJson(ctx.req);
    if (!auth.checkPassword(current)) throw new HttpError(422, 'Some fields need attention', { fields: { current: 'That is not your current password' } });
    try {
      await auth.setPassword(next);
    } catch (e) {
      throw new HttpError(422, e.message, { fields: { next: e.message } });
    }
    return auth.issueToken({ client: ctx.admin.client });
  }));

  // ── Schema and whole-site content ────────────────────────────────────────
  router.get('/api/schema', admin(() => schemaForClient()));
  router.get('/api/content', admin(() => store.read()));
  router.put('/api/content', admin(async (ctx) => store.replace(await readJson(ctx.req, 20 * 1024 * 1024))));

  router.get('/api/backups', admin(async () => ({ backups: await store.listBackups() })));
  router.get('/api/backups/:name', admin((ctx) => store.readBackup(ctx.params.name)));
  router.post('/api/backups/:name/restore', admin(async (ctx) => store.replace(await store.readBackup(ctx.params.name))));

  // ── Profile and settings ─────────────────────────────────────────────────
  for (const name of Object.keys(SINGLETONS)) {
    router.get(`/api/${name}`, admin(() => ({ value: store.read()[name] })));
    router.put(`/api/${name}`, admin(async (ctx) => {
      const body = await readJson(ctx.req);
      const { value, errors } = validateFields(singleton(name).fields, body.value ?? body);
      fieldErrors(errors);
      await store.update((draft) => {
        draft[name] = value;
      });
      return { value };
    }));
  }

  // ── Collections ──────────────────────────────────────────────────────────
  router.get('/api/collections/:name', admin((ctx) => {
    collection(ctx.params.name);
    return { items: store.read()[ctx.params.name] };
  }));

  router.post('/api/collections/:name', admin(async (ctx) => {
    const { name } = ctx.params;
    collection(name);
    const body = await readJson(ctx.req);
    const item = await store.update((draft) => {
      const { value, errors } = validateItem(name, body.item ?? body, draft[name]);
      fieldErrors(errors);
      const created = { id: newId(), ...value };
      if (NEW_ITEMS_FIRST.has(name)) draft[name].unshift(created);
      else draft[name].push(created);
      return created;
    });
    return { item };
  }));

  router.get('/api/collections/:name/:id', admin((ctx) => {
    collection(ctx.params.name);
    const item = store.read()[ctx.params.name].find((it) => it.id === ctx.params.id);
    if (!item) throw new HttpError(404, 'That item no longer exists');
    return { item };
  }));

  router.put('/api/collections/:name/:id', admin(async (ctx) => {
    const { name, id } = ctx.params;
    collection(name);
    const body = await readJson(ctx.req);
    const item = await store.update(async (draft) => {
      const index = draft[name].findIndex((it) => it.id === id);
      if (index === -1) throw new HttpError(404, 'That item no longer exists');
      const { value, errors } = validateItem(name, body.item ?? body, draft[name], id);
      fieldErrors(errors);
      const before = draft[name][index];
      const updated = { id, ...value };
      draft[name][index] = updated;
      if (name === 'demos' && before.slug !== updated.slug) {
        rewriteRefs(draft, 'demos', before.slug, updated.slug);
        const from = demoDir(before.slug);
        const to = demoDir(updated.slug);
        if (fs.existsSync(from)) {
          await fsp.rm(to, { recursive: true, force: true });
          await fsp.rename(from, to);
        }
      }
      return updated;
    });
    return { item };
  }));

  router.delete('/api/collections/:name/:id', admin(async (ctx) => {
    const { name, id } = ctx.params;
    collection(name);
    await store.update(async (draft) => {
      const index = draft[name].findIndex((it) => it.id === id);
      if (index === -1) throw new HttpError(404, 'That item no longer exists');
      const [removed] = draft[name].splice(index, 1);
      if (name === 'demos') {
        rewriteRefs(draft, 'demos', removed.slug, undefined);
        await fsp.rm(demoDir(removed.slug), { recursive: true, force: true });
      }
    });
    return { ok: true };
  }));

  router.post('/api/collections/:name/:id/duplicate', admin(async (ctx) => {
    const { name, id } = ctx.params;
    const def = collection(name);
    const item = await store.update((draft) => {
      const index = draft[name].findIndex((it) => it.id === id);
      if (index === -1) throw new HttpError(404, 'That item no longer exists');
      const copy = { ...structuredClone(draft[name][index]), id: newId() };
      for (const f of def.fields) {
        if (!f.unique || !copy[f.key]) continue;
        let n = 2;
        const stem = copy[f.key].replace(/-copy(-\d+)?$/, '');
        let candidate = `${stem}-copy`.slice(0, 63);
        while (draft[name].some((it) => it[f.key] === candidate)) candidate = `${stem}-copy-${n++}`.slice(0, 63);
        copy[f.key] = candidate;
      }
      if (copy[def.titleField] && typeof copy[def.titleField] === 'string') copy[def.titleField] += ' (copy)';
      draft[name].splice(index + 1, 0, copy);
      return copy;
    });
    return { item };
  }));

  router.post('/api/collections/:name/reorder', admin(async (ctx) => {
    const { name } = ctx.params;
    collection(name);
    const { ids } = await readJson(ctx.req);
    await store.update((draft) => {
      const byId = new Map(draft[name].map((it) => [it.id, it]));
      if (!Array.isArray(ids) || ids.length !== byId.size || !ids.every((i) => byId.has(i))) {
        throw new HttpError(409, 'The list changed in another tab. Reload and try again.');
      }
      draft[name] = ids.map((i) => byId.get(i));
    });
    return { ok: true };
  }));

  // ── BibTeX import ────────────────────────────────────────────────────────
  router.post('/api/publications/import-bibtex', admin(async (ctx) => {
    const { bibtex, dryRun } = await readJson(ctx.req, 5 * 1024 * 1024);
    const entries = parseBibtex(bibtex);
    if (!entries.length) throw new HttpError(422, 'No BibTeX entries found. Entries start with @inproceedings{, @article{, …');
    const run = (draft) => {
      const seenTitles = new Set(draft.publications.map((p) => normalizeTitle(p.title)));
      const seenDois = new Set(draft.publications.map((p) => p.doi).filter(Boolean));
      const added = [];
      const skipped = [];
      for (const entry of entries) {
        const pub = entryToPublication(entry);
        const label = pub.title || entry.key || 'Untitled entry';
        if (seenTitles.has(normalizeTitle(pub.title)) || (pub.doi && seenDois.has(pub.doi))) {
          skipped.push({ title: label, reason: 'Already in your publications' });
          continue;
        }
        const { value, errors } = validateItem('publications', pub, draft.publications);
        if (Object.keys(errors).length) {
          skipped.push({ title: label, reason: Object.values(errors).join('; ') });
          continue;
        }
        seenTitles.add(normalizeTitle(value.title));
        if (value.doi) seenDois.add(value.doi);
        added.push({ id: newId(), ...value });
      }
      draft.publications.unshift(...added);
      return { added, skipped };
    };
    if (dryRun) return { dryRun: true, ...run(structuredClone(store.read())) };
    return store.update(run);
  }));

  // ── Media library ────────────────────────────────────────────────────────
  router.get('/api/media', admin(async () => {
    const files = await walk(store.mediaDir);
    const items = await Promise.all(
      files.filter((f) => !f.path.includes('/')).map(async (f) => {
        const stat = await fsp.stat(path.join(store.mediaDir, f.path));
        return { name: f.path, url: `/media/${encodeURIComponent(f.path)}`, size: f.size, type: mimeType(f.path), modifiedAt: stat.mtime.toISOString() };
      }),
    );
    return { items: items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) };
  }));

  router.put('/api/media/:name', admin(async (ctx) => {
    let name = sanitizeMediaName(ctx.params.name);
    if (!name) throw new HttpError(422, `That file type can't be uploaded. Allowed: ${[...MEDIA_EXT].join(' ')}`);
    const { tmp, size } = await receiveFile(ctx.req, incomingDir, config.maxUploadBytes);
    try {
      if (!size) throw new HttpError(422, 'The file is empty');
      if (ctx.query.get('overwrite') !== '1') {
        const ext = path.extname(name);
        const stem = name.slice(0, -ext.length);
        for (let n = 2; fs.existsSync(path.join(store.mediaDir, name)); n++) name = `${stem}-${n}${ext}`;
      }
      await fsp.rename(tmp, path.join(store.mediaDir, name));
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    return { name, url: `/media/${encodeURIComponent(name)}`, size, type: mimeType(name) };
  }));

  router.delete('/api/media/:name', admin(async (ctx) => {
    const name = sanitizeMediaName(ctx.params.name);
    const file = name && safeJoin(store.mediaDir, name);
    if (!file || !fs.existsSync(file)) throw new HttpError(404, 'That file does not exist');
    await fsp.rm(file);
    return { ok: true };
  }));

  // ── Demos: static files ──────────────────────────────────────────────────
  router.get('/api/demos/:slug/files', admin(async (ctx) => {
    findDemo(ctx.params.slug);
    const files = await walk(demoDir(ctx.params.slug));
    return { files, totalSize: files.reduce((n, f) => n + f.size, 0) };
  }));

  router.put('/api/demos/:slug/files/*', admin(async (ctx) => {
    findDemo(ctx.params.slug);
    const rel = sanitizeDemoPath(ctx.params.wild);
    if (!rel) throw new HttpError(422, `"${ctx.params.wild}" is not an allowed file path (no hidden files or "..")`);
    const target = safeJoin(demoDir(ctx.params.slug), rel);
    if (!target) throw new HttpError(422, 'Invalid file path');
    const { tmp, size } = await receiveFile(ctx.req, incomingDir, config.maxUploadBytes);
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(tmp, target);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
    return { path: rel, size };
  }));

  router.delete('/api/demos/:slug/files/*', admin(async (ctx) => {
    findDemo(ctx.params.slug);
    const dir = demoDir(ctx.params.slug);
    if (!ctx.params.wild) {
      await fsp.rm(dir, { recursive: true, force: true });
      return { ok: true };
    }
    const rel = sanitizeDemoPath(ctx.params.wild);
    const target = rel && safeJoin(dir, rel);
    if (!target) throw new HttpError(422, 'Invalid file path');
    await fsp.rm(target, { recursive: true, force: true });
    return { ok: true };
  }));

  // ── Demos: playground runner ─────────────────────────────────────────────
  router.get('/api/runner', admin(async () => ({
    docker: await runner.status({ fresh: true }),
    limits: { concurrent: config.runMaxConcurrent, perVisitorPer10Min: config.runRateLimit, maxInputBytes: config.runMaxInputBytes },
  })));

  router.get('/api/demos/:slug/image', admin(async (ctx) => {
    const demo = findDemo(ctx.params.slug);
    return { image: demo.image || null, ...(await runner.imageStatus(demo.image)) };
  }));

  router.post('/api/demos/:slug/image/pull', admin((ctx) => {
    const demo = findDemo(ctx.params.slug);
    if (!demo.image) throw new HttpError(422, 'Set a Docker image for this demo first');
    return { image: demo.image, pull: runner.pull(demo.image) };
  }));

  router.post('/api/demos/:slug/run', async (ctx) => {
    const demo = findDemo(ctx.params.slug);
    if (demo.kind !== 'playground') throw new HttpError(400, 'This demo does not run on the server');
    if (!ctx.admin) {
      const limit = runLimiter.take(ctx.ip);
      if (!limit.ok) throw new HttpError(429, `You've run this a lot. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`, { retryAfter: limit.retryAfter });
    }
    const body = await readJson(ctx.req, config.runMaxInputBytes + 4096);
    const input = typeof body.input === 'string' ? body.input : '';
    if (Buffer.byteLength(input) > config.runMaxInputBytes) {
      throw new HttpError(413, `Input is limited to ${Math.round(config.runMaxInputBytes / 1024)} KB`);
    }
    let args = [];
    const presets = demo.presets || [];
    if (body.preset !== undefined && body.preset !== null && body.preset !== '') {
      const preset = presets[Number(body.preset)];
      if (!preset) throw new HttpError(422, 'Unknown option');
      try {
        args = splitArgs(preset.args || '');
      } catch (e) {
        throw new HttpError(500, `The "${preset.label}" option is misconfigured: ${e.message}`);
      }
    }
    const result = await runner.run(demo, { input, args });
    if (!ctx.admin && result.error && result.exitCode === 125) result.stderr = '';
    return result;
  });
}
