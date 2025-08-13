// scripts/fetch.js
// Fetch committee schedules from:
// - House API (POST /hrep/api-v1/committee-schedule/list with exact browser headers + debug)
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DEBUG_LOG = path.join(OUTPUT_DIR, 'debug.log');

// Endpoints
const HOUSE_API = 'https://api.v2.congress.hrep.online/hrep/api-v1/committee-schedule/list';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';

// ---------------- Debug helpers ----------------
async function appendDebug(line) {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    await fs.appendFile(DEBUG_LOG, `[${stamp}] ${line}\n`, 'utf-8');
  } catch {
    // ignore debug write failures
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

// ---------------- HTTP helpers (Playwright request with enhanced debug) ----------------
async function postJson(url, payload = {}, headers = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const startedAt = Date.now();
    await appendDebug(`Sending POST to ${url}`);
    
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
    await appendDebug(`POST response: status=${status}, contentLength=${text.length}, duration=${ms}ms`);

    if (status < 200 || status >= 300) {
      const hdrs = resp.headers();
      await appendDebug(
        `House API POST ${url} status=${status} durationMs=${ms} headers=${JSON.stringify(
          hdrs
        )} bodyHead=${text.slice(0, 400)}`
      );
      throw new Error(`HTTP ${status}`);
    }

    try {
      const json = JSON.parse(text);
      await appendDebug(
        `House API POST ${url} status=${status} durationMs=${ms} keys=${Object.keys(json).join(',')} dataType=${typeof json.data}`
      );
      return json;
    } catch {
      await appendDebug(
        `House API POST ${url} status=${status} durationMs=${ms} nonJSONHead=${text.slice(0, 400)}`
      );
      throw new Error('Non-JSON response');
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
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    const ms = Date.now() - startedAt;
    await appendDebug(`Senate GET ${url} loaded durationMs=${ms} htmlLen=${html?.length || 0}`);
    return html;
  } finally {
    await browser.close();
  }
}

// ---------------- Parsers ----------------
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
    const k = `${r.date}|${r.time}|${r.committee}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------- Main ----------------
async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(DEBUG_LOG, '', 'utf-8'); // reset debug log each run

  // -------- House via public API (exact browser headers with comprehensive debug) --------
  let house = [];
  try {
    // Captured working payload
    const payload = { page: 0, limit: 150, congress: '19', filter: '' };
    await appendDebug(`House payload: ${JSON.stringify(payload)}`);

    // Exact headers from successful browser request
    const headers = {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      Origin: 'https://www.congress.gov.ph',
      'Sec-GPC': '1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      'x-hrep-website-backend': 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1',
      Referer: 'https://www.congress.gov.ph/',
      Priority: 'u=4',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0'
    };
    await appendDebug(`House headers count: ${Object.keys(headers).length}`);

    // Simple backoff retry for transient errors
    const delays = [500, 1500, 3500];
    let apiResp = null;
    let lastErr = null;

    for (let i = 0; i < delays.length; i++) {
      try {
        await appendDebug(`House attempt ${i + 1} starting...`);
        apiResp = await postJson(HOUSE_API, payload, headers);
        await appendDebug(`House attempt ${i + 1} succeeded`);
        break;
      } catch (e) {
        lastErr = e;
        await appendDebug(`House attempt ${i + 1} failed: ${e?.message || e}`);
        if (i < delays.length - 1) {
          await appendDebug(`House retrying after ${delays[i]}ms...`);
          await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
    }

    if (!apiResp) {
      await appendDebug('House API failed after all retries.');
      throw lastErr || new Error('House API failed after retries');
    }

    // Log response structure
    await appendDebug(`House API response keys: ${Object.keys(apiResp).join(',')}`);
    await appendDebug(`House API status: ${apiResp.status}, success: ${apiResp.success}`);
    
    if (apiResp.data) {
      await appendDebug(`House API data keys: ${Object.keys(apiResp.data).join(',')}`);
      await appendDebug(`House API pageCount: ${apiResp.data.pageCount}, count: ${apiResp.data.count}`);
    }

    // Save raw API response envelope for inspection
    await fs.writeFile(
      path.join(OUTPUT_DIR, 'house_api_debug.json'),
      JSON.stringify(apiResp, null, 2),
      'utf-8'
    );

    // Parse response
    const rows = Array.isArray(apiResp?.data?.rows) ? apiResp.data.rows : [];
    await appendDebug(`House raw rows count: ${rows.length}`);
    
    if (rows.length > 0) {
      await appendDebug(`House first row keys: ${Object.keys(rows[0]).join(',')}`);
      await appendDebug(`House first row sample: date="${rows[0].date}", time="${rows[0].time}", comm_name="${rows[0].comm_name}", cancelled=${rows[0].cancelled}`);
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
        await appendDebug(`House row ${index}: date="${it.date}", time="${it.time}", comm_name="${it.comm_name}", cancelled=${it.cancelled}`);
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
      if (!date && index < 5) await appendDebug(`House row ${index}: missing date`);
      if (!time && index < 5) await appendDebug(`House row ${index}: missing time`);  
      if (!committee && index < 5) await appendDebug(`House row ${index}: missing committee`);

      if (date && time && committee) {
        validCount++;
        mapped.push({ date, time, committee, subject, venue, source: 'House API (list)' });
      } else {
        invalidCount++;
      }
    }

    await appendDebug(`House mapping: ${validCount} valid, ${invalidCount} invalid, ${cancelledCount} cancelled`);

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

    await appendDebug(`House deduplication: ${dupCount} duplicates removed, ${house.length} final count`);

    if (house.length > 0) {
      await appendDebug(`House final first item: ${JSON.stringify(house[0])}`);
      await appendDebug(`House date range: ${house[0].date} to ${house[house.length-1].date}`);
    } else {
      await appendDebug('House produced 0 rows after mapping/dedup.');
    }

  } catch (e) {
    await appendDebug(`House error: ${e?.message || e}`);
    console.error('House API fetch failed:', e.message || e);
  }

  try {
    await fs.writeFile(path.join(OUTPUT_DIR, 'house.json'), JSON.stringify(house, null, 2));
    await appendDebug(`House JSON written: ${house.length} items`);
  } catch (e) {
    await appendDebug(`House write error: ${e?.message || e}`);
  }

  // -------- Senate (XHTML) --------
  let senate = [];
  try {
    const html = await fetchSenateHTML(SENATE_SCHED_URL);
    if (html && html.includes('<html')) {
      senate = await parseSenateSchedule(html);
      await appendDebug(`Senate parsed rows=${senate.length}`);
      if (senate.length === 0) {
        await appendDebug('Senate produced 0 rows after parsing.');
      }
    } else {
      await appendDebug('Senate: missing or invalid HTML.');
      console.error('Senate schedule: blocked or no HTML content.');
    }
  } catch (e) {
    await appendDebug(`Senate error: ${e?.message || e}`);
    console.error('Senate fetch failed:', e.message || e);
  }

  try {
    await fs.writeFile(path.join(OUTPUT_DIR, 'senate.json'), JSON.stringify(senate, null, 2));
  } catch (e) {
    await appendDebug(`Senate write error: ${e?.message || e}`);
  }

  // Final breadcrumb
  await appendDebug(`Done. House=${house.length} Senate=${senate.length}`);
}

main().catch(async (err) => {
  await appendDebug(`Fatal error: ${err?.message || err}`);
  console.error(err);
  process.exit(1);
});
