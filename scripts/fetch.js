import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define output directory globally
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// CONFIG - Use main committee meetings page instead of print-weekly
const HOUSE_MEETINGS_URL = 'https://www.congress.gov.ph/committees/committee-meetings/';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// Utils
function norm(s) {
  if (typeof s !== 'string') {
    return '';
  }
  return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
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

// Browser fetcher
async function fetchWithBrowser(url, { storageFile, waitSelectors = [], extraWaitMs = 0 } = {}) {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
    ],
  });

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

  try {
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

    return { content, found };
  } finally {
    await browser.close();
  }
}

// Senate HTML fetcher
async function fetchSenateHTML(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(1500);
    const content = await page.content();
    return content;
  } finally {
    await browser.close();
  }
}

// House parser - for main committee meetings page structure
async function parseHouseCommitteeMeetings(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Look for the day sections in the main committee meetings page
  const daySections = $('div.mb-5');
  daySections.each((_, sec) => {
    const $sec = $(sec);
    
    // Find day header like "12-Aug-2025 • Tuesday"
    const dayLabel = norm($sec.find('div.p-2.text-lg.font-semibold').first().text());
    if (!dayLabel) return;

    // Find meeting cards within this day section
    const cards = $sec.find('div.grid.rounded.border.p-2.md\\:grid-cols-2.mb-2, div.hover\\:cursor-pointer');
    cards.each((__, card) => {
      const $card = $(card);

      // Committee name (usually in blue text)
      const committee = norm(
        $card.find('div.font-bold.text-blue-600, div.px-2.py-3.font-bold.text-blue-600').first().text()
      );

      // Time (usually bold in the right column)
      const time = parseClock(
        norm(
          $card
            .find('div.font-bold')
            .filter((i, el) => /^\d{1,2}:\d{2}/.test($(el).text()))
            .first()
            .text()
        )
      );

      // Venue (text after time in same section)
      const venue = norm(
        $card
          .find('div')
          .filter((i, el) => {
            const text = $(el).text();
            return text.includes('Hall') || text.includes('Bldg') || text.includes('Room');
          })
          .first()
          .text()
      );

      // Subject/Agenda (usually in an expanded section or separate div)
      const subject = norm(
        $card
          .find('div.whitespace-pre-wrap, div[class*="agenda"], div[class*="subject"]')
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
          source: 'House Committee Meetings',
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

// Senate parser (same as before)
async function parseSenateSchedule(html) {
  const $ = cheerio.load(html);
  const out = [];

  const dayTables = $('div[align="center"] > table[width="98%"].grayborder');
  dayTables.each((_, tbl) => {
    const $tbl = $(tbl);
    const trs = $tbl.find('tr');
    if (trs.length < 3) return;

    const dayHeader = norm($(trs[0]).find('td').first().text());

    for (let i = 2; i < trs
