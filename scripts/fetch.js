// scripts/fetch.js
// Fetch committee schedules from:
// - House API (direct POST; avoids Turnstile by calling JSON endpoint)
// - Senate weekly XHTML page (static HTML)
// Outputs: output/house.json, output/senate.json, and output/house_api_debug.json (for inspection)
//
// package.json (example):
// {
//   "name": "ph-committee-schedules",
//   "version": "1.0.0",
//   "type": "module",
//   "scripts": { "fetch": "node scripts/fetch.js" },
//   "dependencies": {
//     "cheerio": "^1.0.0",
//     "playwright": "^1.45.0"
//   }
// }
//
// In CI, ensure Chromium is available:
//   npx playwright install --with-deps chromium

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '..', 'output');

// Endpoints
const HOUSE_API = 'https://api.v2.congress.hrep.online/hrep/api-v1/committee-schedule/weekly-schedule';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// --------------- Utils ---------------
function norm(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}
function parseClock(s) {
  if (!s) return '';
  // Normalize e.g., "10:00 a.m." -> "10:00 AM"
  return norm(s).replace(/\b(a\.m\.|p\.m\.)\b/gi, (m) => m.toUpperCase().replace(/\./g, ''));
}
function htmlToText(html) {
  if (!html) return '';
  const $frag = cheerio.load(`<div>${html}</div>`);
  return norm($frag('div').text());
}

// --------------- HTTP helpers (via Playwright request) ---------------
async function postJson(url, payload = {}, headers = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const resp = await page.request.post(url, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      data: payload
    });
    const status = resp.status();
    const text = await resp.text();
    if (status < 200 || status >= 300) {
      // Surface response headers/body snippet for easier debugging in CI logs
      const hdrs = Object.fromEntries(resp.headers().entries());
      throw new Error(`HTTP ${status} headers=${JSON.stringify(hdrs)} body=${text.slice(0, 400)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response: ${text.slice(0, 400)}`);
    }
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

// --------------- Parsers ---------------

// Senate XHTML weekly schedule parser
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

// --------------- Main ---------------
async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // -------- House via public API (header-hardened) --------
  let house = [];
  try {
    // If the API later requires a specific payload (e.g., { week: 255 } or a date range),
    // update this object and consider reading WEEK from process.env.
    const payload = {};

    // Headers observed to work from a browser; expanded with realistic UA and fetch hints.
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: 'https://www.congress.gov.ph/',
      Origin: 'https://www.congress.gov.ph',
      'x-hrep-website-backend': 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty'
    };

    const apiResp = await postJson(HOUSE_API, payload, headers);

    // Save raw API response for inspection and field mapping
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'house_api_debug.json'),
      JSON.stringify(apiResp, null, 2),
      'utf-8'
    );

    // Expected envelope: { status, success, data, message }
    const rows = Array.isArray(apiResp?.data) ? apiResp.data : [];

    // Map conservatively; adjust keys after inspecting house_api_debug.json
    house = rows
      .map((it) => {
        const date = norm(it.date || it.day || it.scheduleDate || '');
        const time = parseClock(norm(it.time || it.startTime || ''));
        const committee = norm(it.committee || it.committeeName || '');
        const subject = norm(it.agenda || it.subject || it.details || '');
        const venue = norm(it.venue || it.location || '');
        if (date && time && committee) {
          return {
            date,
            time,
            committee,
            subject,
            venue,
            source: 'House API'
          };
        }
        return null;
      })
      .filter(Boolean);
  } catch (e) {
    console.error('House API fetch failed:', e.message);
  }
  await fs.writeFile(path.join(OUTPUT_DIR, 'house.json'), JSON.stringify(house, null, 2));

  // -------- Senate (XHTML) --------
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
