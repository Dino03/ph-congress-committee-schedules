// scripts/fetch.js
// Fetch and parse committee schedules from:
// - House of Representatives (print-weekly page; week parameter supports 0 for current)
// - Senate of the Philippines (static XHTML weekly committee schedule)
// Outputs:
// - output/house.json
// - output/senate.json
//
// Requirements in package.json:
// {
//   "type": "module",
//   "scripts": { "fetch": "node scripts/fetch.js" },
//   "dependencies": {
//     "playwright": "^1.45.0",
//     "cheerio": "^1.0.0"
//   }
// }
//
// Optional (if Playwright browsers missing in CI):
//   npx playwright install --with-deps chromium

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG
const HOUSE_WEEK_DEFAULT = '0'; // 0 = current week on the House "print-weekly" endpoint
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
  // Safely strip HTML tags and normalize
  if (!html) return '';
  const $frag = cheerio.load(`<div>${html}</div>`);
  return norm($frag('div').text());
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

// HOUSE (Next.js client-rendered): fetch print-weekly and wait for rendered DOM
let house = [];
try {
  // Use the week value you saw in the select: 255 = Aug 10–16, 2025
  const WEEK = process.env.WEEK || '255';
  const houseURL = `https://www.congress.gov.ph/committees/committee-meetings/print-weekly/?week=${encodeURIComponent(WEEK)}`;
  const storageFile = path.join(outDir, 'house-storage-state.json');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  };
  try {
    const state = await fs.readFile(storageFile, 'utf-8');
    contextOpts.storageState = JSON.parse(state);
  } catch {}

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  await page.goto(houseURL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  // Let Cloudflare/Next settle and the app render
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  // Wait for the House-specific selectors that indicate the schedule rendered
  const selCandidates = [
    'div.p-2.text-lg.font-semibold',                           // day header like "12-Aug-2025 • Tuesday"
    'div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2'        // meeting card container
  ];
  let found = false;
  for (const sel of selCandidates) {
    try {
      await page.waitForSelector(sel, { timeout: 30000 });
      found = true;
      break;
    } catch {}
  }

  const content = await page.content();

  // Save session for future runs
  const storageState = await context.storageState();
  await fs.writeFile(storageFile, JSON.stringify(storageState), 'utf-8');
  await browser.close();

  if (found && content && content.includes('<html')) {
    house = await parseHouseWeeklyReact(content);
  } else {
    console.error('House: schedule did not render or no meetings for selected week.');
  }
} catch (e) {
  console.error('House fetch failed:', e.message);
}
await fs.writeFile(path.join(outDir, 'house.json'), JSON.stringify(house, null, 2));


// HOUSE parser for the React/Next structure you provided
async function parseHouseWeeklyReact(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Each day has a header like "12-Aug-2025 • Tuesday"
  const dayHeaders = $('div.p-2.text-lg.font-semibold');

  dayHeaders.each((_, el) => {
    const dayLabel = norm($(el).text()); // e.g., "12-Aug-2025 • Tuesday"

    // The meeting cards follow within the same parent block until next day header
    // We’ll traverse siblings until we hit another day header or a gap.
    // Simpler approach: for each card under the same container with class grid rounded border...
    const container = $(el).closest('.mb-5'); // day section wrapper (based on your snippet)
    const cards = container.find('div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2');

    cards.each((__, card) => {
      const $card = $(card);

      // Left column: committee name
      const committee = norm(
        $card.find('div.px-2.py-3.font-bold.text-blue-600').text()
      );

      // Right column: time (bold) and venue (next div)
      const time = parseClock(
        norm($card.find('div.grid.gap-1.px-2.py-3.text-blue-500 > div.font-bold').first().text())
      );

      const venue = norm(
        $card.find('div.grid.gap-1.px-2.py-3.text-blue-500 > div').eq(1).text()
      );

      // Agenda: the full-width div after the two columns, with italic heading and text in a small paragraph
      const subject = norm(
        $card.find('div.md\\:col-span-2.rounded.bg-light.p-2 div.whitespace-pre-wrap').text()
      );

      if (dayLabel && time && committee) {
        out.push({
          date: dayLabel,     // keep the label as given; can be parsed to ISO if needed
          time,               // normalized to "HH:MM AM/PM"
          committee,
          subject,
          venue,
          source: 'House Weekly Print'
        });
      }
    });
  });

  // Deduplicate by date|time|committee
  const seen = new Set();
  return out.filter(r => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}


// SENATE: parse static XHTML weekly schedule
// Structure: A header table with week/date and "AS OF", followed by per-day tables:
// Each day table (width="98%" class="grayborder") contains:
//   Row 0: "Tuesday, August 12" label (left td)
//   Row 1: column headers (Committee/Sub-Committee | Time & Venue | Agenda)
//   Rows 2+: data rows
async function parseSenateSchedule(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Identify each day's schedule block
  const dayTables = $('div[align="center"] > table[width="98%"].grayborder');
  dayTables.each((_, tbl) => {
    const $tbl = $(tbl);
    const trs = $tbl.find('tr');
    if (trs.length < 3) return;

    // Day header: first row, first cell, e.g., "Tuesday, August 12"
    const dayHeader = norm($(trs[0]).find('td').first().text());

    // Skip the header row at index 1; process data rows starting index 2
    for (let i = 2; i < trs.length; i++) {
      const tds = $(trs[i]).find('td');
      if (tds.length < 3) continue;

      const committeeCell = norm($(tds[0]).text());
      const timeVenueHtml = $(tds[1]).html() || '';
      const agendaHtml = $(tds[2]).html() || '';

      // Skip “No Committee Hearing/Meeting” rows
      if (/no committee hearing\/meeting/i.test(committeeCell)) continue;

      // Time & Venue: split on <br/>
      const timeVenueParts = timeVenueHtml
        .split(/<br\s*\/?>/i)
        .map((frag) => htmlToText(frag))
        .filter(Boolean);

      const time = timeVenueParts[0] ? parseClock(timeVenueParts[0]) : '';
      const venue = timeVenueParts.slice(1).join(' ').trim();

      // Agenda: join lines on <br/>
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

  // Deduplicate by date|time|committee
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

  // HOUSE: fetch and parse
  const weekParam = process.env.WEEK || HOUSE_WEEK_DEFAULT;
  const houseUrl = HOUSE_PRINT_URL(weekParam);
  const houseStorage = path.join(outDir, 'house-storage-state.json');

  let house = [];
  try {
    const html = await fetchWithBrowser(houseUrl, { storageFile: houseStorage });
    if (html && html.includes('<html')) {
      house = await parseHouseWeeklyPrint(html);
    } else {
      console.error('House: blocked or no HTML content.');
    }
  } catch (e) {
    console.error('House fetch failed:', e.message);
  }
  await fs.writeFile(path.join(outDir, 'house.json'), JSON.stringify(house, null, 2));

  // SENATE: fetch and parse
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
