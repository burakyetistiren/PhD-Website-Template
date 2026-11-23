#!/usr/bin/env node
import { loadEnvFile, loadConfig } from './config.js';
import { createApp } from './app.js';

loadEnvFile();
const config = loadConfig();
const app = await createApp(config);
const address = await app.listen();
const host = address.address === '0.0.0.0' || address.address === '::' ? 'localhost' : address.address;
const base = `http://${host}:${address.port}`;

console.log(`
  Site     ${base}/
  Admin    ${base}/admin/
  Data     ${config.dataDir}${app.seeded ? '  (created with example content)' : ''}
`);

app.runner.status().then((s) => {
  console.log(s.available ? `  Playground demos: Docker ${s.version} is ready.\n` : `  Playground demos are off: ${s.reason}. Static and embedded demos still work.\n`);
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
