import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const MAX_OUTPUT = 256 * 1024;

/** Splits a command string like a shell would: quotes and backslashes, no expansion. */
export function splitArgs(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (quote) throw new Error('The command has an unclosed quote');
  if (started) out.push(cur);
  return out;
}

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * Builds the `docker run` arguments for a playground demo. The container gets no network,
 * a read-only filesystem with a small writable /tmp, no Linux capabilities, an unprivileged
 * user, and memory/CPU/process limits. Visitors only supply stdin; they cannot change the
 * image or command, only pick one of the presets the owner defined.
 */
export function buildDockerArgs(demo, { args = [], name }) {
  if (!demo.image) throw new HttpError(500, 'This demo has no Docker image configured');
  const mem = clamp(demo.memoryMb, 32, 8192, 256);
  const cpus = clamp(demo.cpus, 0.1, 16, 0.5);
  const base = [
    'run', '--rm', '-i', '--pull', 'never', '--name', name,
    '--network', 'none',
    '--memory', `${mem}m`, '--memory-swap', `${mem}m`,
    '--cpus', String(cpus),
    '--pids-limit', '128',
    '--read-only', '--tmpfs', '/tmp:rw,exec,nosuid,size=64m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    // PYTHONUNBUFFERED: Python tools buffer piped output, so a run stopped at the time
    // limit would otherwise show nothing. Harmless for images without Python.
    '-e', 'HOME=/tmp', '-e', 'PYTHONUNBUFFERED=1', '-w', '/tmp',
  ];

  const cmd = splitArgs(demo.command || '');
  const argsAt = cmd.indexOf('{args}');
  const full = argsAt === -1 ? [...cmd, ...args] : [...cmd.slice(0, argsAt), ...args, ...cmd.slice(argsAt + 1)];

  if (full.some((a) => a.includes('{input}'))) {
    const fileName = String(demo.inputFilename || 'input.txt').replace(/[^\w.-]/g, '_').replace(/^\.+/, '') || 'input.txt';
    const inputPath = `/tmp/${fileName}`;
    const replaced = full.map((a) => a.replaceAll('{input}', inputPath));
    // Write stdin to a file first, then hand over to the tool. Needs `sh` in the image.
    return [...base, '--entrypoint', 'sh', demo.image, '-c', `cat > '${inputPath}' && exec "$@"`, 'sh', ...replaced];
  }
  return [...base, demo.image, ...full];
}

function collector() {
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    push(chunk) {
      if (size >= MAX_OUTPUT) {
        truncated = true;
        return;
      }
      const room = MAX_OUTPUT - size;
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        truncated = true;
      } else chunks.push(chunk);
      size += Math.min(chunk.length, room);
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() {
      return truncated;
    },
  };
}

export class Runner {
  constructor({ dockerBin = 'docker', maxConcurrent = 2, maxQueue = 8 } = {}) {
    this.dockerBin = dockerBin;
    this.max = maxConcurrent;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.waiting = [];
    this.statusCache = null;
    this.pulls = new Map();
  }

  exec(args, timeout = 8000) {
    return new Promise((resolve) => {
      execFile(this.dockerBin, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, code: error?.code, stdout: String(stdout).trim(), stderr: String(stderr).trim() });
      });
    });
  }

  /** Whether Docker is usable. Cached for 30 seconds. */
  async status({ fresh = false } = {}) {
    if (!fresh && this.statusCache && Date.now() - this.statusCache.at < 30000) return this.statusCache.value;
    const r = await this.exec(['version', '--format', '{{.Server.Version}}']);
    let value;
    if (r.ok && r.stdout) value = { available: true, version: r.stdout };
    else if (r.code === 'ENOENT') value = { available: false, reason: `Docker is not installed (looked for "${this.dockerBin}")` };
    else value = { available: false, reason: /daemon|connect/i.test(r.stderr) ? 'Docker is installed but not running' : r.stderr || 'Docker did not respond' };
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  async imageStatus(image) {
    const pull = this.pulls.get(image);
    if (!image) return { present: false, pull };
    const r = await this.exec(['image', 'inspect', '--format', '{{.Id}}|{{.Size}}', image]);
    if (!r.ok) return { present: false, pull };
    const [id, size] = r.stdout.split('|');
    return { present: true, id: id.slice(0, 19), size: Number(size), pull };
  }

  /** Starts `docker pull` in the background; poll imageStatus() for progress. */
  pull(image) {
    const current = this.pulls.get(image);
    if (current?.state === 'pulling') return current;
    const job = { state: 'pulling', startedAt: new Date().toISOString() };
    this.pulls.set(image, job);
    this.exec(['pull', image], 15 * 60 * 1000).then((r) => {
      job.state = r.ok ? 'done' : 'failed';
      job.finishedAt = new Date().toISOString();
      if (!r.ok) job.error = r.stderr.split('\n').pop() || 'docker pull failed';
    });
    return job;
  }

  acquire() {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) {
      throw new HttpError(503, 'The demo server is busy right now. Try again in a minute.');
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  async run(demo, { input = '', args = [] } = {}) {
    if (demo.runner === 'http') return this.runHttp(demo, { input, args });
    const status = await this.status();
    if (!status.available) throw new HttpError(503, `This demo can't run right now: ${status.reason.toLowerCase()}.`);
    await this.acquire();
    try {
      return await this.runDocker(demo, { input, args });
    } finally {
      this.release();
    }
  }

  runDocker(demo, { input, args }) {
    const name = `phdsite-${String(demo.slug).slice(0, 40)}-${crypto.randomBytes(4).toString('hex')}`;
    const dockerArgs = buildDockerArgs(demo, { args, name });
    const timeoutMs = clamp(demo.timeoutSec, 1, 120, 10) * 1000;
    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(this.dockerBin, dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out = collector();
      const err = collector();
      let timedOut = false;
      let killTimer;
      child.stdout.on('data', (d) => out.push(d));
      child.stderr.on('data', (d) => err.push(d));
      const timer = setTimeout(() => {
        timedOut = true;
        execFile(this.dockerBin, ['kill', name], () => {});
        killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: '', exitCode: null, durationMs: 0, error: e.code === 'ENOENT' ? 'Docker is not installed on this server' : e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        const result = {
          stdout: out.text(),
          stderr: err.text(),
          exitCode: code,
          durationMs: Date.now() - started,
          timedOut,
          truncated: out.truncated || err.truncated,
        };
        // 125: docker itself failed (missing image, bad flags); 126/127: command not runnable.
        if (!timedOut && code === 125) result.error = "The demo's container could not start.";
        resolve(result);
      });
      child.stdin.on('error', () => {}); // the tool may exit before reading all input
      child.stdin.end(input);
    });
  }

  async runHttp(demo, { input, args }) {
    if (!demo.endpoint) throw new HttpError(500, 'This demo has no endpoint configured');
    const timeoutMs = clamp(demo.timeoutSec, 1, 120, 10) * 1000;
    const started = Date.now();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' };
    if (demo.endpointToken) headers.Authorization = `Bearer ${demo.endpointToken}`;
    try {
      const res = await fetch(demo.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input, args, demo: demo.slug }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_OUTPUT * 2);
      const text = buf.toString('utf8');
      const durationMs = Date.now() - started;
      if (/json/i.test(res.headers.get('content-type') || '')) {
        try {
          const data = JSON.parse(text);
          return {
            stdout: String(data.stdout ?? data.output ?? ''),
            stderr: String(data.stderr ?? data.error ?? ''),
            exitCode: Number.isInteger(data.exitCode) ? data.exitCode : res.ok ? 0 : 1,
            durationMs,
            truncated: buf.length >= MAX_OUTPUT * 2,
          };
        } catch {
          /* fall through to plain text */
        }
      }
      return { stdout: res.ok ? text : '', stderr: res.ok ? '' : text, exitCode: res.ok ? 0 : 1, durationMs, truncated: buf.length >= MAX_OUTPUT * 2 };
    } catch (e) {
      const timedOut = e.name === 'TimeoutError';
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: Date.now() - started,
        timedOut,
        error: timedOut ? undefined : 'The demo endpoint could not be reached.',
      };
    }
  }
}
