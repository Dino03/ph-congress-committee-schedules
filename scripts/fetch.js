// scripts/fetch.js
// Fetch committee schedules from:
// - House API (POST /hrep/api-v1/committee-schedule/list with exact browser headers + comprehensive debug)
// - Senate weekly XHTML page (static HTML)
// Outputs:
//   - output/house.json
//   - output/senate.json
//   - output/house_api_debug.json (raw API envelope when available)
//   - output/debug.log (detailed diagnostics for debugging)
//
// In CI, ensure Chromium is available:
//   npx playwright install --with-deps chromium
//
// Node 20+ required (ESM)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

console.log('[start] fetch.js launched');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DEBUG_LOG = path.join(OUTPUT_DIR, 'debug.log');

console.log('[paths]', { OUTPUT_DIR, DEBUG_LOG });

// Early initialization
try {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(DEBUG_LOG, '[init]\n', 'utf-8');
  console.log('[init] output dir ready');
} catch (e) {
  console.error('[init-fail] cannot create output dir/log', e?.stack || e);
}

// Endpoints
const HOUSE_API = 'https://api.v2.congress.hrep.online/hrep/api-v1/committee-schedule/list';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// ---------------- Debug helpers ----------------
async function appendDebug(line) {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    await fs.appendFile(DEBUG_LOG, `[${stamp}] ${line}\n`, 'utf-8');
  } catch (e) {
    console.error('[appendDebug-fail]', e?.message || e);
  }
}

// ---------------- Utils ----------------
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

// ---------------- HTTP helpers (Playwright request with hardened debug) ----------------
async function postJson(url, payload = {}, headers = {}) {
  console.log('[postJson] starting browser launch');
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    console.log('[postJson] browser launch successful');
  } catch (e) {
    console.error('[postJson] launch-failed', e?.stack || e);
    try { 
      await appendDebug(`[postJson] launch-failed: ${e?.message || e}`); 
    } catch {}
    throw e;
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const startedAt = Date.now();
    console.log(`[postJson] sending POST to ${url}`);
    try {
      await appendDebug(`Sending POST to ${url}`);
    } catch {}
    
    const resp = await page.request.post(url, {
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      data: payload
    });
    const ms = Date.now() - startedAt;

    const status = resp.status();
    const text = await resp.text();
    console.log(`[postJson] response: status=${status}, contentLength=${text.length}, duration=${ms}ms`);
    try {
      await appendDebug(`POST response: status=${status}, contentLength=${text.length}, duration=${ms}ms`);
    } catch {}

    if (status < 200 || status >= 300) {
      const hdrs = resp.headers();
      console.error(`[postJson] HTTP error ${status}`);
      try {
        await appendDebug(
          `House API POST ${url} status=${status} durationMs=${ms} headers=${JSON.stringify(
            hdrs
          )} bodyHead=${text.slice(0, 400)}`
        );
      } catch {}
      throw new Error(`HTTP ${status}`);
    }

    try {
      const json = JSON.parse(text);
      console.log(`[postJson] JSON parse successful, keys=${Object.keys(json).join(',')}`);
      try {
        await appendDebug(
          `House API POST ${url} status=${status} durationMs=${ms} keys=${Object.keys(json).join(',')} dataType=${typeof json.data}`
        );
      } catch {}
      return json;
    } catch {
      console.error('[postJson] JSON parse failed');
      try {
        await appendDebug(
          `House API POST ${url} status=${status} durationMs=${ms} nonJSONHead=${text.slice(0, 400)}`
        );
      } catch {}
      throw new Error('Non-JSON response');
    }
  } finally {
    await browser.close();
  }
}

async function fetchSenateHTML(url) {
  console.log('[fetchSenateHTML] starting browser launch');
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
    const startedAt = Date.now();
    console.log(`[fetchSenateHTML] navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    const ms = Date.now() - startedAt;
    console.log(`[fetchSenateHTML] loaded, duration=${ms}ms, htmlLen=${html?.length || 0}`);
    try {
      await appendDebug(`Senate GET ${url} loaded durationMs=${ms} htmlLen=${html?.length || 0}`);
    } catch {}
    return html;
  } finally {
    await browser.close();
  }
}

// ---------------- Parsers ----------------
async function parseSenateSchedule(html) {
  console.log('[parseSenateSchedule] starting');
  const $ = cheerio.load(html);
  const out = [];

  const dayTables = $('div[align="center"] > table[width="98%"].grayborder');
  console.log(`[parseSenateSchedule] found ${dayTables.length} day tables`);

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
  const deduplicated = out.filter((r) => {
    const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`[parseSenateSchedule] parsed ${deduplicated.length} items`);
  return deduplicated;
}

// ---------------- Main ----------------
async function main() {
  console.log('[main] starting');
  try { 
    await appendDebug('[main] entered'); 
  } catch {}

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(DEBUG_LOG, '', 'utf-8'); // reset debug log each run

  // -------- House via public API (exact browser headers with comprehensive debug) --------
  console.log('[house] request starting');
  try {
    await appendDebug('[house] request starting');
  } catch {}

  let house = [];
  try {
    // Captured working payload
    const payload = { page: 0, limit: 150, congress: '19', filter: '' };
    console.log(`[house] payload: ${JSON.stringify(payload)}`);
    try {
      await appendDebug(`House payload: ${JSON.stringify(payload)}`);
    } catch {}

    // Exact headers from successful browser request
  const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  Referer: "https://www.congress.gov.ph/",
  "Content-Type": "application/json",
  "x-hrep-website-backend": "cc8bd00d-9b88-4fee-aafe-311c574fcdc1",
  Origin: "https://www.congress.gov.ph/",
  "Sec-GPC": "1",
  Connection: "keep-alive",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  TE: "trailers"
};
    console.log(`[house] headers count: ${Object.keys(headers).length}`);
    try {
      await appendDebug(`House headers count: ${Object.keys(headers).length}`);
    } catch {}

    // Simple backoff retry for transient errors
    const delays = [500, 1500, 3500];
    let apiResp = null;
    let lastErr = null;

    for (let i = 0; i < delays.length; i++) {
      try {
        console.log(`[house] attempt ${i + 1} starting...`);
        try {
          await appendDebug(`House attempt ${i + 1} starting...`);
        } catch {}
        apiResp = await postJson(HOUSE_API, payload, headers);
        console.log(`[house] attempt ${i + 1} succeeded`);
        try {
          await appendDebug(`House attempt ${i + 1} succeeded`);
        } catch {}
        break;
      } catch (e) {
        lastErr = e;
        console.error(`[house] attempt ${i + 1} failed: ${e?.message || e}`);
        try {
          await appendDebug(`House attempt ${i + 1} failed: ${e?.message || e}`);
        } catch {}
        if (i < delays.length - 1) {
          console.log(`[house] retrying after ${delays[i]}ms...`);
          try {
            await appendDebug(`House retrying after ${delays[i]}ms...`);
          } catch {}
          await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
    }

    if (!apiResp) {
      console.error('[house] API failed after all retries');
      try {
        await appendDebug('House API failed after all retries.');
      } catch {}
      throw lastErr || new Error('House API failed after retries');
    }

    // Log response structure
    console.log(`[house] API response keys: ${Object.keys(apiResp).join(',')}`);
    console.log(`[house] API status: ${apiResp.status}, success: ${apiResp.success}`);
    try {
      await appendDebug(`House API response keys: ${Object.keys(apiResp).join(',')}`);
      await appendDebug(`House API status: ${apiResp.status}, success: ${apiResp.success}`);
    } catch {}
    
    if (apiResp.data) {
      console.log(`[house] API data keys: ${Object.keys(apiResp.data).join(',')}`);
      console.log(`[house] API pageCount: ${apiResp.data.pageCount}, count: ${apiResp.data.count}`);
      try {
        await appendDebug(`House API data keys: ${Object.keys(apiResp.data).join(',')}`);
        await appendDebug(`House API pageCount: ${apiResp.data.pageCount}, count: ${apiResp.data.count}`);
      } catch {}
    }

    // Save raw API response envelope for inspection
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'house_api_debug.json'),
      JSON.stringify(apiResp, null, 2),
      'utf-8'
    );

    // Parse response
    const rows = Array.isArray(apiResp?.data?.rows) ? apiResp.data.rows : [];
    console.log(`[house] raw rows count: ${rows.length}`);
    try {
      await appendDebug(`House raw rows count: ${rows.length}`);
    } catch {}
    
    if (rows.length > 0) {
      console.log(`[house] first row keys: ${Object.keys(rows[0]).join(',')}`);
      console.log(`[house] first row sample: date="${rows[0].date}", time="${rows[0].time}", comm_name="${rows[0].comm_name}", cancelled=${rows[0].cancelled}`);
      try {
        await appendDebug(`House first row keys: ${Object.keys(rows[0]).join(',')}`);
        await appendDebug(`House first row sample: date="${rows[0].date}", time="${rows[0].time}", comm_name="${rows[0].comm_name}", cancelled=${rows[0].cancelled}`);
      } catch {}
    }

    // Decode HTML entities
    const decode = (s) =>
      norm(s)
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");

    // Map and filter with detailed logging
    let validCount = 0;
    let invalidCount = 0;
    let cancelledCount = 0;

    const mapped = [];
    for (let index = 0; index < rows.length; index++) {
      const it = rows[index];
      
      // Log first few items for debugging
      if (index < 3) {
        console.log(`[house] row ${index}: date="${it.date}", time="${it.time}", comm_name="${it.comm_name}", cancelled=${it.cancelled}`);
        try {
          await appendDebug(`House row ${index}: date="${it.date}", time="${it.time}", comm_name="${it.comm_name}", cancelled=${it.cancelled}`);
        } catch {}
      }

      const date = norm(it.date || '');
      const time = parseClock(norm(it.time || ''));
      const committee = norm(it.comm_name || '');
      const subject = decode(it.agenda || '');
      const venue = decode(it.venue || '');

      // Count cancelled items
      if (it.cancelled) {
        cancelledCount++;
      }

      // Check validation
      if (!date && index < 5) {
        console.log(`[house] row ${index}: missing date`);
        try { await appendDebug(`House row ${index}: missing date`); } catch {}
      }
      if (!time && index < 5) {
        console.log(`[house] row ${index}: missing time`);
        try { await appendDebug(`House row ${index}: missing time`); } catch {}
      }
      if (!committee && index < 5) {
        console.log(`[house] row ${index}: missing committee`);
        try { await appendDebug(`House row ${index}: missing committee`); } catch {}
      }

      if (date && time && committee) {
        validCount++;
        mapped.push({ date, time, committee, subject, venue, source: 'House API (list)' });
      } else {
        invalidCount++;
      }
    }

    console.log(`[house] mapping: ${validCount} valid, ${invalidCount} invalid, ${cancelledCount} cancelled`);
    try {
      await appendDebug(`House mapping: ${validCount} valid, ${invalidCount} invalid, ${cancelledCount} cancelled`);
    } catch {}

    // De-duplicate
    const seen = new Set();
    let dupCount = 0;
    house = mapped.filter((r) => {
      const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
      if (seen.has(k)) {
        dupCount++;
        return false;
      }
      seen.add(k);
      return true;
    });

    console.log(`[house] deduplication: ${dupCount} duplicates removed, ${house.length} final count`);
    try {
      await appendDebug(`House deduplication: ${dupCount} duplicates removed, ${house.length} final count`);
    } catch {}

    if (house.length > 0) {
      console.log(`[house] final first item: ${JSON.stringify(house[0])}`);
      console.log(`[house] date range: ${house[0].date} to ${house[house.length-1].date}`);
      try {
        await appendDebug(`House final first item: ${JSON.stringify(house[0])}`);
        await appendDebug(`House date range: ${house[0].date} to ${house[house.length-1].date}`);
      } catch {}
    } else {
      console.log('[house] produced 0 rows after mapping/dedup');
      try {
        await appendDebug('House produced 0 rows after mapping/dedup.');
      } catch {}
    }

  } catch (e) {
    console.error(`[house] error: ${e?.message || e}`);
    try {
      await appendDebug(`House error: ${e?.message || e}`);
    } catch {}
    console.error('House API fetch failed:', e.message || e);
  }

  try {
    await fs.writeFile(path.join(OUTPUT_DIR, 'house.json'), JSON.stringify(house, null, 2));
    console.log(`[house] JSON written: ${house.length} items`);
    try {
      await appendDebug(`House JSON written: ${house.length} items`);
    } catch {}
  } catch (e) {
    console.error(`[house] write error: ${e?.message || e}`);
    try {
      await appendDebug(`House write error: ${e?.message || e}`);
    } catch {}
  }

  // -------- Senate (XHTML) --------
  console.log('[senate] request starting');
  try {
    await appendDebug('[senate] request starting');
  } catch {}

  let senate = [];
  try {
    const html = await fetchSenateHTML(SENATE_SCHED_URL);
    if (html && html.includes('<html')) {
      senate = await parseSenateSchedule(html);
      console.log(`[senate] parsed rows=${senate.length}`);
      try {
        await appendDebug(`Senate parsed rows=${senate.length}`);
      } catch {}
      if (senate.length === 0) {
        console.log('[senate] produced 0 rows after parsing');
        try {
          await appendDebug('Senate produced 0 rows after parsing.');
        } catch {}
      }
    } else {
      console.error('[senate] missing or invalid HTML');
      try {
        await appendDebug('Senate: missing or invalid HTML.');
      } catch {}
      console.error('Senate schedule: blocked or no HTML content.');
    }
  } catch (e) {
    console.error(`[senate] error: ${e?.message || e}`);
    try {
      await appendDebug(`Senate error: ${e?.message || e}`);
    } catch {}
    console.error('Senate fetch failed:', e.message || e);
  }

  try {
    await fs.writeFile(path.join(OUTPUT_DIR, 'senate.json'), JSON.stringify(senate, null, 2));
    console.log(`[senate] JSON written: ${senate.length} items`);
  } catch (e) {
    console.error(`[senate] write error: ${e?.message || e}`);
    try {
      await appendDebug(`Senate write error: ${e?.message || e}`);
    } catch {}
  }

  // Final breadcrumb
  console.log(`[done] House=${house.length} Senate=${senate.length}`);
  try {
    await appendDebug(`Done. House=${house.length} Senate=${senate.length}`);
  } catch {}
}

main().catch(async (err) => {
  console.error('[fatal-main]', err?.stack || err);
  try { 
    await appendDebug(`Fatal error: ${err?.message || err}`); 
  } catch {}
  process.exit(1);
});
