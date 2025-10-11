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
const HOUSE_WARMUP_URL = 'https://www.congress.gov.ph/committees/committee-meetings/';
const HOUSE_STORAGE_STATE_FILE = path.join(OUTPUT_DIR, 'house-storage-state.json');
const TURNSTILE_RESPONSE_SELECTOR = '[name="cf-turnstile-response"]';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const FIREFOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0';
const PROXY_SERVER =
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';

function launchOptionsWithProxy(options = {}) {
  if (!PROXY_SERVER) {
    return options;
  }
  return {
    ...options,
    proxy: {
      server: PROXY_SERVER
    }
  };
}

function buildContextOptions(overrides = {}) {
  const base = {
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    userAgent: CHROME_UA,
    locale: 'en-US',
    timezoneId: 'Asia/Manila',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-CH-UA': '"Not)A;Brand";v="24", "Chromium";v="124", "Google Chrome";v="124"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Upgrade-Insecure-Requests': '1'
    }
  };

  return {
    ...base,
    ...overrides,
    extraHTTPHeaders: {
      ...base.extraHTTPHeaders,
      ...(overrides.extraHTTPHeaders || {})
    }
  };
}

async function applyStealthPatches(context) {
  if (!context) return;
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    } catch {}
    try {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
    } catch {}
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
    } catch {}
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3]
      });
    } catch {}
    try {
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => {
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery.call(window.navigator.permissions, parameters);
        };
      }
    } catch {}
  });
}

async function waitForTurnstileBootstrap(page, label) {
  if (!page) return '';
  console.log(`[house] warmup: ensuring Turnstile bootstrap (${label})`);
  try {
    await appendDebug(`House warmup: ensuring Turnstile bootstrap (${label})`);
  } catch {}
  await Promise.all([
    page.waitForLoadState('load').catch(() => {}),
    page
      .waitForFunction(
        () => typeof window !== 'undefined' && typeof window.turnstile !== 'undefined',
        { timeout: 60000 }
      )
      .catch(() => {})
  ]);
  await page.waitForTimeout(2500);
  const currentTitle = await page.title();
  console.log(`[house] warmup: page title="${currentTitle}" (${label})`);
  try {
    await appendDebug(`[house] warmup page title="${currentTitle}" (${label})`);
  } catch {}
  return currentTitle;
}

async function fetchHouseViaPage(page, payload) {
  if (!page) return { ok: false };
  try {
    const result = await page.evaluate(
      async ({ apiUrl, body, backendHeader }) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort('timeout'), 30000);
          try {
            const response = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-hrep-website-backend': backendHeader
              },
              credentials: 'include',
              body: JSON.stringify(body),
              signal: controller.signal
            });
            const text = await response.text();
            return { status: response.status, text };
          } finally {
            clearTimeout(timeout);
          }
        } catch (err) {
          return { error: err?.message || String(err) };
        }
      },
      { apiUrl: HOUSE_API, body: payload, backendHeader: 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1' }
    );
    if (result && typeof result === 'object' && 'error' in result) {
      return { ok: false, error: result.error };
    }
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

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
async function postJson(url, payload = {}, headers = {}, options = {}) {
  const { browser: providedBrowser, context: providedContext } = options;
  let browser = providedBrowser;
  let context = providedContext;
  let ownBrowser = false;
  let ownContext = false;

  if (!browser) {
    console.log('[postJson] launching new browser instance');
    try {
      browser = await chromium.launch(
        launchOptionsWithProxy({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
          ]
        })
      );
      ownBrowser = true;
      console.log('[postJson] browser launch successful');
    } catch (e) {
      console.error('[postJson] launch-failed', e?.stack || e);
      try {
        await appendDebug(`[postJson] launch-failed: ${e?.message || e}`);
      } catch {}
      throw e;
    }
  } else {
    console.log('[postJson] reusing provided browser/context');
  }

  if (!context) {
    context = await browser.newContext(buildContextOptions());
    await applyStealthPatches(context);
    ownContext = true;
  }

  try {
    const startedAt = Date.now();
    console.log(`[postJson] sending POST to ${url}`);
    try {
      await appendDebug(`Sending POST to ${url}`);
    } catch {}

    const resp = await context.request.post(url, {
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
    if (ownContext && context) {
      await context.close();
    }
    if (ownBrowser && browser) {
      await browser.close();
    }
  }
}

async function prepareHouseSession(payload) {
  console.log('[house] warmup: launching browser');
  try {
    await appendDebug('House warmup: launching browser');
  } catch {}

  const browser = await chromium.launch(
    launchOptionsWithProxy({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    })
  );

  try {
    let storageState;
    try {
      const raw = await fs.readFile(HOUSE_STORAGE_STATE_FILE, 'utf-8');
      storageState = JSON.parse(raw);
      console.log('[house] warmup: loaded storage state');
      try {
        await appendDebug('House warmup: loaded storage state from disk');
      } catch {}
    } catch (err) {
      if (err?.code === 'ENOENT') {
        console.log('[house] warmup: no existing storage state');
        try {
          await appendDebug('House warmup: storage state not found, starting fresh');
        } catch {}
      } else {
        console.warn(`[house] warmup: storage state read failed: ${err?.message || err}`);
        try {
          await appendDebug(`House warmup: storage state read failed: ${err?.message || err}`);
        } catch {}
      }
    }

    const contextOverrides = storageState ? { storageState } : {};
    const contextOptions = buildContextOptions({ ...contextOverrides });
    const context = await browser.newContext(contextOptions);
    await applyStealthPatches(context);
    const page = await context.newPage();
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('challenges.cloudflare.com')) {
        console.log(`[house] warmup: cf request ${req.method()} ${url}`);
      }
    });
    let pageFetchResult = null;
    let flowToken = '';

    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('challenges.cloudflare.com')) {
        let bodyPreview = '';
        try {
          const text = await resp.text();
          if (text) {
            if (url.includes('/flow/') && !flowToken) {
              flowToken = text.trim();
              if (flowToken) {
                console.log(
                  `[house] warmup: captured flow token length=${flowToken.length}`
                );
                try {
                  await appendDebug(
                    `House warmup: captured flow token length=${flowToken.length}`
                  );
                } catch {}
              }
            }
            bodyPreview = ` body=${text.slice(0, 120)}`;
          }
        } catch {}
        console.log(`[house] warmup: cf response ${resp.status()} ${url}${bodyPreview}`);
      }
    });
    let cookieHeader = '';

    try {
      console.log(`[house] warmup: navigating to ${HOUSE_WARMUP_URL}`);
      try {
        await appendDebug(`House warmup: navigating to ${HOUSE_WARMUP_URL}`);
      } catch {}

      await page.goto(HOUSE_WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForTurnstileBootstrap(page, 'initial');

      console.log('[house] warmup: page loaded');
      try {
        await appendDebug('House warmup: DOM ready + delay complete');
      } catch {}

      const captureToken = async (label) => {
        console.log(`[house] warmup: waiting for Turnstile response (${label})`);
        try {
          await appendDebug(`House warmup: waiting for Turnstile response (${label})`);
        } catch {}

        try {
          const turnstileLocator = page.locator(TURNSTILE_RESPONSE_SELECTOR);
          await turnstileLocator.waitFor({ state: 'attached', timeout: 60000 });
          try {
            await appendDebug(`House warmup: Turnstile selector observed (${label})`);
          } catch {}

          const siteKey = await page.evaluate(() => {
            const el = document.querySelector('[data-sitekey]');
            return el?.getAttribute('data-sitekey') || '';
          });
          if (siteKey) {
            console.log(`[house] warmup: detected Turnstile site key (${label}): ${siteKey}`);
            try {
              await appendDebug(`House warmup: detected Turnstile site key (${label}): ${siteKey}`);
            } catch {}
          }

          const deadline = Date.now() + 60000;
          while (Date.now() < deadline) {
            const tokenValue = await turnstileLocator.evaluate((el) => {
              if (!el || typeof el.value !== 'string') return '';
              return el.value.trim();
            });
            if (tokenValue) {
              return { token: tokenValue, sawSelector: true };
            }
            await page.waitForTimeout(500);
          }

          console.warn('[house] warmup: Turnstile selector seen but token empty');
          try {
            await appendDebug('House warmup: Turnstile selector seen but token empty');
          } catch {}
          return { token: '', sawSelector: true };
        } catch (tokenErr) {
          console.warn(
            `[house] warmup: Turnstile selector missing (${label}): ${tokenErr?.message || tokenErr}`
          );
          try {
            await appendDebug(
              `House warmup: Turnstile selector missing (${label}): ${tokenErr?.message || tokenErr}`
            );
          } catch {}
          return { token: '', sawSelector: false };
        }
      };

      let turnstileToken = '';
      let sawSelector = false;

      let captureResult = await captureToken('initial');
      turnstileToken = captureResult.token;
      sawSelector = captureResult.sawSelector;

      if (!captureResult.sawSelector) {
        console.log('[house] warmup: reloading page after missing selector');
        try {
          await appendDebug('House warmup: reloading page after missing selector');
        } catch {}
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForTurnstileBootstrap(page, 'reload');
        captureResult = await captureToken('reload');
        turnstileToken = captureResult.token;
        sawSelector = sawSelector || captureResult.sawSelector;
      }

      if (!turnstileToken && flowToken) {
        const trimmedFlow = flowToken.trim();
        if (trimmedFlow) {
          console.log('[scripts/fetch.js] warmup: falling back to flow token response');
          try {
            await appendDebug(
              `[scripts/fetch.js] House warmup: falling back to flow token length=${trimmedFlow.length}`
            );
          } catch {}
          turnstileToken = trimmedFlow;
        }
      }

      if (turnstileToken) {
        console.log('[house] warmup: captured Turnstile token');
        try {
          await appendDebug(
            `House warmup: captured Turnstile token length=${turnstileToken.length}`
          );
        } catch {}
      } else {
        const selectorState = sawSelector ? 'seen' : 'missing';
        console.warn(
          `[house] warmup: Turnstile token missing (selector ${selectorState}), trying in-page fetch`
        );
        try {
          await appendDebug(
            `House warmup: Turnstile token missing (selector ${selectorState}), trying in-page fetch`
          );
        } catch {}
        if (payload) {
          const fallback = await fetchHouseViaPage(page, payload);
          if (fallback.ok && fallback.result) {
            pageFetchResult = fallback.result;
            console.log(
              `[house] warmup: in-page fetch completed with status ${fallback.result.status}`
            );
            try {
              await appendDebug(
                `House warmup: in-page fetch status ${fallback.result.status}`
              );
            } catch {}
          } else {
            console.warn(
              `[house] warmup: in-page fetch failed: ${fallback.error || 'unknown error'}`
            );
            try {
              await appendDebug(
                `House warmup: in-page fetch failed: ${fallback.error || 'unknown error'}`
              );
            } catch {}
          }
        }

        if (!pageFetchResult) {
          throw new Error('Turnstile token unavailable');
        }
      }

      try {
        const cookies = await context.cookies(HOUSE_API);
        if (Array.isArray(cookies) && cookies.length > 0) {
          cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        }
      } catch {}

      return { browser, context, turnstileToken, pageFetchResult, cookieHeader };
    } finally {
      try {
        await page.close();
      } catch {}
    }
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function fetchSenateHTML(url) {
  console.log('[fetchSenateHTML] starting browser launch');
  const browser = await chromium.launch(
    launchOptionsWithProxy({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    })
  );
  try {
    const context = await browser.newContext(buildContextOptions());
    await applyStealthPatches(context);
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
      'User-Agent': FIREFOX_UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Referer: 'https://www.congress.gov.ph/committees/committee-meetings/',
      'Content-Type': 'application/json',
      'x-hrep-website-backend': 'cc8bd00d-9b88-4fee-aafe-311c574fcdc1',
      Origin: 'https://www.congress.gov.ph',
      'Sec-GPC': '1',
      Connection: 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      TE: 'trailers'
    };
    console.log(`[house] headers count: ${Object.keys(headers).length}`);
    try {
      await appendDebug(`House headers count: ${Object.keys(headers).length}`);
    } catch {}

    // Simple backoff retry for transient errors
    const delays = [500, 1500, 3500, 7000];
    let apiResp = null;
    let lastErr = null;

    let houseSession;
    let turnstileToken = '';
    let inPageApiResult = null;
    let houseCookieHeader = '';

    const closeHouseSession = async () => {
      if (houseSession?.browser) {
        try {
          await houseSession.browser.close();
        } catch {}
      }
      houseSession = null;
    };

    const initHouseSession = async (tag) => {
      if (houseSession) {
        await closeHouseSession();
      }
      try {
        houseSession = await prepareHouseSession(payload);
        turnstileToken = houseSession?.turnstileToken || '';
        inPageApiResult = houseSession?.pageFetchResult || null;
        houseCookieHeader = houseSession?.cookieHeader || '';
        console.log(`[house] warmup session ready (${tag}), tokenLen=${turnstileToken.length}`);
        try {
          await appendDebug(
            `House warmup session ready (${tag}), tokenLen=${turnstileToken.length}`
          );
        } catch {}
      } catch (prepErr) {
        console.error(`[house] warmup session failed (${tag}): ${prepErr?.message || prepErr}`);
        try {
          await appendDebug(
            `House warmup session failed (${tag}): ${prepErr?.message || prepErr}`
          );
        } catch {}
        throw prepErr;
      }
    };

    try {
      await initHouseSession('initial');
      if (!turnstileToken && !inPageApiResult) {
        console.warn('[house] warmup returned empty Turnstile token, retrying once');
        try {
          await appendDebug('House warmup returned empty Turnstile token, retrying once');
        } catch {}
        await initHouseSession('refresh');
      }

      if (inPageApiResult && inPageApiResult.status === 200) {
        try {
          apiResp = JSON.parse(inPageApiResult.text || '');
          console.log('[house] in-page fetch provided API response');
          try {
            await appendDebug('House in-page fetch provided API response.');
          } catch {}
        } catch (parseErr) {
          console.warn('[house] in-page fetch JSON parse failed, falling back to direct API');
          try {
            await appendDebug('House in-page fetch JSON parse failed, falling back to direct API.');
          } catch {}
          apiResp = null;
          inPageApiResult = null;
        }
      }

      for (let i = 0; i < delays.length && !apiResp; i++) {
        try {
          console.log(`[house] attempt ${i + 1} starting...`);
          try {
            await appendDebug(`House attempt ${i + 1} starting...`);
          } catch {}
          const attemptHeaders = { ...headers };
          if (turnstileToken) {
            attemptHeaders['cf-turnstile-response'] = turnstileToken;
          }
          if (houseCookieHeader) {
            attemptHeaders.Cookie = houseCookieHeader;
          }
          try {
            await appendDebug(
              `House attempt ${i + 1}: using Turnstile token length=${turnstileToken.length}`
            );
          } catch {}

          apiResp = await postJson(HOUSE_API, payload, attemptHeaders, {
            browser: houseSession.browser,
            context: houseSession.context
          });
          console.log(`[house] attempt ${i + 1} succeeded`);
          try {
            await appendDebug(`House attempt ${i + 1} succeeded`);
          } catch {}

          try {
            await houseSession.context.storageState({ path: HOUSE_STORAGE_STATE_FILE });
            try {
              await appendDebug('House warmup: storage state saved to disk');
            } catch {}
          } catch (stateErr) {
            console.warn(`[house] storage state save failed: ${stateErr?.message || stateErr}`);
            try {
              await appendDebug(`House storage state save failed: ${stateErr?.message || stateErr}`);
            } catch {}
          }

          break;
        } catch (e) {
          lastErr = e;
          console.error(`[house] attempt ${i + 1} failed: ${e?.message || e}`);
          try {
            await appendDebug(`House attempt ${i + 1} failed: ${e?.message || e}`);
          } catch {}
          if (i < delays.length - 1) {
            const errMsg = e?.message || '';
            const shouldRefresh = /403/.test(errMsg) || !turnstileToken;
            if (shouldRefresh) {
              console.warn('[house] refreshing warmup session before retry');
              try {
                await appendDebug('House refreshing warmup session before retry');
              } catch {}
              await initHouseSession('retry');
            }
            console.log(`[house] retrying after ${delays[i]}ms...`);
            try {
              await appendDebug(`House retrying after ${delays[i]}ms...`);
            } catch {}
            await new Promise((r) => setTimeout(r, delays[i]));
          }
        }
      }
    } finally {
      await closeHouseSession();
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
