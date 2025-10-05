import { promises as fs } from 'fs';
import path from 'path';
import { cache } from 'react';

import type { Event, EventBranch } from './types';

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

const DATA_FILE_PATH = path.join(
  process.cwd(),
  '..',
  '..',
  'docs',
  'data',
  'all.json'
);

function normalizeBranch(branch?: string): EventBranch | null {
  if (!branch) return null;
  const normalized = branch.trim().toLowerCase();
  if (normalized === 'senate') return 'Senate';
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

async function readRawEvents(): Promise<RawRecord[]> {
  try {
    const content = await fs.readFile(DATA_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(content) as RawRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[load-events] Failed to read data file', error);
    return [];
  }
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
  return sortEvents(mapped);
});

export const loadUpcomingEvents = cache(async (): Promise<Event[]> => {
  const events = await loadEvents();
  const now = Date.now();
  return events.filter((event) => {
    if (!event.isoDate) return false;
    const timestamp = Date.parse(event.isoDate);
    return Number.isNaN(timestamp) ? false : timestamp >= now - 1000 * 60 * 60 * 24;
  });
});
