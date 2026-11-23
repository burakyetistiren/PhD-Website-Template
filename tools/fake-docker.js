#!/usr/bin/env node
// Stand-in for the docker CLI so tests and local previews can exercise playground demos
// without a Docker daemon. Set DOCKER_BIN to this file.
//   image "phd-site-example-linter" → runs examples/linter-demo/tidylint.py locally
//   image "sleepy"                  → never exits (tests the time limit)
//   image "missing"                 → fails like a missing image (exit 125)
//   anything else                   → echoes the command and upper-cased stdin
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (args[0] === 'version') {
  console.log('27.0.0-fake');
  process.exit(0);
}
if (args[0] === 'image' && args[1] === 'inspect') {
  if (args.at(-1) === 'missing') process.exit(1);
  console.log('sha256:0123456789abcdef0123456789|12345678');
  process.exit(0);
}
if (args[0] === 'kill' || args[0] === 'pull') process.exit(0);
if (args[0] !== 'run') process.exit(2);

if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\n');
const withValue = new Set(['--pull', '--name', '--network', '--memory', '--memory-swap', '--cpus', '--pids-limit', '--tmpfs', '--security-opt', '--user', '-e', '-w', '--entrypoint', '--cap-drop']);
let i = 1;
while (i < args.length && args[i].startsWith('-')) i += withValue.has(args[i]) ? 2 : 1;
const image = args[i];
const cmd = args.slice(i + 1);

if (image === 'missing') {
  process.stderr.write(`Error response from daemon: No such image: ${image}\n`);
  process.exit(125);
}
if (image === 'sleepy') {
  setInterval(() => {}, 1000);
} else if (image === 'phd-site-example-linter') {
  const local = cmd.map((a) => (a === '/app/tidylint.py' ? path.join(root, 'examples', 'linter-demo', 'tidylint.py') : a));
  const child = spawn(local[0], local.slice(1), { stdio: ['pipe', 'inherit', 'inherit'] });
  process.stdin.pipe(child.stdin);
  child.on('close', (code) => process.exit(code ?? 1));
} else {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    process.stdout.write(`ran: ${cmd.join(' ')}\n${input.toUpperCase()}`);
    process.exit(0);
  });
}
