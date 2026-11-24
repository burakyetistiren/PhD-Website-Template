import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRouter, HttpError, sendJson, sendText, serveFile, safeJoin, redirect, clientIp } from './http.js';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { Runner } from './runner.js';
import { registerApi, sanitizeDemoPath } from './api.js';
import { renderRoute, notFoundPage, faviconSvg, renderSitemap, renderFeed } from '../site/render.js';

const SITE_CSP = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "media-src 'self' https:",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Static demos run with an opaque origin, so their scripts cannot read the admin session
// stored for this site. CORS lets them still fetch their own files (WASM, data).
const DEMO_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock';

const ACTIVE_MEDIA = new Set(['.svg', '.html', '.htm', '.xml']);

export async function createApp(config, { log = console.log } = {}) {
  const store = new Store({ dataDir: config.dataDir, seedDir: config.seedDir });
  const { seeded } = await store.init();
  const auth = new Auth({ dataDir: config.dataDir, adminPassword: config.adminPassword, sessionSecret: config.sessionSecret, log });
  await auth.init();
  const runner = new Runner({ dockerBin: config.dockerBin, maxConcurrent: config.runMaxConcurrent });
  const router = createRouter();
  const assetVersion = crypto.randomBytes(4).toString('hex');
  const dirs = {
    assets: path.join(config.root, 'site', 'assets'),
    shared: path.join(config.root, 'shared'),
    admin: path.join(config.root, 'admin'),
  };

  registerApi(router, { store, auth, runner, config });

  const siteUrl = (req) => config.publicUrl || `${config.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host || 'localhost'}`;
  const renderCtx = (req, url) => ({
    base: '', apiBase: '', siteUrl: config.publicUrl, canRun: true, assetVersion, req,
    previewTheme: url?.searchParams.get('theme') || '', // ?theme=riso previews a theme without saving it
  });

  const serveFrom = (root, opts) => async (ctx) => {
    const file = safeJoin(root, ctx.params.wild || '');
    if (!file || !(await serveFile(ctx.req, ctx.res, file, opts))) throw new HttpError(404, 'Not found');
  };

  router.get('/assets/*', serveFrom(dirs.assets, { cacheControl: 'public, max-age=3600' }));
  router.get('/shared/*', serveFrom(dirs.shared, { cacheControl: 'no-cache' }));

  router.get('/admin/*', async (ctx) => {
    if (ctx.params.wild === undefined) return redirect(ctx.res, '/admin/', 301);
    const rel = ctx.params.wild || 'index.html';
    const file = safeJoin(dirs.admin, rel);
    const headers = { 'Content-Security-Policy': ADMIN_CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };
    if (file && (await serveFile(ctx.req, ctx.res, file, { cacheControl: 'no-cache', headers }))) return;
    // Unknown admin paths fall back to the app shell (it uses #hash routing anyway).
    await serveFile(ctx.req, ctx.res, path.join(dirs.admin, 'index.html'), { cacheControl: 'no-cache', headers });
  });

  router.get('/media/*', async (ctx) => {
    const rel = ctx.params.wild || '';
    const file = safeJoin(store.mediaDir, rel);
    const headers = ACTIVE_MEDIA.has(path.extname(rel).toLowerCase())
      ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }
      : {};
    if (!file || !rel || !(await serveFile(ctx.req, ctx.res, file, { headers, cacheControl: 'public, max-age=600' }))) {
      throw new HttpError(404, 'Not found');
    }
  });

  router.get('/d/:slug/*', async (ctx) => {
    const { slug } = ctx.params;
    const demo = store.read().demos.find((d) => d.slug === slug && d.kind === 'static');
    if (!demo) throw new HttpError(404, 'Not found');
    if (ctx.params.wild === undefined) return redirect(ctx.res, `/d/${encodeURIComponent(slug)}/`, 301);
    const rel = ctx.params.wild === '' ? demo.entry || 'index.html' : sanitizeDemoPath(ctx.params.wild);
    const root = safeJoin(store.demosDir, slug);
    const file = rel && root && safeJoin(root, rel);
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      ...(demo.isolate !== false ? { 'Content-Security-Policy': DEMO_SANDBOX } : {}),
    };
    if (!file || !(await serveFile(ctx.req, ctx.res, file, { headers, cacheControl: 'no-cache' }))) {
      throw new HttpError(404, 'Not found');
    }
  });

  router.get('/favicon.svg', (ctx) => sendText(ctx.res, 200, faviconSvg(store.read()), 'image/svg+xml', { 'Cache-Control': 'public, max-age=3600' }));
  router.get('/favicon.ico', (ctx) => redirect(ctx.res, '/favicon.svg', 301));
  router.get('/robots.txt', (ctx) =>
    sendText(ctx.res, 200, `User-agent: *\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${siteUrl(ctx.req)}/sitemap.xml\n`));
  router.get('/sitemap.xml', (ctx) => sendText(ctx.res, 200, renderSitemap(store.read(), siteUrl(ctx.req)), 'application/xml; charset=utf-8'));
  router.get('/feed.xml', (ctx) => sendText(ctx.res, 200, renderFeed(store.read(), siteUrl(ctx.req)), 'application/rss+xml; charset=utf-8'));

  const renderPage = (ctx) => {
    const result = renderRoute(ctx.url.pathname, store.read(), renderCtx(ctx.req, ctx.url));
    if (!result) throw new HttpError(404, 'Not found');
    if (result.redirect) return redirect(ctx.res, result.redirect, result.status);
    sendText(ctx.res, result.status, result.html, 'text/html; charset=utf-8', {
      'Content-Security-Policy': SITE_CSP,
      'Cache-Control': 'no-cache',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  };

  const corsPath = (p) => p.startsWith('/api/public/') || /^\/api\/demos\/[^/]+\/run$/.test(p) || p === '/api/health';
  const corsHeaders = (req) => {
    const origin = req.headers.origin;
    if (!origin) return {};
    const allowed = config.corsOrigins.split(',').map((s) => s.trim());
    if (allowed.includes('*')) return { 'Access-Control-Allow-Origin': '*' };
    return allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  };

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendText(res, 400, 'Bad request');
    }
    const isApi = url.pathname.startsWith('/api/');
    if (isApi && corsPath(url.pathname)) {
      for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        });
        return res.end();
      }
    }
    const ctx = {
      req,
      res,
      url,
      query: url.searchParams,
      ip: clientIp(req, config.trustProxy),
      admin: auth.fromRequest(req),
      params: {},
    };
    try {
      const match = router.match(req.method, url.pathname);
      if (!match.handler && !isApi && (req.method === 'GET' || req.method === 'HEAD') && !match.allowed?.length) {
        match.handler = renderPage;
        match.params = {};
      }
      if (!match.handler) {
        if (match.allowed?.length) throw new HttpError(405, `Use ${match.allowed.join(' or ')} for this address`);
        throw new HttpError(404, 'Not found');
      }
      ctx.params = match.params;
      const result = await match.handler(ctx);
      if (!res.headersSent && result !== undefined) sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500 && !(err instanceof HttpError)) log(`[error] ${req.method} ${url.pathname}: ${err.stack || err}`);
      if (res.headersSent) return res.destroy();
      if (isApi) {
        const body = { error: status === 500 && !(err instanceof HttpError) ? 'Something went wrong on the server. The details are in the server log.' : err.message };
        if (err.details) Object.assign(body, err.details);
        const headers = err.details?.retryAfter ? { 'Retry-After': String(err.details.retryAfter) } : {};
        return sendJson(res, status, body, headers);
      }
      if (status === 404 && req.method !== 'POST') {
        return sendText(res, 404, String(notFoundPage(store.read(), renderCtx(req, url))), 'text/html; charset=utf-8', { 'Content-Security-Policy': SITE_CSP });
      }
      return sendText(res, status, status === 500 ? 'Something went wrong on the server.' : err.message);
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  // Node drops any request that takes over 5 minutes, which would cut off a large video
  // upload on a home connection. Headers must still arrive within a minute.
  server.requestTimeout = 60 * 60 * 1000;

  return {
    server,
    store,
    auth,
    runner,
    seeded,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
