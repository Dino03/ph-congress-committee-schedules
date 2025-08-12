// scripts/fetch.js
// Fetch committee schedules from:
// - House API (direct POST to list endpoint with captured headers/payload)
// - Senate weekly XHTML page (static HTML)
// Outputs: output/house.json, output/senate.json, plus output/house_api_debug.json (for inspection)
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

// Endpoints (House "list" endpoint confirmed working with POST and headers)
const HOUSE_API = 'https://api.v2.congress.hrep.online/hrep/api-v1/committee-schedule/list';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// --------------- Utils ---------------
function norm(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
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

  // Deduplicate by date|time|committee
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --------------- Main ---------------
async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // -------- House via public API (list endpoint) --------
  // Confirmed headers and payload:
  // Request payload: {"page":0,"limit":150,"congress":"19","filter":""}
  // Headers include Referer, Origin, x-hrep-website-backend, UA, etc.
  let house = [];
  try {
    const payload = {
      page: 0,
      limit: 150,
      congress: '19',
      filter: ''
    };

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: 'https://www.congress.gov.ph/',
      Origin: 'https://www.congress.gov.ph',
      'x-hrep-website-backend': 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
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

    // Envelope per sample: { status, success, data: { pageCount, count, rows: [...] } }
    const rows = Array.isArray(apiResp?.data?.rows) ? apiResp.data.rows : [];

    // Optional HTML entity decode for common cases (e.g., &amp;)
    const decode = (s) => norm(s).replaceAll('&amp;', '&');

    const houseRows = rows
      .map((it) => {
        // Fields from sample rows:
        // id, date (YYYY-MM-DD), time ("01:30 PM"), venue, agenda, comm_name (committee),
        // datetime ("2025-08-12T13:30"), flags: published, cancelled, etc.
        const date = norm(it.date || '');
        const time = parseClock(norm(it.time || ''));
        const committee = norm(it.comm_name || '');
        const subject = decode(it.agenda || '');
        const venue = decode(it.venue || '');

        // Optional: skip cancelled items
        // if (it.cancelled) return null;

        if (date && time && committee) {
          return {
            date,
            time,
            committee,
            subject,
            venue,
            source: 'House API (list)'
          };
        }
        return null;
      })
      .filter(Boolean);

    // De-duplicate by date|time|committee
    const seen = new Set();
    house = houseRows.filter((r) => {
      const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
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
