import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic } from './store.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPasswordHash(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Admin authentication. There is one admin (the site owner). Logging in exchanges the
 * password for a signed, expiring token. Tokens are signed with a key derived from both
 * the session secret and the password, so changing the password signs everyone out.
 */
export class Auth {
  constructor({ dataDir, adminPassword = '', sessionSecret = '', log = console.log }) {
    this.dataDir = dataDir;
    this.envPassword = adminPassword;
    this.envSecret = sessionSecret;
    this.log = log;
    this.authFile = path.join(dataDir, 'auth.json');
    this.secretFile = path.join(dataDir, 'secret.key');
  }

  async init() {
    this.secret = this.envSecret || (await this.loadOrCreateSecret());
    if (this.envPassword) {
      this.passwordFingerprint = crypto.createHash('sha256').update(this.envPassword).digest('hex');
    } else if (fs.existsSync(this.authFile)) {
      const data = JSON.parse(await fsp.readFile(this.authFile, 'utf8'));
      this.passwordHash = data.passwordHash;
      this.passwordFingerprint = this.passwordHash;
    } else {
      const generated = crypto.randomBytes(9).toString('base64url');
      await this.setPassword(generated);
      this.log(
        [
          '',
          '  ┌────────────────────────────────────────────────────────┐',
          `  │  Admin password (shown once): ${generated.padEnd(25)}│`,
          '  │  Change it in the admin under Account, or run          │',
          '  │  npm run site -- set-password                          │',
          '  └────────────────────────────────────────────────────────┘',
          '',
        ].join('\n'),
      );
    }
    this.signingKey = crypto.createHmac('sha256', this.secret).update(this.passwordFingerprint).digest();
  }

  get passwordFromEnv() {
    return Boolean(this.envPassword);
  }

  async loadOrCreateSecret() {
    if (fs.existsSync(this.secretFile)) return (await fsp.readFile(this.secretFile, 'utf8')).trim();
    const secret = crypto.randomBytes(32).toString('hex');
    await fsp.writeFile(this.secretFile, secret + '\n', { mode: 0o600 });
    return secret;
  }

  checkPassword(password) {
    if (typeof password !== 'string' || !password) return false;
    if (this.envPassword) {
      const a = crypto.createHash('sha256').update(password).digest();
      const b = crypto.createHash('sha256').update(this.envPassword).digest();
      return crypto.timingSafeEqual(a, b);
    }
    return verifyPasswordHash(password, this.passwordHash);
  }

  async setPassword(password) {
    if (this.envPassword) throw new Error('The password is set by the ADMIN_PASSWORD environment variable. Change it there.');
    if (typeof password !== 'string' || password.length < 8) throw new Error('Use at least 8 characters');
    this.passwordHash = hashPassword(password);
    this.passwordFingerprint = this.passwordHash;
    await writeAtomic(this.authFile, JSON.stringify({ passwordHash: this.passwordHash }, null, 2) + '\n');
    await fsp.chmod(this.authFile, 0o600).catch(() => {});
    if (this.secret) this.signingKey = crypto.createHmac('sha256', this.secret).update(this.passwordFingerprint).digest();
  }

  issueToken({ ttlSeconds = 7 * 24 * 3600, client = 'admin' } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({ sub: 'admin', client, iat: now, exp: now + ttlSeconds }));
    const sig = b64url(crypto.createHmac('sha256', this.signingKey).update(payload).digest());
    return { token: `v1.${payload}.${sig}`, expiresAt: new Date((now + ttlSeconds) * 1000).toISOString() };
  }

  verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [v, payload, sig] = token.split('.');
    if (v !== 'v1' || !payload || !sig) return null;
    const expected = crypto.createHmac('sha256', this.signingKey).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
      return data;
    } catch {
      return null;
    }
  }

  fromRequest(req) {
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    return m ? this.verifyToken(m[1].trim()) : null;
  }
}

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    take(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (hits.size > 10000) for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
      return { ok: entry.count <= max, retryAfter: Math.max(1, Math.ceil((entry.reset - now) / 1000)) };
    },
  };
}
