import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads KEY=VALUE lines from a .env file without overriding variables that are already set. */
export function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    process.env[m[1]] = value;
  }
}

export function loadConfig(env = process.env) {
  const int = (v, d) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };
  return {
    root: ROOT,
    port: int(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
    seedDir: path.join(ROOT, 'seed'),
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    trustProxy: env.TRUST_PROXY === 'true',
    dockerBin: env.DOCKER_BIN || 'docker',
    runMaxConcurrent: Math.max(1, int(env.RUN_MAX_CONCURRENT, 2)),
    runRateLimit: Math.max(1, int(env.RUN_RATE_LIMIT, 30)),
    runMaxInputBytes: Math.max(1, int(env.RUN_MAX_INPUT_KB, 100)) * 1024,
    maxUploadBytes: Math.max(1, int(env.MAX_UPLOAD_MB, 50)) * 1024 * 1024,
    corsOrigins: env.CORS_ORIGINS || '*',
    quiet: env.QUIET === 'true',
  };
}
