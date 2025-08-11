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
  return (s || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMin(row) {
  return row.date && row.time && row.committee;
}

function keyOf(r) {
  return `${r.date}|${r.time}|${r.committee}`.toLowerCase();
}

function parseClock(s) {
  if (!s) return '';
  // Normalize 10:00 a.m. -> 10:00 AM
  return norm(s).replace(/\b(a\.m\.|p\.m\.)\b/gi, (m) =>
    m.toUpperCase().replace(/\./g, '')
  );
}

function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// Playwright fetch
async function fetchWithPlaywright(url, binary = false) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  // Wait a moment for interstitials if any
  await page.waitForTimeout(5000);

  let result;
  if (binary) {
    // Try to capture the main response body
    const resp = await page
      .waitForResponse((r) => r.url().startsWith(url), { timeout: 15000 })
      .catch(() => null);
    if (resp) {
      try {
        result = await resp.body();
      } catch {
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
  const $ = cheerio.load(html);
  const rowsOut = [];

  $('table').each((_, table) => {
    const headers = $(table)
      .find('th')
      .map((__, th) => norm($(th).text()).toLowerCase())
      .get();
    const looksRight =
      headers.join('|').includes('date') &&
      headers.join('|').includes('time') &&
      headers.join('|').includes('committee');

    if (looksRight || headers.length === 0) {
      $(table)
        .find('tr')
        .each((__, tr) => {
          const tds = $(tr).find('td');
          if (tds.length >= 3) {
            const date = norm($(tds[0]).text());
            const time = parseClock($(tds[1]).text());
            const committee = norm($(tds[2]).text());
            const subject = tds[3] ? norm($(tds[3]).text()) : '';
            const venue = tds[4] ? norm($(tds[4]).text()) : '';

            if (date && time && committee) {
              rowsOut.push({
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

  // Deduplicate
  const seen = new Set();
  const dedup = [];
  for (const r of rowsOut) {
    const k = keyOf(r);
    if (!seen.has(k)) {
      seen.add(k);
      dedup.push(r);
    }
  }
  return dedup;
}

// Parse Senate weekly schedule (HTML table)
async function parseSenateSchedule(html) {
  const $ = cheerio.load(html);
  const rowsOut = [];

  $('table').each((_, table) => {
    const headers = $(table)
      .find('th')
      .map((__, th) => norm($(th).text()).toLowerCase())
      .get();
    const good =
      headers.join('|').includes('date') &&
      headers.join('|').includes('time') &&
      headers.join('|').includes('committee');

    if (good || headers.length === 0) {
      $(table)
        .find('tr')
        .each((__, tr) => {
          const tds = $(tr).find('td');
          if (tds.length >= 3) {
            const date = norm($(tds[0]).text());
            const time = parseClock($(tds[1]).text()));
            const committee = norm($(tds[2]).text());
            const subject = tds[3] ? norm($(tds[3]).text()) : '';
            const venue = tds[4] ? norm($(tds[4]).text()) : '';

            if (date && time && committee) {
              rowsOut.push({
                date,
                time,
                committee,
                subject,
                venue,
                source: 'Senate Weekly Schedule',
              });
            }
          }
        });
    }
  });

  // Dedup
  const seen = new Set();
  const out = [];
  for (const r of rowsOut) {
    const k = keyOf(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

// Parse Senate notices index to collect links
async function parseSenateNoticesIndex(html) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href) return;
    if (/ctte/i.test(href) && (/\.asp$/i.test(href) || /\.pdf$/i.test(href))) {
      links.push(absUrl(SENATE_NOTICES_URL, href));
    }
  });
  return Array.from(new Set(links));
}

// Extract fields from free text
function extractFieldsFromText(text) {
  const dateRegexes = [
    /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+[A-Za-z]+\s+\d{1,2},\s+20\d{2}\b/,
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,?\s+\d{1,2}\s+[A-Za-z]+\s+20\d{2}\b/i,
  ];
  const timeRegex = /\b\d{1,2}:\d{2}\s?(AM|PM|a\.m\.|p\.m\.)\b/i;
  const committeeRegex = /\bCommittee on [A-Za-z0-9 ,&\-()\/]+/;
  const agendaRegex = /\b(Subject|Agenda)\s*[:\-]\s*([^\n]+)\b/i;
  const venueRegex =
    /\b(Venue|Place|Room|Committee Room|Senate Bldg\.?|Session Hall)\s*[:\-]?\s*([^\n]+)\b/i;

  let date = '';
  for (const r of dateRegexes) {
    const m = text.match(r);
    if (m) {
      date = norm(m[0]);
      break;
    }
  }
  const timeMatch = text.match(timeRegex);
  const time = timeMatch ? parseClock(timeMatch) : '';
  const committeeMatch = text.match(committeeRegex);
  const committee = committeeMatch ? norm(committeeMatch) : '';
  const agendaMatch = text.match(agendaRegex);
  const subject = agendaMatch ? norm(agendaMatch[2]) : '';
  const venueMatch = text.match(venueRegex);
  const venue = venueMatch ? norm(venueMatch[2] || venueMatch) : '';

  return { date, time, committee, subject, venue };
}

// Parse a Senate notice HTML
async function parseSenateNoticeHTML(html) {
  const $ = cheerio.load(html);
  const bodyText = norm($('body').text());
  const fields = extractFieldsFromText(bodyText);

  let committee = fields.committee;
  if (!committee) {
    const title = norm($('h1,h2,h3').first().text());
    if (/committee on/i.test(title)) {
      committee = title;
    }
  }

  if (fields.date && fields.time && committee) {
    return [
      {
        date: fields.date,
        time: fields.time,
        committee,
        subject: fields.subject,
        venue: fields.venue,
        source: 'Senate Notice (HTML)',
      },
    ];
  }
  return [];
}

// Parse a Senate notice PDF
async function parseSenateNoticePDF(buffer) {
  try {
    const data = await pdf(buffer);
    const text = norm(data.text || '');
    const fields = extractFieldsFromText(text);
    if (fields.date && fields.time && fields.committee) {
      return [
        {
          date: fields.date,
          time: fields.time,
          committee: fields.committee,
          subject: fields.subject,
          venue: fields.venue,
          source: 'Senate Notice (PDF)',
        },
      ];
    }
  } catch {
    // ignore
  }
  return [];
}

async function main() {
  const WEEK = process.env.WEEK || '';
  const houseURL = WEEK
    ? `https://www.congress.gov.ph/committees/committee-meetings/print-weekly/?week=${encodeURIComponent(
        WEEK
      )}`
    : HOUSE_URL_DEFAULT;

  const outDir = path.join(__dirname, '..', 'output');
  await fs.mkdir(outDir, { recursive: true });

  // HOUSE
  let house = [];
  try {
    const html = await fetchWithPlaywright(houseURL, false);
    if (html && typeof html === 'string' && html.includes('<html')) {
      house = await parseHouse(html);
    } else {
      console.error('House: No HTML content or blocked.');
    }
  } catch (e) {
    console.error('House fetch failed:', e.message);
  }
  await fs.writeFile(
    path.join(outDir, 'house.json'),
    JSON.stringify(house, null, 2)
  );

  // SENATE schedule
  let senateSched = [];
  try {
    const html = await fetchWithPlaywright(SENATE_SCHED_URL, false);
    if (html && typeof html === 'string' && html.includes('<html')) {
      senateSched = await parseSenateSchedule(html);
    } else {
      console.error('Senate schedule: No HTML content or blocked.');
    }
  } catch (e) {
    console.error('Senate schedule fetch failed:', e.message);
  }

  // SENATE notices
  let senateNotices = [];
  try {
    const indexHtml = await fetchWithPlaywright(SENATE_NOTICES_URL, false);
    if (indexHtml && indexHtml.includes('<html')) {
      const links = await parseSenateNoticesIndex(indexHtml);
      const maxLinks = Math.min(60, links.length);
      for (let i = 0; i < maxLinks; i++) {
        const link = links[i];
        try {
          if (link.toLowerCase().endsWith('.pdf')) {
            const buf = await fetchWithPlaywright(link, true);
            if (buf && buf.length > 0) {
              const parsed = await parseSenateNoticePDF(buf);
              senateNotices.push(...parsed);
            }
          } else {
            const html = await fetchWithPlaywright(link, false);
            if (html && html.includes('<html')) {
              const parsed = await parseSenateNoticeHTML(html);
              senateNotices.push(...parsed);
            }
          }
        } catch (e) {
          console.error('Notice parse failed:', link, e.message);
        }
      }
    } else {
      console.error('Senate notices index: No HTML content or blocked.');
    }
  } catch (e) {
    console.error('Senate notices fetch failed:', e.message);
  }

  // Merge Senate data (prefer Notices over Schedule)
  const merged = [];
  const seenNotice = new Set(senateNotices.map(keyOf));
  merged.push(...senateNotices);
  for (const row of senateSched) {
    const k = keyOf(row);
    if (!seenNotice.has(k)) merged.push(row);
  }

  // Final dedup
  const seen = new Set();
  const senate = [];
  for (const r of merged) {
    const k = keyOf(r);
    if (!seen.has(k)) {
      seen.add(k);
      senate.push(r);
    }
  }

  await fs.writeFile(
    path.join(outDir, 'senate.json'),
    JSON.stringify(senate, null, 2)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
