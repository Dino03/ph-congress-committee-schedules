// scripts/fetch.js
// Fetch and parse committee schedules from:
// - House main page (https://www.congress.gov.ph/committees/committee-meetings/)
// - Senate weekly page (https://web.senate.gov.ph/committee/schedwk.asp)
// Outputs: output/house.json, output/senate.json, and debug output/house.html (for inspection)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// URLs
const HOUSE_MEETINGS_URL = 'https://www.congress.gov.ph/committees/committee-meetings/';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// Utils
function norm(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}
function parseClock(s) {
  if (!s) return '';
  return norm(s).replace(/\b(a\.m\.|p\.m\.)\b/gi, (m) => m.toUpperCase().replace(/\./g, ''));
}
function htmlToText(html) {
  if (!html) return '';
  const $frag = cheerio.load(`<div>${html}</div>`);
  return norm($frag('div').text());
}

// Fetchers
async function fetchWithBrowser(url, { storageFile, waitSelectors = [], extraWaitMs = 0 } = {}) {
  const browser = await chromium.launch({
    headless: false, // try visible-like profile; adjust to true if needed
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  let contextOpts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true
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

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);

    let found = waitSelectors.length === 0;
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

    return { content, found };
  } finally {
    await browser.close();
  }
}

async function fetchSenateHTML(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(1500);
    return await page.content();
  } finally {
    await browser.close();
  }
}

// Parsers
async function parseHouseCommitteeMeetings(html) {
  const $ = cheerio.load(html);
  const out = [];

  // A day section usually has a header like "12-Aug-2025 • Tuesday" followed by meeting cards
  const daySections = $('div.mb-5');

  daySections.each((_, sec) => {
    const $sec = $(sec);

    // Day header
    const dayLabel = norm($sec.find('div.p-2.text-lg.font-semibold').first().text());
    if (!dayLabel) return;

    // Meeting cards
    const cards = $sec.find(
      'div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2, div.hover\\:cursor-pointer'
    );

    cards.each((__, card) => {
      const $card = $(card);

      // Committee name
      const committee = norm(
        $card.find('div.px-2.py-3.font-bold.text-blue-600, div.font-bold.text-blue-600').first().text()
      );

      // Time (bold, usually looks like 01:30 PM)
      const time = parseClock(
        norm(
          $card
            .find('div.grid.gap-1.px-2.py-3.text-blue-500 > div.font-bold, div.font-bold')
            .filter((i, el) => /^\d{1,2}:\d{2}/.test($(el).text()))
            .first()
            .text()
        )
      );

      // Venue (look for Hall/Bldg/Room/Committee text)
      const venue = norm(
        $card
          .find('div')
          .filter((i, el) => {
            const t = $(el).text();
            return /Hall|Bldg|Building|Room|Committee/i.test(t);
          })
          .eq(0)
          .text()
      );

      // Subject/Agenda
      const subject = norm(
        $card.find('div.whitespace-pre-wrap, div[class*="agenda"], div[class*="subject"]').first().text()
      );

      if (dayLabel && time && committee) {
        out.push({
          date: dayLabel,
          time,
          committee,
          subject,
          venue,
          source: 'House Committee Meetings'
        });
      }
    });
  });

  // Deduplicate
  const seen = new Set();
  return out.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

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

      const timeVenueParts = timeVenueHtml.split(/<br\s*\/?>/i).map((frag) => htmlToText(frag)).filter(Boolean);
      const time = timeVenueParts[0] ? parseClock(timeVenueParts[0]) : '';
      const venue = timeVenueParts.slice(1).join(' ').trim();

      const agendaParts = agendaHtml.split(/<br\s*\/?>/i).map((frag) => htmlToText(frag)).filter(Boolean);
      const subject = agendaParts.join('; ');

      if (dayHeader && time && committeeCell) {
        out.push({
          date: dayHeader,
          time,
          committee: committeeCell,
          subject,
          venue,
          source: 'Senate Weekly Schedule'
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

// Main
async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // House
  const houseStorage = path.join(OUTPUT_DIR, 'house-storage-state.json');
  let house = [];
  try {
    const { content, found } = await fetchWithBrowser(HOUSE_MEETINGS_URL, {
      storageFile: houseStorage,
      waitSelectors: [
        'div.p-2.text-lg.font-semibold',  // day header
        'div.grid.rounded.border',         // meeting card container
        'text=Committee Meetings - Weekly Schedule'
      ],
      extraWaitMs: 3000
    });

    // Save HTML for debugging/inspection
    await fs.writeFile(path.join(OUTPUT_DIR, 'house.html'), content || '', 'utf-8');

    if (found && content && content.includes('<html')) {
      house = await parseHouseCommitteeMeetings(content);
    } else {
      console.error('House: schedule did not render or no meetings for current week.');
    }
  } catch (e) {
    console.error('House fetch failed:', e.message);
  }
  await fs.writeFile(path.join(OUTPUT_DIR, 'house.json'), JSON.stringify(house, null, 2));

  // Senate
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
  await fs.writeFile(path.join(OUTPUT_DIR, 'senate.json'), JSON.stringify(senate, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
