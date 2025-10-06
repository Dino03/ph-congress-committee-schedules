import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DATA_DIR = path.join(DOCS_DIR, 'data');

const HOUSE_SOURCE = 'House of Representatives (API)';
const SENATE_SOURCE = 'Senate Weekly Schedule';

function norm(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u00A0/g, ' ').replace(/[\s\u200B]+/g, ' ').trim();
}

function parseClock(value) {
  const normalized = norm(value);
  if (!normalized) return '';
  return normalized.replace(/\b(a\.m\.|p\.m\.)\b/gi, (match) => match.toUpperCase().replace(/\./g, ''));
}

function toTwoDigits(input) {
  return String(input).padStart(2, '0');
}

function toIso(date, time) {
  const day = norm(date);
  if (!/\d{4}-\d{2}-\d{2}/.test(day)) return '';
  if (!time) {
    return `${day}T00:00:00`;
  }

  const match = norm(time).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) {
    return `${day}T00:00:00`;
  }

  let [_, hourRaw, minutesRaw, meridiemRaw] = match; // eslint-disable-line no-unused-vars
  let hour = parseInt(hourRaw, 10);
  const minutes = minutesRaw ? parseInt(minutesRaw, 10) : 0;
  const meridiem = meridiemRaw ? meridiemRaw.toUpperCase() : null;

  if (meridiem === 'PM' && hour < 12) {
    hour += 12;
  }
  if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  return `${day}T${toTwoDigits(hour)}:${toTwoDigits(minutes)}:00`;
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadExistingDocsRecords(fileName, { branch, idPrefix, source }) {
  const existing = await readJson(path.join(DATA_DIR, `${fileName}.json`));
  if (!Array.isArray(existing) || existing.length === 0) {
    return [];
  }

  return existing
    .map((item, index) => {
      const date = norm(item.date || '');
      const time = parseClock(item.time || '');

      return {
        id: item.id || `${idPrefix}-${index + 1}`,
        branch: item.branch || branch,
        committee: norm(item.committee || ''),
        date,
        time,
        venue: norm(item.venue || ''),
        agenda: norm(item.agenda || ''),
        status: norm(item.status || '') || 'Scheduled',
        notes: norm(item.notes || ''),
        isoDate: item.isoDate || toIso(date, time),
        source: item.source || source,
      };
    })
    .filter((record) => record.date && record.committee);
}

function deriveHouseRecords(rows) {
  return rows
    .map((row) => {
      const date = norm(row.date || row.scheduleDate || '');
      const time = parseClock(row.time || row.scheduleTime || '');
      const agenda = norm(row.agenda || row.subject || '');
      const committee = norm(row.comm_name || row.committee || '');
      const venue = norm(row.venue || '');

      if (!date || !committee) {
        return null;
      }

      const statusBits = [];
      if (row.cancelled) statusBits.push('Cancelled');
      if (row.resched) statusBits.push(`Rescheduled: ${norm(row.resched)}`);
      if (row.remarks) statusBits.push(norm(row.remarks));
      if (!statusBits.length) statusBits.push('Scheduled');

      const isoDate = row.datetime ? `${row.datetime}:00`.replace(/::/g, ':') : toIso(date, time);

      return {
        id: `house-${row.id || row.record_id || row._id || Math.random().toString(36).slice(2)}`,
        branch: 'House of Representatives',
        committee,
        date,
        time,
        venue,
        agenda,
        status: statusBits.join(' · '),
        notes: norm(row.onwards ? 'Onwards' : ''),
        isoDate,
        source: HOUSE_SOURCE
      };
    })
    .filter(Boolean);
}

const MONTH_NAME_MAP = {
  jan: 'January',
  january: 'January',
  feb: 'February',
  february: 'February',
  mar: 'March',
  march: 'March',
  apr: 'April',
  april: 'April',
  may: 'May',
  jun: 'June',
  june: 'June',
  jul: 'July',
  july: 'July',
  aug: 'August',
  august: 'August',
  sep: 'September',
  sept: 'September',
  september: 'September',
  oct: 'October',
  october: 'October',
  nov: 'November',
  november: 'November',
  dec: 'December',
  december: 'December'
};

function parseSenateDate(headerText) {
  const cleaned = norm(headerText)
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
  if (!cleaned) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const dropWeekday = cleaned.replace(/^[A-Z]+,?\s+/i, '');
  const match = dropWeekday.match(/([A-Za-z\.]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (!match) {
    const fallback = new Date(cleaned);
    if (Number.isNaN(fallback.getTime())) return '';
    return fallback.toISOString().slice(0, 10);
  }

  let [, rawMonth, day, year] = match;
  const monthKey = rawMonth.replace(/\.$/, '').toLowerCase();
  const monthName = MONTH_NAME_MAP[monthKey];
  if (!monthName) return '';

  if (!year) {
    year = new Date().getFullYear();
  }

  const parsed = new Date(`${monthName} ${day}, ${year}`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function htmlToText(html) {
  const fragment = cheerio.load(`<div>${html}</div>`);
  return norm(fragment('div').text());
}

function deriveSenateRecordsFromHtml(html, statsCollector) {
  const $ = cheerio.load(html);
  const tables = $('div[align="center"] > table[width="98%"].grayborder');
  const records = [];
  const stats = statsCollector || null;
  const dropReasons = {
    missingDate: 0,
    missingCommittee: 0,
    duplicate: 0,
    filteredNotice: 0,
    invalidStructure: 0
  };
  let attemptedCount = 0;
  let rowCount = 0;
  const seen = new Set();

  tables.each((_, table) => {
    const $table = $(table);
    const rows = $table.find('tr');
    if (rows.length < 3) return;

    const dayHeader = norm($(rows[0]).find('td').first().text());
    const isoDate = parseSenateDate(dayHeader);

    for (let index = 2; index < rows.length; index += 1) {
      rowCount += 1;
      const cells = $(rows[index]).find('td');
      if (cells.length < 3) {
        dropReasons.invalidStructure += 1;
        continue;
      }

      const committee = norm($(cells[0]).text());
      if (!committee) {
        dropReasons.missingCommittee += 1;
        continue;
      }
      if (/no committee hearing/i.test(committee)) {
        dropReasons.filteredNotice += 1;
        continue;
      }

      const timeVenueParts = ($(cells[1]).html() || '')
        .split(/<br\s*\/?>/i)
        .map((chunk) => htmlToText(chunk))
        .filter(Boolean);

      const agendaParts = ($(cells[2]).html() || '')
        .split(/<br\s*\/?>/i)
        .map((chunk) => htmlToText(chunk))
        .filter(Boolean);

      const time = parseClock(timeVenueParts[0] || '');
      const venue = timeVenueParts.slice(1).join(' ');
      const agenda = agendaParts.join('; ');

      attemptedCount += 1;

      if (!isoDate) {
        dropReasons.missingDate += 1;
        continue;
      }
      const record = {
        id: `senate-${records.length + 1}`,
        branch: 'Senate',
        committee,
        date: isoDate,
        time,
        venue,
        agenda,
        status: 'Scheduled',
        notes: '',
        isoDate: toIso(isoDate, time),
        source: SENATE_SOURCE
      };

      const dedupeKey = `${record.date}|${record.time}|${record.committee}`.toLowerCase();
      if (seen.has(dedupeKey)) {
        dropReasons.duplicate += 1;
        continue;
      }

      seen.add(dedupeKey);
      records.push(record);
    }
  });

  if (stats) {
    stats.tableCount = tables.length;
    stats.rowCount = rowCount;
    stats.rawCount = attemptedCount;
    stats.parsedCount = records.length;
    stats.dropReasons = dropReasons;
  }

  return records;
}

function deriveSenateRecords(data, statsCollector) {
  const stats = statsCollector || null;

  if (!Array.isArray(data) || data.length === 0) {
    if (stats) {
      stats.rawCount = Array.isArray(data) ? data.length : 0;
      stats.parsedCount = 0;
      stats.dropReasons = {};
      if (!Array.isArray(data) && data !== null && data !== undefined) {
        stats.note = `Expected array but received ${typeof data}`;
      }
    }
    return [];
  }

  const dropReasons = {
    missingDate: 0,
    missingCommittee: 0
  };

  const records = [];

  data.forEach((item, index) => {
    const normalizedDate = parseSenateDate(item.date || '') || norm(item.date || '');
    const normalizedTime = parseClock(item.time || '');
    const committee = norm(item.committee || item.title || '');

    if (!normalizedDate) {
      dropReasons.missingDate += 1;
      return;
    }

    if (!committee) {
      dropReasons.missingCommittee += 1;
      return;
    }

    records.push({
      id: `senate-${item.id || index + 1}`,
      branch: 'Senate',
      committee,
      date: normalizedDate,
      time: normalizedTime,
      venue: norm(item.venue || ''),
      agenda: norm(item.agenda || item.subject || ''),
      status: norm(item.status || 'Scheduled') || 'Scheduled',
      notes: norm(item.notes || ''),
      isoDate: toIso(normalizedDate, normalizedTime),
      source: SENATE_SOURCE
    });
  });

  if (stats) {
    stats.rawCount = data.length;
    stats.parsedCount = records.length;
    stats.dropReasons = dropReasons;
  }

  return records;
}

async function loadHouseRecords() {
  const housePath = path.join(OUTPUT_DIR, 'house.json');
  const houseJson = await readJson(housePath);
  if (Array.isArray(houseJson) && houseJson.length > 0) {
    return deriveHouseRecords(houseJson);
  }

  const houseDebugPath = path.join(OUTPUT_DIR, 'house_api_debug.json');
  const debugJson = await readJson(houseDebugPath);
  if (debugJson?.data?.rows?.length) {
    return deriveHouseRecords(debugJson.data.rows);
  }

  return [];
}

async function loadSenateRecords() {
  const debug = {
    generatedAt: new Date().toISOString(),
    source: null,
    attempts: [],
    warnings: []
  };

  const senatePath = path.join(OUTPUT_DIR, 'senate.json');
  const senateJson = await readJson(senatePath);
  const jsonStats = {};
  const fromJson = deriveSenateRecords(senateJson, jsonStats);

  if (senateJson === null) {
    debug.attempts.push({
      stage: 'senate.json',
      status: 'missing'
    });
  } else {
    debug.attempts.push({
      stage: 'senate.json',
      status: fromJson.length ? 'ok' : 'empty',
      rawCount: jsonStats.rawCount,
      parsedCount: jsonStats.parsedCount,
      dropReasons: jsonStats.dropReasons,
      note: jsonStats.note
    });
  }

  if (fromJson.length) {
    debug.source = 'senate.json';
    return { records: fromJson, debug };
  }

  try {
    const senateHtmlPath = path.join(OUTPUT_DIR, 'senate.html');
    const html = await fs.readFile(senateHtmlPath, 'utf-8');
    const htmlStats = {};
    const fromHtml = deriveSenateRecordsFromHtml(html, htmlStats);

    debug.attempts.push({
      stage: 'senate.html',
      status: fromHtml.length ? 'ok' : 'empty',
      rawCount: htmlStats.rawCount,
      parsedCount: htmlStats.parsedCount,
      tableCount: htmlStats.tableCount,
      rowCount: htmlStats.rowCount,
      dropReasons: htmlStats.dropReasons
    });

    if (fromHtml.length) {
      debug.source = 'senate.html';
      return { records: fromHtml, debug };
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      debug.attempts.push({
        stage: 'senate.html',
        status: 'missing'
      });
    } else {
      debug.attempts.push({
        stage: 'senate.html',
        status: 'error',
        message: error.message
      });
      throw error;
    }
  }

  const fallback = await loadExistingDocsRecords('senate', {
    branch: 'Senate',
    idPrefix: 'senate-fallback',
    source: SENATE_SOURCE,
  });

  if (fallback.length) {
    console.warn(`[senate] Using fallback data from docs/data/senate.json (${fallback.length} records)`);
    debug.source = 'docs/data/senate.json';
    debug.attempts.push({
      stage: 'docs/data/senate.json',
      status: 'ok',
      parsedCount: fallback.length
    });
    debug.warnings.push(`Using fallback data from docs/data/senate.json (${fallback.length} records)`);
    return { records: fallback, debug };
  }

  debug.attempts.push({
    stage: 'docs/data/senate.json',
    status: 'empty',
    parsedCount: 0
  });

  return { records: [], debug };
}

function decorateRecords(records) {
  return records.map((record) => ({
    ...record,
    isoDate: record.isoDate || toIso(record.date, record.time),
    searchText: [
      record.branch,
      record.committee,
      record.venue,
      record.agenda,
      record.status,
      record.notes
    ]
      .map(norm)
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }));
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    if (a.isoDate && b.isoDate) {
      if (a.isoDate < b.isoDate) return -1;
      if (a.isoDate > b.isoDate) return 1;
    }
    if (!a.isoDate && b.isoDate) return 1;
    if (a.isoDate && !b.isoDate) return -1;
    return a.committee.localeCompare(b.committee);
  });
}

async function ensureDocsStructure() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function main() {
  await ensureDocsStructure();

  const house = decorateRecords(await loadHouseRecords());
  const { records: senateRecords, debug: senateDebug } = await loadSenateRecords();
  const senate = decorateRecords(senateRecords);
  const combined = sortRecords([...house, ...senate]);

  const metadata = {
    generatedAt: new Date().toISOString(),
    counts: {
      house: house.length,
      senate: senate.length,
      all: combined.length
    },
    sources: {
      house: HOUSE_SOURCE,
      senate: SENATE_SOURCE
    }
  };

  await writeJson(path.join(DATA_DIR, 'house.json'), house);
  await writeJson(path.join(DATA_DIR, 'senate.json'), senate);
  await writeJson(path.join(DATA_DIR, 'all.json'), combined);
  await writeJson(path.join(DATA_DIR, 'metadata.json'), metadata);
  await writeJson(path.join(DATA_DIR, 'senate-debug.json'), {
    ...senateDebug,
    parsedCount: senate.length,
    preview: senate.slice(0, 5)
  });

  console.log(`Static data generated. House=${house.length}, Senate=${senate.length}, Total=${combined.length}`);
}

main().catch((error) => {
  console.error('[build-static-data] failed', error);
  process.exitCode = 1;
});
