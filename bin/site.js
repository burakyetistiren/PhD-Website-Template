#!/usr/bin/env node
/**
 * Command-line companion to the admin console.
 *   Local commands work on the data/ folder of this checkout.
 *   Remote commands talk to a running site through its API (log in once with `login`).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { loadEnvFile, loadConfig, ROOT } from '../server/config.js';

const HELP = `Usage: npm run site -- <command> [options]

On the server (works on the local data/ folder):
  set-password                      Set the admin password
  export <dir> [--base /repo] [--site-url https://you.github.io] [--api-url https://live.site]
                                    Write a static copy of the site (for GitHub Pages and similar)

From anywhere (talks to a running site):
  login [--url https://your.site]   Sign in and remember the address
  status                            Show the site and demo runner status
  news "text" [--date YYYY-MM-DD]   Post a news item (Markdown allowed)
  bibtex <file.bib> [--dry-run]     Import publications
  push-demo <slug> <folder> [--title "Name"] [--keep]
                                    Upload a built web app as a browser demo.
                                    Creates the demo if --title is given and it doesn't exist.
                                    Replaces existing files unless --keep.
  backup [file.json]                Download all content
  restore <file.json>               Replace all content (the current version is backed up first)

Environment: SITE_URL and SITE_TOKEN override the saved login.`;

const CREDENTIALS = path.join(os.homedir(), '.config', 'phd-site', 'credentials.json');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// One shared line reader, so several prompts work both interactively and with piped input.
let rl = null;
let stdinClosed = false;
const pendingLines = [];
const waiting = [];
function reader() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else pendingLines.push(line);
  });
  rl.on('close', () => {
    stdinClosed = true;
    while (waiting.length) waiting.shift()('');
  });
  return rl;
}

function ask(question, { hidden = false } = {}) {
  const r = reader();
  const mask = hidden && process.stdin.isTTY;
  return new Promise((resolve) => {
    process.stdout.write(question);
    if (mask) r._writeToOutput = () => {};
    const done = (line) => {
      if (mask) {
        r._writeToOutput = (s) => r.output.write(s);
        process.stdout.write('\n');
      }
      resolve(line);
    };
    if (pendingLines.length) done(pendingLines.shift());
    else if (stdinClosed) done('');
    else waiting.push(done);
  });
}

// ── Remote API client ─────────────────────────────────────────────────────

function credentials() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CREDENTIALS, 'utf8'));
  } catch {}
  const url = (process.env.SITE_URL || saved.url || '').replace(/\/+$/, '');
  const token = process.env.SITE_TOKEN || saved.token;
  if (!url || !token) die('Not logged in. Run: npm run site -- login --url https://your.site');
  return { url, token };
}

async function call(method, apiPath, { body, raw, auth = true, url: baseUrl } = {}) {
  const creds = auth ? credentials() : { url: baseUrl };
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${creds.token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(creds.url + apiPath, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch (e) {
    die(`Couldn't reach ${creds.url}: ${e.cause?.code || e.message}`);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && auth) die('Your login expired or the password changed. Run `login` again.');
  if (!res.ok) {
    const fields = data?.fields ? '\n' + Object.entries(data.fields).map(([k, v]) => `  ${k}: ${v}`).join('\n') : '';
    die(`${data?.error || `HTTP ${res.status}`}${fields}`);
  }
  return data;
}

async function walk(dir, prefix = '') {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// ── Commands ──────────────────────────────────────────────────────────────

const commands = {
  async 'set-password'() {
    loadEnvFile();
    const config = loadConfig();
    if (config.adminPassword) die('ADMIN_PASSWORD is set in the environment or .env, which takes priority. Change it there instead.');
    const { Auth } = await import('../server/auth.js');
    await fsp.mkdir(config.dataDir, { recursive: true });
    const pw = await ask('New admin password: ', { hidden: true });
    const again = await ask('Repeat it: ', { hidden: true });
    if (pw !== again) die('The passwords are different.');
    const auth = new Auth({ dataDir: config.dataDir });
    try {
      await auth.setPassword(pw);
    } catch (e) {
      die(e.message);
    }
    console.log(`Saved to ${path.join(config.dataDir, 'auth.json')}. Restart the server if it is running; existing sessions are signed out.`);
  },

  async export({ positional, flags }) {
    loadEnvFile();
    const config = loadConfig();
    const outDir = path.resolve(positional[0] || 'dist');
    const { Store } = await import('../server/store.js');
    const { exportSite } = await import('../site/export.js');
    const store = new Store({ dataDir: config.dataDir, seedDir: config.seedDir });
    await store.init();
    const r = await exportSite({
      store,
      root: ROOT,
      outDir,
      base: typeof flags.base === 'string' ? flags.base : '',
      apiBase: typeof flags['api-url'] === 'string' ? flags['api-url'] : '',
      siteUrl: typeof flags['site-url'] === 'string' ? flags['site-url'] : config.publicUrl,
    });
    console.log(`Wrote ${r.pages} pages to ${r.outDir}`);
    if (!flags['api-url']) console.log('Playground demos are shown as offline. Pass --api-url to run them on your live server.');
  },

  async login({ flags }) {
    const url = String(flags.url || (await ask('Site address (e.g. https://your.site): '))).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) die('Use a full address starting with http:// or https://');
    const password = await ask('Admin password: ', { hidden: true });
    const { token, expiresAt } = await call('POST', '/api/auth/login', { body: { password, client: 'cli' }, auth: false, url });
    await fsp.mkdir(path.dirname(CREDENTIALS), { recursive: true });
    await fsp.writeFile(CREDENTIALS, JSON.stringify({ url, token }, null, 2), { mode: 0o600 });
    console.log(`Logged in to ${url} until ${new Date(expiresAt).toLocaleDateString()}.`);
  },

  async status() {
    const { url } = credentials();
    const health = await call('GET', '/api/health');
    const runner = await call('GET', '/api/runner');
    const content = await call('GET', '/api/content');
    console.log(`Site:     ${url}`);
    console.log(`Saved:    ${health.updatedAt ? new Date(health.updatedAt).toLocaleString() : 'never'}`);
    console.log(`Content:  ${content.publications.length} publications, ${content.demos.length} demos, ${content.news.length} news items`);
    console.log(`Docker:   ${runner.docker.available ? `ready (${runner.docker.version})` : runner.docker.reason}`);
  },

  async news({ positional, flags }) {
    const text = positional.join(' ').trim();
    if (!text) die('Write the news text in quotes: npm run site -- news "Paper accepted!"');
    const date = typeof flags.date === 'string' ? flags.date : new Date().toISOString().slice(0, 10);
    await call('POST', '/api/collections/news', { body: { date, text } });
    console.log(`Posted news for ${date}.`);
  },

  async bibtex({ positional, flags }) {
    if (!positional[0]) die('Give the .bib file: npm run site -- bibtex papers.bib');
    const bibtex = await fsp.readFile(positional[0], 'utf8');
    const r = await call('POST', '/api/publications/import-bibtex', { body: { bibtex, dryRun: Boolean(flags['dry-run']) } });
    for (const p of r.added) console.log(`${r.dryRun ? 'would add' : 'added'}  ${p.title}`);
    for (const s of r.skipped) console.log(`skipped    ${s.title} (${s.reason})`);
    console.log(`${r.added.length} ${r.dryRun ? 'would be added' : 'added'}, ${r.skipped.length} skipped.`);
  },

  async 'push-demo'({ positional, flags }) {
    const [slug, folder] = positional;
    if (!slug || !folder) die('Usage: npm run site -- push-demo <slug> <folder>');
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) die(`${folder} is not a folder`);
    const { items } = await call('GET', '/api/collections/demos');
    let demo = items.find((d) => d.slug === slug);
    if (!demo) {
      if (!flags.title) die(`No demo at /demos/${slug}. Create it in the admin, or pass --title "Name" to create it now.`);
      ({ item: demo } = await call('POST', '/api/collections/demos', { body: { title: String(flags.title), slug, kind: 'static' } }));
      console.log(`Created demo /demos/${slug}`);
    } else if (demo.kind !== 'static') {
      console.warn(`warning: /demos/${slug} is a "${demo.kind}" demo; uploaded files are only served for browser demos.`);
    }
    const files = await walk(folder);
    if (!files.length) die(`${folder} is empty`);
    if (!files.includes(demo.entry || 'index.html')) console.warn(`warning: ${folder} has no ${demo.entry || 'index.html'} (the demo's start page)`);
    if (!flags.keep) await call('DELETE', `/api/demos/${encodeURIComponent(slug)}/files/`);
    let bytes = 0;
    for (const [i, rel] of files.entries()) {
      const data = await fsp.readFile(path.join(folder, rel));
      bytes += data.length;
      process.stdout.write(`\r${i + 1}/${files.length} ${rel.slice(-60).padEnd(60)}`);
      await call('PUT', `/api/demos/${encodeURIComponent(slug)}/files/${rel.split('/').map(encodeURIComponent).join('/')}`, { raw: data, body: data });
    }
    process.stdout.write('\n');
    console.log(`Uploaded ${files.length} files (${(bytes / 1048576).toFixed(1)} MB). Live at ${credentials().url}/demos/${slug}`);
  },

  async backup({ positional }) {
    const file = positional[0] || `site-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const content = await call('GET', '/api/content');
    await fsp.writeFile(file, JSON.stringify(content, null, 2) + '\n');
    console.log(`Saved ${file}`);
  },

  async restore({ positional, flags }) {
    if (!positional[0]) die('Give the backup file: npm run site -- restore site-backup.json');
    const data = JSON.parse(await fsp.readFile(positional[0], 'utf8'));
    if (!flags.yes) {
      const answer = await ask(`Replace ALL content on ${credentials().url} with ${positional[0]}? Type "yes": `);
      if (answer.trim() !== 'yes') die('Cancelled.');
    }
    await call('PUT', '/api/content', { body: data });
    console.log('Restored. The previous version is in History and backups.');
  },
};

const { positional, flags } = parseArgs(process.argv.slice(2));
const name = positional.shift();
if (!name || name === 'help' || flags.help || !commands[name]) {
  console.log(HELP);
  process.exit(name && name !== 'help' && !commands[name] ? 1 : 0);
}
await commands[name]({ positional, flags });
rl?.close();
