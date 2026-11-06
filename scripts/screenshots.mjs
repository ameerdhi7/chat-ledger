// Renders the dashboard with made-up demo data (three providers) and saves docs/*.png.
//   npm run screenshots
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXT = path.join(ROOT, 'extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chatledger-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];

// Seeded random so the screenshots are the same every run.
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shops = {
  Tabadul: ['Happy Home Market', 'Dose Cafe Karada', 'Al Rayan Fuel Station', 'Ibn Sina Pharmacy', 'ANTHROPIC', 'Burger Joint'],
  'Qi Card': ['Asiacell Communications', 'Carrefour Baghdad', 'Pizza Hut Mansour', 'Zain Iraq'],
  ZainCash: ['Careem', 'Talabat', 'Ali Hassan', 'Mobile Top-up'],
};
const tx = [], bal = { Tabadul: 6_000_000, 'Qi Card': 900_000, ZainCash: 150_000 };
const now = new Date();
for (let d = 75; d >= 0; d--) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
  const date = day.toLocaleDateString('en-CA');
  for (const p of Object.keys(shops)) {
    if (d % 14 === 3 && p !== 'Tabadul') {
      const amount = p === 'ZainCash' ? 100_000 : 400_000; bal[p] += amount;
      tx.push({ date, time: '09:00', provider: p, type: 'credit', amount, currency: 'IQD', balance: bal[p], raw: 'Salary', merchant: 'Salary', city: '' });
    }
    const n = Math.floor(rnd() * (p === 'Tabadul' ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const amount = Math.round((5 + rnd() * (p === 'Tabadul' ? 60 : 30)) * 250) * 4;
      bal[p] = Math.max(0, bal[p] - amount);
      const m = pick(shops[p]);
      tx.push({ date, time: `${String(10 + i * 3).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`,
        provider: p, type: 'debit', amount, currency: 'IQD', balance: p === 'ZainCash' ? null : bal[p], raw: m, merchant: m, city: 'Baghdad' });
    }
  }
}
tx.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
await sw.evaluate((tx) => chrome.storage.local.set({
  tx, lock: { off: true }, shield: false, lastSync: Date.now(), wa: { state: 'ok', at: Date.now() + 864e5 },
  sources: [{ chat: 'Tabadul', label: 'Tabadul' }, { chat: 'Qi Card', label: 'Qi Card' }, { chat: 'ZainCash', label: 'ZainCash' }],
}), tx);

const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/dashboard.html`);
await page.waitForSelector('.kpis');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
await page.screenshot({ path: path.join(ROOT, 'docs/dashboard.png') });
await page.locator('.card', { hasText: 'By provider' }).scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(ROOT, 'docs/providers.png') });
await page.click('#settings');
await page.screenshot({ path: path.join(ROOT, 'docs/chats.png') });
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : `✓ ${tx.length} demo transactions → docs/`);
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
