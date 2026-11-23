// Génère les icônes PNG à partir de public/icons/favicon.svg (nécessite Playwright/Chromium).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/favicon.svg', import.meta.url), 'utf8');
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(size, name, { pad = 0, bg = 'transparent', square = false, mono = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  let inner = svg;
  if (square) inner = inner.replace('rx="112"', 'rx="0"');
  if (mono) inner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="206" cy="268" r="118" fill="none" stroke="#fff" stroke-width="40"/><circle cx="318" cy="236" r="118" fill="none" stroke="#fff" stroke-width="40"/></svg>`;
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${inner.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: out(name), omitBackground: bg === 'transparent' });
}
await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'maskable-512.png', { pad: 52, bg: '#551c25', square: true });
await shot(180, 'apple-touch-icon.png', { bg: '#551c25', square: true });
await shot(96, 'badge-96.png', { mono: true });
await browser.close();
console.log('icônes générées');
