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
const SENATE_HISTORY_FILE = path.join(DATA_DIR, 'senate-history.json');

const HOUSE_SOURCE = 'House of Representatives (API)';
const SENATE_SOURCE = 'Senate Weekly Schedule';

function norm(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u00A0/g, ' ').replace(/[\s\u200B]+/g, ' ').trim();
}

function parseClock(value) {
  const normalized = norm(value);
  if (!normalized) return '';

  const cleaned = normalized
    .replace(/[()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/a\.m\.|p\.m\./gi, (match) => match.toUpperCase().replace(/\./g, ''));

  return cleaned.replace(/\s+/g, ' ').trim();
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

function parseSenateDate(headerText, fallbackYear = '') {
  const cleaned = norm(headerText)
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/\bWeek of\b/i, '')
    .replace(/\bWeek\s+\d+\b/i, '')
    .trim();
  if (!cleaned) return '';

  const dropWeekday = cleaned.replace(/^[A-Z]+,?\s+/i, '');
  const match = dropWeekday.match(/([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (!match) return '';
  const [, monthName, day, yearRaw] = match;
  const year = yearRaw || fallbackYear;
  if (!year) return '';
  const parsed = new Date(`${monthName} ${day}, ${year}`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function extractYearFromRecord(record) {
  const candidates = [record.isoDate, record.capturedAt, record.firstSeenAt, record.lastSeenAt];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    const isoMatch = trimmed.match(/^(\d{4})/);
    if (isoMatch) {
      return isoMatch[1];
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return String(parsed.getFullYear());
    }
  }
  return '';
}

function normalizeSenateDate(record) {
  const fallbackYear = extractYearFromRecord(record);
  const direct = norm(record.date || '');
  if (direct && /^\d{4}-\d{2}-\d{2}$/.test(direct)) {
    return direct;
  }

  const fromDirect = direct ? parseSenateDate(direct, fallbackYear) : '';
  if (fromDirect) return fromDirect;

  const label = norm(record.dateLabel || record.displayDate || '');
  if (label && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
    return label;
  }

  const fromLabel = label ? parseSenateDate(label, fallbackYear) : '';
  if (fromLabel) return fromLabel;

  return direct;
}

function htmlToText(html) {
  const fragment = cheerio.load(`<div>${html}</div>`);
  return norm(fragment('div').text());
}

function deriveSenateRecordsFromHtml(html) {
  const $ = cheerio.load(html);
  const tables = $('div[align="center"] > table[width="98%"].grayborder');
  const records = [];

  tables.each((_, table) => {
    const $table = $(table);
    const rows = $table.find('tr');
    if (rows.length < 3) return;

    const dayHeader = norm($(rows[0]).find('td').first().text());
    const isoDate = parseSenateDate(dayHeader);

    for (let index = 2; index < rows.length; index += 1) {
      const cells = $(rows[index]).find('td');
      if (cells.length < 3) continue;

      const committee = norm($(cells[0]).text());
      if (!committee || /no committee hearing/i.test(committee)) continue;

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

      if (!isoDate || !time || !committee) continue;

      records.push({
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
      });
    }
  });

  const deduped = [];
  const seen = new Set();
  for (const record of records) {
    const key = `${record.date}|${record.time}|${record.committee}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function deriveSenateRecords(data) {
  if (Array.isArray(data) && data.length > 0) {
    return data
      .map((item, index) => ({
        id: `senate-${item.id || index + 1}`,
        branch: 'Senate',
        committee: norm(item.committee || item.title || ''),
        date: normalizeSenateDate(item),
        time: parseClock(item.time || ''),
        venue: norm(item.venue || ''),
        agenda: norm(item.agenda || item.subject || ''),
        status: norm(item.status || 'Scheduled') || 'Scheduled',
        notes: norm(item.notes || ''),
        isoDate: toIso(normalizeSenateDate(item), parseClock(item.time || '')),
        source: SENATE_SOURCE,
        dateLabel: norm(item.dateLabel || item.displayDate || ''),
        capturedAt: item.capturedAt || ''
      }))
      .filter((item) => item.date && item.time && item.committee);
  }
  return [];
}

function senateHistoryKey(record) {
  const committee = norm(record.committee || '');
  const time = parseClock(record.time || '');
  const iso = record.isoDate || toIso(normalizeSenateDate(record), time);
  if (!committee || !time) return '';
  if (iso) {
    return `${iso.slice(0, 10)}|${time}|${committee}`.toLowerCase();
  }

  const fallbackDate = norm(record.date || record.dateLabel || '');
  if (!fallbackDate) return '';
  return `${fallbackDate}|${time}|${committee}`.toLowerCase();
}

function mergeSenateHistory(current, previous = []) {
  const now = new Date().toISOString();
  const map = new Map();

  const ingest = (record, seenAt) => {
    const committee = norm(record.committee || '');
    const time = parseClock(record.time || '');
    const venue = norm(record.venue || '');
    const agenda = norm(record.agenda || '');
    const notes = norm(record.notes || '');
    const status = norm(record.status || 'Scheduled') || 'Scheduled';
    const dateLabel = norm(record.dateLabel || record.displayDate || '');
    const normalizedDate = normalizeSenateDate(record);
    const iso = record.isoDate || toIso(normalizedDate, time);
    if (!committee || !time) return;

    const key = senateHistoryKey({ ...record, committee, time, isoDate: iso });
    if (!key) return;
    const existing = map.get(key);

    const base = {
      ...record,
      committee,
      time,
      venue,
      agenda,
      notes,
      status,
      isoDate: iso || '',
      date: iso ? iso.slice(0, 10) : normalizedDate || norm(record.date || record.dateLabel || ''),
      dateLabel,
      source: record.source || SENATE_SOURCE,
      capturedAt: record.capturedAt || seenAt || now
    };

    const firstSeen = record.firstSeenAt || seenAt || now;
    const lastSeen = record.lastSeenAt || seenAt || now;

    if (!existing) {
      map.set(key, {
        ...base,
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen
      });
      return;
    }

    const merged = {
      ...existing,
      ...base,
      agenda: base.agenda || existing.agenda,
      notes: base.notes || existing.notes,
      dateLabel: base.dateLabel || existing.dateLabel,
      capturedAt: base.capturedAt || existing.capturedAt,
      firstSeenAt:
        existing.firstSeenAt && existing.firstSeenAt < firstSeen ? existing.firstSeenAt : firstSeen,
      lastSeenAt:
        existing.lastSeenAt && existing.lastSeenAt > lastSeen ? existing.lastSeenAt : lastSeen
    };

    map.set(key, merged);
  };

  previous.forEach((record) => {
    const seenAt = record.lastSeenAt || record.capturedAt || record.firstSeenAt || now;
    ingest(record, seenAt);
  });

  current.forEach((record) => {
    ingest(record, now);
  });

  return Array.from(map.values()).map((record) => ({
    ...record,
    firstSeenAt: record.firstSeenAt || now,
    lastSeenAt: record.lastSeenAt || now
  }));
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
  const senatePath = path.join(OUTPUT_DIR, 'senate.json');
  const senateJson = await readJson(senatePath);
  const fromJson = deriveSenateRecords(senateJson);
  if (fromJson.length) return fromJson;

  try {
    const senateHtmlPath = path.join(OUTPUT_DIR, 'senate.html');
    const html = await fs.readFile(senateHtmlPath, 'utf-8');
    return deriveSenateRecordsFromHtml(html);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return [];
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

  const houseRaw = await loadHouseRecords();
  const senateCurrentRaw = await loadSenateRecords();
  const existingSenateHistory = (await readJson(SENATE_HISTORY_FILE)) || [];
  const senateHistoryRaw = mergeSenateHistory(
    senateCurrentRaw,
    Array.isArray(existingSenateHistory) ? existingSenateHistory : []
  );

  const house = sortRecords(decorateRecords(houseRaw));
  const senate = sortRecords(decorateRecords(senateHistoryRaw));
  const combined = sortRecords([...house, ...senate]);

  const senateFirstSeen = senate.reduce((min, record) => {
    if (!record.firstSeenAt) return min;
    if (!min) return record.firstSeenAt;
    return record.firstSeenAt < min ? record.firstSeenAt : min;
  }, '');

  const senateLastSeen = senate.reduce((max, record) => {
    if (!record.lastSeenAt) return max;
    if (!max) return record.lastSeenAt;
    return record.lastSeenAt > max ? record.lastSeenAt : max;
  }, '');

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
    },
    history: {
      senate: {
        entries: senate.length,
        firstSeenAt: senateFirstSeen || null,
        lastSeenAt: senateLastSeen || null
      }
    }
  };

  await writeJson(path.join(DATA_DIR, 'house.json'), house);
  await writeJson(path.join(DATA_DIR, 'senate.json'), senate);
  await writeJson(path.join(DATA_DIR, 'all.json'), combined);
  await writeJson(SENATE_HISTORY_FILE, senate);
  await writeJson(path.join(DATA_DIR, 'metadata.json'), metadata);

  console.log(`Static data generated. House=${house.length}, Senate=${senate.length}, Total=${combined.length}`);
}

main().catch((error) => {
  console.error('[build-static-data] failed', error);
  process.exitCode = 1;
});
