import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.bib': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.cast': 'application/x-asciicast',
  '.zip': 'application/zip',
  '.data': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

export function mimeType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Tiny router. Patterns support `:param` segments and a trailing `*` that captures the rest
 * of the path as `params.wild`.
 */
export function createRouter() {
  const routes = [];
  const compile = (pattern) => {
    let src = '';
    for (const part of pattern.split('/').filter(Boolean)) {
      if (part === '*') src += '(?:/(?<wild>.*))?';
      else if (part.startsWith(':')) src += `/(?<${part.slice(1)}>[^/]+)`;
      else src += '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + (src || '') + (pattern.endsWith('*') ? '' : '/?') + '$');
  };
  const add = (method, pattern, handler) => routes.push({ method, re: compile(pattern), handler });
  return {
    add,
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    /** Returns { handler, params } or { allowed: [...methods] } when only the method is wrong. */
    match(method, pathname) {
      const allowed = new Set();
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (r.method === method || (method === 'HEAD' && r.method === 'GET')) {
          const params = {};
          for (const [k, v] of Object.entries(m.groups || {})) {
            if (v === undefined) continue;
            try {
              params[k] = decodeURIComponent(v);
            } catch {
              throw new HttpError(400, 'Malformed URL');
            }
          }
          return { handler: r.handler, params };
        }
        allowed.add(r.method);
      }
      return { allowed: [...allowed] };
    },
  };
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    let size = 0;
    let failed = false;
    const chunks = [];
    const fail = () => {
      if (failed) return;
      failed = true;
      req.resume();
      reject(new HttpError(413, `Upload is larger than the ${formatBytes(limit)} limit`));
    };
    if (declared > limit) return fail();
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) fail();
      else chunks.push(chunk);
    });
    req.on('end', () => !failed && resolve(Buffer.concat(chunks)));
    req.on('error', (e) => !failed && reject(e));
  });
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

export function sendText(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

/** Joins `rel` onto `root`, refusing anything that would escape `root`. */
export function safeJoin(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, '.' + path.sep + String(rel || ''));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** Streams a file. Returns false when it does not exist so callers can fall through to a 404. */
export async function serveFile(req, res, filePath, { headers = {}, cacheControl = 'public, max-age=300' } = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath);
    }
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const common = { ETag: etag, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', ...headers };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, common);
    res.end();
    return true;
  }
  res.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    ...common,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(filePath).pipe(res);
  return true;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n / 1024 / 1024)} MB`;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
