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

// Headless browser fetch (for House print-weekly which is behind Next.js/Cloudflare)
async function fetchWithBrowser(url, { storageFile } = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let contextOpts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  };

  // Load cookies/storage if provided
  if (storageFile) {
    try {
      const state = await fs.readFile(storageFile, 'utf-8');
      contextOpts.storageState = JSON.parse(state);
    } catch {
      // ignore missing
    }
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  // Allow interstitials to clear, scripts to load
  await page.waitForTimeout(6000);

  // Wait for a schedule signal (table or known heading), but don't fail if not present
  await page
    .waitForSelector('table, text=Committee Meetings - Weekly Schedule', {
      timeout: 20000,
    })
    .catch(() => {});

  const content = await page.content();

  // Persist cookies/storage state for subsequent runs
  if (storageFile) {
    const newState = await context.storageState();
    await fs.writeFile(storageFile, JSON.stringify(newState), 'utf-8');
  }

  await browser.close();
  return content;
}

// Direct HTTP via Playwright’s browser (Senate is static XHTML; headless browser fetch is robust enough)
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
  // Give time for any CDN/banner content to load
  await page.waitForTimeout(2000);
  const content = await page.content();
  await browser.close();
  return content;
}

// HOUSE: parse weekly print page (table with columns like Date | Time | Committee | Subject | Venue)
async function parseHouseWeeklyPrint(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Parse any table that resembles a schedule table (has Date/Time/Committee columns or enough columns)
  $('table').each((_, table) => {
    const headers = $(table)
      .find('th')
      .map((__, th) => norm($(th).text()).toLowerCase())
      .get();
    const headerLine = headers.join('|');
    const looksLikeSchedule =
      headerLine.includes('date') &&
      headerLine.includes('time') &&
      headerLine.includes('committee');

    if (looksLikeSchedule || headers.length === 0) {
      $(table)
        .find('tr')
        .each((__, tr) => {
          const tds = $(tr).find('td');
          if (tds.length >= 3) {
            const date = norm($(tds[0]).text());
            const time = parseClock(norm($(tds[1]).text()));
            const committee = norm($(tds[2]).text());
            const subject = tds[3] ? norm($(tds[3]).text()) : '';
            const venue = tds[4] ? norm($(tds[4]).text()) : '';

            if (date && time && committee) {
              out.push({
                date,
                time,
                committee,
                subject,
                venue,
                source: 'House Weekly Print',
              });
            }
          }
        });
    }
  });

  // Deduplicate rows by date|time|committee
  const seen = new Set();
  return out.filter((r) => {
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
