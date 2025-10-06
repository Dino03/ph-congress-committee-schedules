import { promises as fs } from 'fs';
import path from 'path';
import { cache } from 'react';

import type { Event, EventBranch } from './types';
import { fixedEvents } from './fixed-events';

interface RawRecord {
  id?: string;
  branch?: string;
  committee?: string;
  date?: string;
  time?: string;
  venue?: string;
  agenda?: string;
  status?: string;
  notes?: string;
  isoDate?: string;
  source?: string;
}

type ChamberDefaults = {
  branch: EventBranch;
  source?: string;
  idPrefix: string;
};

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');
const DATA_FILE_PATH = path.join(DATA_DIR, 'all.json');
const HOUSE_FILE_PATH = path.join(DATA_DIR, 'house.json');
const SENATE_FILE_PATH = path.join(DATA_DIR, 'senate.json');
const UPCOMING_WINDOW_MS = 1000 * 60 * 60 * 24;

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function normalizeBranch(branch?: string): EventBranch | null {
  if (!branch) return null;
  const normalized = branch.trim().toLowerCase();
  if (normalized === 'senate' || normalized.startsWith('senate ')) return 'Senate';
  if (normalized.startsWith('house')) return 'House of Representatives';
  return null;
}

function coerceIsoDate(record: RawRecord): string | null {
  if (record.isoDate && record.isoDate.trim()) return record.isoDate.trim();
  if (record.date && /^\d{4}-\d{2}-\d{2}$/.test(record.date.trim())) {
    return `${record.date.trim()}T00:00:00`;
  }
  return null;
}

function normalizeText(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function applyChamberDefaults(
  records: RawRecord[],
  { branch, idPrefix, source }: ChamberDefaults
): RawRecord[] {
  return records.map((record, index) => {
    const result: RawRecord = { ...record };
    if (!hasMeaningfulValue(result.branch)) {
      result.branch = branch;
    }
    if (!hasMeaningfulValue(result.source) && source) {
      result.source = source;
    }
    if (!hasMeaningfulValue(result.id)) {
      result.id = `${idPrefix}-${index + 1}`;
    }
    return result;
  });
}

function mergeRecord(primary: RawRecord, fallback: RawRecord): RawRecord {
  const merged: RawRecord = { ...primary };
  const keys = new Set<keyof RawRecord>(
    [...Object.keys(fallback), ...Object.keys(primary)] as (keyof RawRecord)[]
  );
  for (const key of keys) {
    const primaryValue = merged[key];
    if (hasMeaningfulValue(primaryValue)) {
      continue;
    }
    const fallbackValue = fallback[key];
    if (hasMeaningfulValue(fallbackValue)) {
      merged[key] = fallbackValue;
    }
  }
  return merged;
}

function getRecordKey(record: RawRecord): string {
  if (hasMeaningfulValue(record.id)) {
    return (record.id as string).toLowerCase();
  }

  const branch = normalizeBranch(record.branch) ?? 'unknown-branch';
  const committee = normalizeText(record.committee) || 'unknown-committee';
  const date = normalizeText(record.date) || 'unknown-date';
  return `${branch}:${committee}:${date}`.toLowerCase();
}

function mergeRecords(baseRecords: RawRecord[], fallbackRecords: RawRecord[]): RawRecord[] {
  const merged = new Map<string, RawRecord>();

  for (const record of baseRecords) {
    merged.set(getRecordKey(record), { ...record });
  }

  for (const record of fallbackRecords) {
    const key = getRecordKey(record);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, mergeRecord(existing, record));
    } else {
      merged.set(key, { ...record });
    }
  }

  return Array.from(merged.values());
}

function mapRecord(record: RawRecord): Event | null {
  const branch = normalizeBranch(record.branch);
  const committee = normalizeText(record.committee);
  const date = normalizeText(record.date);
  const isoDate = coerceIsoDate(record);

  if (!branch || !committee || !date || !isoDate) {
    return null;
  }

  return {
    id: record.id ?? `${branch.toLowerCase().replace(/\s+/g, '-')}-${committee}`,
    branch,
    committee,
    date,
    time: normalizeText(record.time),
    venue: normalizeText(record.venue),
    agenda: normalizeText(record.agenda),
    status: normalizeText(record.status) || 'Scheduled',
    notes: normalizeText(record.notes),
    isoDate,
    source: normalizeText(record.source) || 'Philippine Congress',
  };
}

async function readRecordsFromFile(filePath: string): Promise<RawRecord[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as RawRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`[load-events] Failed to read data file at ${filePath}`, error);
    return [];
  }
}

function containsBranch(records: RawRecord[], branch: EventBranch): boolean {
  return records.some((record) => normalizeBranch(record.branch) === branch);
}

async function readRawEvents(): Promise<RawRecord[]> {
  const [allRecords, houseRecordsRaw, senateRecordsRaw] = await Promise.all([
    readRecordsFromFile(DATA_FILE_PATH),
    readRecordsFromFile(HOUSE_FILE_PATH),
    readRecordsFromFile(SENATE_FILE_PATH),
  ]);

  const houseRecords = applyChamberDefaults(houseRecordsRaw, {
    branch: 'House of Representatives',
    idPrefix: 'house',
    source: 'House of Representatives',
  });

  const senateRecords = applyChamberDefaults(senateRecordsRaw, {
    branch: 'Senate',
    idPrefix: 'senate',
    source: 'Senate Weekly Schedule',
  });

  const combined = mergeRecords(allRecords, [...houseRecords, ...senateRecords]);

  if (
    !containsBranch(combined, 'House of Representatives') ||
    !containsBranch(combined, 'Senate')
  ) {
    console.warn('[load-events] Missing branch data after merge', {
      houseCount: houseRecords.length,
      senateCount: senateRecords.length,
      mergedCount: combined.length,
    });
  }

  return combined;
}

function sortEvents(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    if (a.isoDate && b.isoDate && a.isoDate !== b.isoDate) {
      return a.isoDate.localeCompare(b.isoDate);
    }
    if (a.time && b.time && a.time !== b.time) {
      return a.time.localeCompare(b.time);
    }
    return a.committee.localeCompare(b.committee);
  });
}

export const loadEvents = cache(async (): Promise<Event[]> => {
  const raw = await readRawEvents();
  const mapped = raw
    .map(mapRecord)
    .filter((event): event is Event => event !== null);
  return sortEvents([...mapped, ...fixedEvents]);
});

export function isUpcomingEvent(event: Event, now: number = Date.now()): boolean {
  if (!event.isoDate) return false;
  const timestamp = Date.parse(event.isoDate);
  if (Number.isNaN(timestamp)) return false;
  return timestamp >= now - UPCOMING_WINDOW_MS;
}

export const loadUpcomingEvents = cache(async (): Promise<Event[]> => {
  const events = await loadEvents();
  const now = Date.now();
  return events.filter((event) => isUpcomingEvent(event, now));
});
