import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateFields, normalizeContent, SINGLETONS } from '../server/schema.js';
import { renderRoute } from '../site/render.js';

const home = (settings) => renderRoute('/', normalizeContent({ profile: { name: 'A' }, settings }), {}).html;
const animationField = SINGLETONS.settings.fields.find((f) => f.key === 'animation');

test('animations: every style in Site settings reaches <html>, and "none" leaves it off', () => {
  assert.match(home({}), /<html[^>]* data-motion="rise"/, 'rise is the default');
  for (const { value } of animationField.options) {
    if (value === 'none') assert.doesNotMatch(home({ animation: value }), /data-motion/);
    else assert.match(home({ animation: value }), new RegExp(`<html[^>]* data-motion="${value}"`));
  }
  assert.doesNotMatch(home({ animation: '"><script>' }), /data-motion|"><script>/, 'hand-edited junk is ignored');
});

test('animations: only the listed styles are accepted', () => {
  const fields = SINGLETONS.settings.fields;
  assert.equal(validateFields(fields, { animation: 'spin' }).errors.animation, 'Pick one of the listed options');
  assert.equal(validateFields(fields, { animation: 'slide' }).value.animation, 'slide');
});

test('animations: each style has its hidden state in site.css and the admin preview', () => {
  const site = fs.readFileSync(new URL('../site/assets/site.css', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../admin/admin.css', import.meta.url), 'utf8');
  // "fade" is the shared base (opacity only); the others add a movement or blur.
  for (const { value } of animationField.options.filter((o) => o.value !== 'none' && o.value !== 'fade')) {
    assert.ok(site.includes(`[data-motion="${value}"] [data-reveal]:not(.is-in)`), `site.css styles ${value}`);
    assert.ok(admin.includes(`.mp-stage[data-motion="${value}"]:not(.is-in)`), `admin.css previews ${value}`);
  }
  assert.match(site, /@media print[\s\S]*\[data-reveal\][\s\S]*opacity: 1 !important/, 'printing shows parts never scrolled to');
});

test('page transitions are on by default, respect reduced motion, and can be turned off', () => {
  const on = home({});
  assert.match(on, /@media \(prefers-reduced-motion: no-preference\)\{@view-transition\{navigation:auto\}/);
  assert.match(on, /\.masthead\{view-transition-name:masthead\}/);
  assert.doesNotMatch(home({ pageTransitions: false }), /view-transition/);
});
