import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeContent, validateContent } from './schema.js';
import { HttpError } from './http.js';

/**
 * Content lives in one human-readable JSON file (data/content.json), so it can be
 * diffed, committed or edited by hand. Every save is atomic (write + rename) and the
 * previous version is kept in data/backups/ so mistakes can be undone from the admin.
 */
export class Store {
  constructor({ dataDir, seedDir, maxBackups = 50 }) {
    this.dataDir = dataDir;
    this.seedDir = seedDir;
    this.maxBackups = maxBackups;
    this.contentPath = path.join(dataDir, 'content.json');
    this.mediaDir = path.join(dataDir, 'media');
    this.demosDir = path.join(dataDir, 'demos');
    this.backupsDir = path.join(dataDir, 'backups');
    this.queue = Promise.resolve();
    this.content = null;
  }

  async init() {
    for (const dir of [this.dataDir, this.mediaDir, this.demosDir, this.backupsDir]) {
      await fsp.mkdir(dir, { recursive: true });
    }
    // If you choose to commit data/ (e.g. for GitHub Pages), secrets still stay out of git.
    const gitignore = path.join(this.dataDir, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      await fsp.writeFile(gitignore, '# Never commit these: they let anyone sign in to your admin.\nauth.json\nsecret.key\nbackups/\n*.tmp\n');
    }
    let seeded = false;
    if (!fs.existsSync(this.contentPath)) {
      seeded = true;
      const seedContent = path.join(this.seedDir, 'content.json');
      if (fs.existsSync(seedContent)) {
        await fsp.copyFile(seedContent, this.contentPath);
        for (const sub of ['media', 'demos']) {
          const from = path.join(this.seedDir, sub);
          if (fs.existsSync(from)) await fsp.cp(from, path.join(this.dataDir, sub), { recursive: true, force: false });
        }
      } else {
        await writeAtomic(this.contentPath, JSON.stringify(normalizeContent({}), null, 2) + '\n');
      }
    }
    try {
      this.content = normalizeContent(JSON.parse(await fsp.readFile(this.contentPath, 'utf8')));
    } catch (e) {
      throw new Error(`Could not read ${this.contentPath}: ${e.message}. Fix the JSON or restore a file from ${this.backupsDir}.`);
    }
    return { seeded };
  }

  /** The current content. Treat it as read-only; change it through update(). */
  read() {
    return this.content;
  }

  /**
   * Applies `mutator` to a copy of the content and saves it. Updates run one at a time,
   * so concurrent requests cannot overwrite each other. If the mutator throws, nothing is saved.
   */
  update(mutator) {
    const run = async () => {
      const draft = structuredClone(this.content);
      const result = await mutator(draft);
      draft.meta = { ...draft.meta, updatedAt: new Date().toISOString() };
      await this.backup();
      await writeAtomic(this.contentPath, JSON.stringify(draft, null, 2) + '\n');
      this.content = draft;
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async backup() {
    if (!fs.existsSync(this.contentPath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.copyFile(this.contentPath, path.join(this.backupsDir, `content-${stamp}.json`));
    const files = (await this.listBackups()).slice(this.maxBackups);
    await Promise.all(files.map((f) => fsp.rm(path.join(this.backupsDir, f.name), { force: true })));
  }

  async listBackups() {
    const names = (await fsp.readdir(this.backupsDir)).filter((n) => /^content-[\w-]+\.json$/.test(n));
    const out = await Promise.all(
      names.map(async (name) => {
        const stat = await fsp.stat(path.join(this.backupsDir, name));
        return { name, size: stat.size, savedAt: stat.mtime.toISOString() };
      }),
    );
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  async readBackup(name) {
    if (!/^content-[\w-]+\.json$/.test(name)) throw new HttpError(400, 'Not a backup file name');
    try {
      return JSON.parse(await fsp.readFile(path.join(this.backupsDir, name), 'utf8'));
    } catch {
      throw new HttpError(404, 'That backup does not exist');
    }
  }

  /** Replaces all content after validating it. The version being replaced is backed up first. */
  async replace(input) {
    const { value, errors } = validateContent(input);
    if (Object.keys(errors).length) throw new HttpError(422, 'The content has fields that need attention', { fields: errors });
    await this.update((draft) => {
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, value);
    });
    return this.content;
  }
}

export async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}
