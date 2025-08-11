import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cheerio from 'cheerio';
import pdf from 'pdf-parse';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIG
const HOUSE_URL_DEFAULT = 'https://www.congress.gov.ph/committees/committee-meetings/print-weekly/?week=255';
const SENATE_SCHED_URL = 'https://web.senate.gov.ph/committee/schedwk.asp';
const SENATE_NOTICES_URL = 'https://web.senate.gov.ph/notice_ctte.asp';

// Helpers
function norm(s) {
  return (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function hasMin(row) {
  return row.date && row.time && row.committee;
}
function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}
function parseClock(s) {
  if (!s) return '';
  // Normalize common variants like 10:00 a.m., 10:00 am, 10:00 AM
  return norm(s).replace(/\b(a\.m\.|p\.m\.)\b/gi, (m) => m.toUpperCase().replace(/\./g, ''));
}
function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// Playwright fetch
async function fetchWithPlaywright(url, binary=false) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1366, height: 900 }
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // Wait a moment to allow any interstitials to resolve
  await page.waitForTimeout(5000);

  let result;
  if (binary) {
    // Try to read the top response body
    const resp = await page.waitForResponse(r => r.url().startsWith(url), { timeout: 15000 }).catch(() => null);
    if (resp) {
      try {
        result = await resp.body();
      } catch {
        // Fallback: download via page.evaluate
        result = null;
      }
    }
  } else {
    result = await page.content();
  }

  await browser.close();
  return result;
}

// Parse House weekly print (table-based)
async function parseHouse(html) {
  const $ = cheer
