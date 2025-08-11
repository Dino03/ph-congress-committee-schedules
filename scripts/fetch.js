// scripts/fetch.js
// Fetch and parse committee schedules from:
// - House of Representatives (print-weekly page; React/Next rendered, uses week param; 255 == Aug 10–16, 2025 in your snapshot)
// - Senate of the Philippines (static XHTML weekly committee schedule)
// Outputs:
// - output/house.json
// - output/senate.json
//
// package.json requirements:
// {
//   "name": "ph-committee-schedules",
//   "version": "1.0.0",
//   "type": "module",
//   "scripts": {
//     "fetch": "node scripts/fetch.js"
//   },
//   "dependencies": {
//     "cheerio": "^1.0.0",
//     "playwright": "^1.45.0"
//   }
// }
//
// If the runner lacks Chromium, install browsers first in your CI:
//   npx playwright install --with-deps chromium

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG
// For House, use the explicit week id you observed in the Select dropdown.
// Example from your DOM: 255 => Aug 10–16, 2025.
// You can override via env var WEEK in your workflow run form.
const HOUSE_WEEK_DEFAULT = '255';
const HOUSE_PRINT_URL = (week) =>
  `https://www.congress.gov.ph/committees/committee-meetings/print-weekly/?week=${encodeURIComponent(
    week || HOUSE_WEEK_DEFAULT
  )}`;

const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// Utility helpers
function norm(s) {
  return (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}
function parseClock(s) {
  if (!s) return '';
  // Normalize common variants like "10:00 a.m.", "10:00 am", "10:00 AM"
  return norm(s).replace(/\b(a\.m\.|p\.m\.)\b/gi, (m) =>
    m.toUpperCase().replace(/\./g, '')
  );
}
function htmlToText(html) {
  if (!html) return '';
  const $frag = cheerio.load(`<div>${html}</div>`);
  return norm($frag('div').text());
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

// Generic headless browser fetch (used for House due to client-side rendering and Cloudflare)
async function fetchWithBrowser(url, { storageFile, waitSelectors = [], extraWaitMs = 0 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let contextOpts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  };

  if (storageFile) {
    try {
      const state = await fs.readFile(storageFile, 'utf-8');
      contextOpts.storageState = JSON.parse(state);
    } catch {
      // ignore missing storage
    }
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  // Help pass interstitials and let scripts render
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  if (extraWaitMs > 0) {
    await page.waitForTimeout(extraWaitMs);
  }

  // Wait for any of the provided selectors to appear (if given)
  let found = waitSelectors.length === 0 ? true : false;
  for (const sel of waitSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 30000 });
      found = true;
      break;
    } catch {
      // try next selector
    }
  }

  const content = await page.content();

  if (storageFile) {
    const newState = await context.storageState();
    await fs.writeFile(storageFile, JSON.stringify(newState), 'utf-8');
  }

  await browser.close();
  return { content, found };
}

// Simple headless browser HTML fetch (Senate page is static XHTML, but this is robust)
async function fetchSenateHTML(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(1500);
  const content = await page.content();
  await browser.close();
  return content;
}

// HOUSE parser for the React/Next structure detected in your DOM
// Structure per day:
// - div.p-2.text-lg.font-semibold => day label "12-Aug-2025 • Tuesday"
// - One or more meeting cards: div.grid.rounded.border.p-2.md:grid-cols-2.mb-2
//   Left column: div.px-2.py-3.font-bold.text-blue-600 => Committee
//   Right column: grid with first child .font-bold => Time, next child => Venue
//   Agenda row: div.md:col-span-2.rounded.bg-light.p-2 containing .whitespace-pre-wrap => Agenda text
async function parseHouseWeeklyReact(html) {
  const $ = cheerio.load(html);
  const out = [];

  const daySections = $('div.mb-5'); // wrapper holding a day header and its cards
  daySections.each((_, sec) => {
    const $sec = $(sec);
    const dayLabel = norm($sec.find('div.p-2.text-lg.font-semibold').first().text());
    if (!dayLabel) return;

    // Find all meeting cards within this section
    const cards = $sec.find('div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2');
    cards.each((__, card) => {
      const $card = $(card);

      const committee = norm(
        $card.find('div.px-2.py-3.font-bold.text-blue-600').first().text()
      );

      const time = parseClock(
        norm(
          $card
            .find('div.grid.gap-1.px-2.py-3.text-blue-500 > div.font-bold')
            .first()
            .text()
        )
      );

      const venue = norm(
        $card
          .find('div.grid.gap-1.px-2.py-3.text-blue-500 > div')
          .eq(1)
          .text()
      );

      const subject = norm(
        $card
          .find('div.md\\:col-span-2.rounded.bg-light.p-2 div.whitespace-pre-wrap')
          .first()
          .text()
      );

      if (dayLabel && time && committee) {
        out.push({
          date: dayLabel, // e.g., "12-Aug-2025 • Tuesday"
          time,
          committee,
          subject,
          venue,
          source: 'House Weekly Print',
        });
      }
    });
  });

  // Deduplicate by date|time|committee
  const seen = new Set();
  return out.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// SENATE parser for XHTML structure you provided
// Each day is a table[width="98%"].grayborder within div[align="center"]
// Row 0: "Tuesday, August 12"
// Row 1: headers (Committee/Sub-Committee | Time & Venue | Agenda)
// Rows 2+: data rows
async function parseSenateSchedule(html) {
  const $ = cheerio.load(html);
  const out = [];

  const dayTables = $('div[align="center"] > table[width="98%"].grayborder');
  dayTables.each((_, tbl) => {
    const $tbl = $(tbl);
    const trs = $tbl.find('tr');
    if (trs.length < 3) return;

    const dayHeader = norm($(trs[0]).find('td').first().text());

    for (let i = 2; i < trs.length; i++) {
      const tds = $(trs[i]).find('td');
      if (tds.length < 3) continue;

      const committeeCell = norm($(tds[0]).text());
      if (/no committee hearing\/meeting/i.test(committeeCell)) continue;

      const timeVenueHtml = $(tds[1]).html() || '';
      const agendaHtml = $(tds[2]).html() || '';

      const timeVenueParts = timeVenueHtml
        .split(/<br\s*\/?>/i)
        .map((frag) => htmlToText(frag))
        .filter(Boolean);

      const time = timeVenueParts[0] ? parseClock(timeVenueParts[0]) : '';
      const venue = timeVenueParts.slice(1).join(' ').trim();

      const agendaParts = agendaHtml
        .split(/<br\s*\/?>/i)
        .map((frag) => htmlToText(frag))
        .filter(Boolean);

      const subject = agendaParts.join('; ');

      if (dayHeader && time && committeeCell) {
        out.push({
          date: dayHeader,
          time,
          committee: committeeCell,
          subject,
          venue,
          source: 'Senate Weekly Schedule',
        });
      }
    }
  });

  const seen = new Set();
  return out.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  const outDir = path.join(__dirname, '..', 'output');
  await ensureDir(outDir);

  // HOUSE
  const weekParam = process.env.WEEK || HOUSE_WEEK_DEFAULT;
  const houseUrl = HOUSE_PRINT_URL(weekParam);
  const houseStorage = path.join(outDir, 'house-storage-state.json');

  let house = [];
  try {
    const { content, found } = await fetchWithBrowser(houseUrl, {
      storageFile: houseStorage,
      waitSelectors: [
        'div.p-2.text-lg.font-semibold',                    // day header like "12-Aug-2025 • Tuesday"
        'div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2' // meeting card container
      ],
      extraWaitMs: 3000,
    });

    // Optional: save raw HTML for debugging selector mismatches
    // await fs.writeFile(path.join(outDir, 'house.html'), content || '', 'utf-8');

    if (found && content && content.includes('<html')) {
      house = await parseHouseWeeklyReact(content);
    } else {
      console.error('House: schedule did not render or no meetings for selected week.');
    }
  } catch (e) {
    console.error('House fetch failed:', e.message);
  }
  await fs.writeFile(path.join(outDir, 'house.json'), JSON.stringify(house, null, 2));

  // SENATE
  let senate = [];
  try {
    const html = await fetchSenateHTML(SENATE_SCHED_URL);
    if (html && html.includes('<html')) {
      senate = await parseSenateSchedule(html);
    } else {
      console.error('Senate schedule: blocked or no HTML content.');
    }
  } catch (e) {
    console.error('Senate fetch failed:', e.message);
  }
  await fs.writeFile(path.join(outDir, 'senate.json'), JSON.stringify(senate, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
