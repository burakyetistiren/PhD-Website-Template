/**
 * Static export: writes the whole site as plain files, for hosting on GitHub Pages,
 * Netlify or a university web space. Browser demos and embeds keep working. Playground
 * demos need a running server; pass apiBase to point them at one (CORS is enabled).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { renderRoute, listRoutes, notFoundPage, faviconSvg, renderSitemap, renderFeed } from './render.js';
import { publicContent } from '../server/schema.js';
import { escapeHtml } from '../shared/markdown.js';

export async function exportSite({ store, root, outDir, base = '', apiBase = '', siteUrl = '' }) {
  base = base.replace(/\/+$/, '');
  if (base && !base.startsWith('/')) base = `/${base}`;
  apiBase = apiBase.replace(/\/+$/, '');
  siteUrl = siteUrl.replace(/\/+$/, '');
  const content = store.read();
  const ctx = { base, apiBase, siteUrl, canRun: Boolean(apiBase), staticExport: true, assetVersion: Date.now().toString(36) };

  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  const write = async (rel, data) => {
    const file = path.join(outDir, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data);
  };

  let pages = 0;
  for (const route of listRoutes(content)) {
    const result = renderRoute(route, content, ctx);
    if (!result?.html) continue;
    await write(route === '/' ? 'index.html' : path.join(route.slice(1), 'index.html'), result.html);
    pages++;
  }
  await write('404.html', String(notFoundPage(content, ctx)));
  if (content.profile.cv) {
    const target = content.profile.cv.startsWith('/') ? base + content.profile.cv : content.profile.cv;
    await write('cv/index.html', `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escapeHtml(target)}"><a href="${escapeHtml(target)}">CV</a>\n`);
  }

  await fsp.cp(path.join(root, 'site', 'assets'), path.join(outDir, 'assets'), { recursive: true });
  if (fs.existsSync(store.mediaDir)) await fsp.cp(store.mediaDir, path.join(outDir, 'media'), { recursive: true });
  for (const demo of content.demos.filter((d) => d.kind === 'static')) {
    const from = path.join(store.demosDir, demo.slug);
    if (fs.existsSync(from)) await fsp.cp(from, path.join(outDir, 'd', demo.slug), { recursive: true });
  }

  await write('favicon.svg', faviconSvg(content));
  await write('content.json', JSON.stringify(publicContent(content), null, 2));
  await write('.nojekyll', '');
  if (siteUrl) {
    await write('sitemap.xml', renderSitemap(content, siteUrl + base));
    await write('feed.xml', renderFeed(content, siteUrl + base));
    await write('robots.txt', `User-agent: *\nSitemap: ${siteUrl + base}/sitemap.xml\n`);
  }
  return { pages, outDir };
}
