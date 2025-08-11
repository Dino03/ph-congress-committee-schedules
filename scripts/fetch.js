// scripts/fetch.js
// Fetch and parse committee schedules from:
// - House (Next.js print-weekly page; week param; 255 == Aug 10–16, 2025 per your snapshot)
// - Senate (static XHTML weekly schedule)
// Outputs: output/house.json, output/senate.json

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG
const HOUSE_WEEK_DEFAULT = '255';
const HOUSE_PRINT_URL = (week) =>
  `https://www.congress.gov.ph/committees/committee-meetings/print-weekly/?week=${encodeURIComponent(
    week || HOUSE_WEEK_DEFAULT
  )}`;
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// Utils
function norm(s) {
  return (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}
function parseClock(s) {
  if (!s) return '';
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


// Browser fetcher (for House)
async function fetchWithBrowser(url, { storageFile, waitSelectors = [], extraWaitMs = 0 } = {}) {
  // Fake more-human context settings
  let contextOpts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  };

  if (storageFile) {
    try {
      const state = await fs.readFile(storageFile, 'utf-8');
      contextOpts.storageState = JSON.parse(state);
    } catch {
      // first run: no storage
    }
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  if (extraWaitMs > 0) {
    await page.waitForTimeout(extraWaitMs);
  }

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

// Senate HTML fetcher
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

// House parser (React/Next structure per your DOM)
async function parseHouseWeeklyReact(html) {
  const $ = cheerio.load(html);
  const out = [];

  const daySections = $('div.mb-5');
  daySections.each((_, sec) => {
    const $sec = $(sec);
    const dayLabel = norm($sec.find('div.p-2.text-lg.font-semibold').first().text());
    if (!dayLabel) return;

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
          date: dayLabel,
          time,
          committee,
          subject,
          venue,
          source: 'House Weekly Print',
        });
      }
    });
  });

  const seen = new Set();
  return out.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Senate parser (XHTML)
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

      const committeeCell = norm($(tds).text());
      if (/no committee hearing\/meeting/i.test(committeeCell)) continue;

      const timeVenueHtml = $(tds[1]).html() || '';
      const agendaHtml = $(tds[2]).html() || '';

      const timeVenueParts = timeVenueHtml
        .split(/<br\s*\/?>/i)
        .map((frag) => htmlToText(frag))
        .filter(Boolean);

      const time = timeVenueParts ? parseClock(timeVenueParts) : '';
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
  // IMPORTANT: define outDir first, before any references
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
        'div.p-2.text-lg.font-semibold',
        'div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2',
      ],
      extraWaitMs: 3000,
    });

    // Optional debug: uncomment to inspect HTML the runner fetched
    await fs.writeFile(path.join(outDir, 'house.html'), content || '', 'utf-8');

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
