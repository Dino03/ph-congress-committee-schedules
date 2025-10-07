import type { Event } from './types';

type LegislativePeriod = {
  id: string;
  label: string;
  start: string;
  end: string;
  note?: string;
};

const periods: LegislativePeriod[] = [
  {
    id: 'legislative-calendar-2025-commencement',
    label: 'Commencement of Session',
    start: '2025-07-28',
    end: '2025-10-10',
  },
  {
    id: 'legislative-calendar-2025-first-adjournment',
    label: 'Adjournment of Session',
    start: '2025-10-11',
    end: '2025-11-09',
  },
  {
    id: 'legislative-calendar-2025-first-resumption',
    label: 'Resumption of Session',
    start: '2025-11-10',
    end: '2025-12-19',
  },
  {
    id: 'legislative-calendar-2025-second-adjournment',
    label: 'Adjournment of Session',
    start: '2025-12-20',
    end: '2026-01-18',
  },
  {
    id: 'legislative-calendar-2026-second-resumption',
    label: 'Resumption of Session',
    start: '2026-01-19',
    end: '2026-03-20',
  },
  {
    id: 'legislative-calendar-2026-third-adjournment',
    label: 'Adjournment of Session',
    start: '2026-03-21',
    end: '2026-05-03',
  },
  {
    id: 'legislative-calendar-2026-third-resumption',
    label: 'Resumption of Session',
    start: '2026-05-04',
    end: '2026-06-05',
    note: 'Sine die adjournment.',
  },
  {
    id: 'legislative-calendar-2026-final-adjournment',
    label: 'Adjournment of Session',
    start: '2026-06-06',
    end: '2026-07-26',
  },
];

function formatDateRange(start: Date, end: Date): string {
  const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
  const fullFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
  const yearFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });

  const startYear = yearFormatter.format(start);
  const endYear = yearFormatter.format(end);
  const sameYear = startYear === endYear;
  if (sameYear) {
    const startText = monthDayFormatter.format(start);
    const endText = monthDayFormatter.format(end);
    return `${startText} – ${endText}, ${endYear}`;
  }

  const startText = fullFormatter.format(start);
  const endText = fullFormatter.format(end);
  return `${startText} – ${endText}`;
}

function createLegislativeCalendarEvent(period: LegislativePeriod): Event {
  const startDate = new Date(`${period.start}T00:00:00Z`);
  const endDate = new Date(`${period.end}T00:00:00Z`);

  const rangeDisplay = formatDateRange(startDate, endDate);
  const notes = [`Session period: ${rangeDisplay}.`, 'Applies to both the House and the Senate.'];
  if (period.note) {
    notes.push(period.note);
  }

  return {
    id: period.id,
    branch: 'House of Representatives',
    committee: 'Joint Session of Congress',
    date: rangeDisplay,
    time: 'All day',
    venue: 'Philippine Congress',
    agenda: period.label,
    status: 'Scheduled',
    notes: notes.join(' '),
    isoDate: `${period.start}T12:00:00Z`,
    source: 'Official Legislative Calendar',
  };
}

export const fixedEvents: Event[] = periods.map(createLegislativeCalendarEvent);
