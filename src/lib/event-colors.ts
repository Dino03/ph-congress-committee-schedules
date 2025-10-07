import type { Event } from './types';

type EventCategory = 'calendar' | 'house' | 'senate';

type EventColorTokens = {
  label: string;
  itemBg: string;
  itemHoverBg: string;
  itemText: string;
  icon: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  detailIconBg: string;
  detailIconText: string;
};

const COLOR_MAP: Record<EventCategory, EventColorTokens> = {
  calendar: {
    label: 'Legislative Calendar',
    itemBg: 'bg-amber-100',
    itemHoverBg: 'hover:bg-amber-200',
    itemText: 'text-amber-900',
    icon: 'text-amber-700',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-900',
    badgeBorder: 'border-amber-200',
    detailIconBg: 'bg-amber-100',
    detailIconText: 'text-amber-700',
  },
  house: {
    label: 'House of Representatives',
    itemBg: 'bg-emerald-100',
    itemHoverBg: 'hover:bg-emerald-200',
    itemText: 'text-emerald-900',
    icon: 'text-emerald-700',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-900',
    badgeBorder: 'border-emerald-200',
    detailIconBg: 'bg-emerald-100',
    detailIconText: 'text-emerald-700',
  },
  senate: {
    label: 'Senate',
    itemBg: 'bg-sky-100',
    itemHoverBg: 'hover:bg-sky-200',
    itemText: 'text-sky-900',
    icon: 'text-sky-700',
    badgeBg: 'bg-sky-100',
    badgeText: 'text-sky-900',
    badgeBorder: 'border-sky-200',
    detailIconBg: 'bg-sky-100',
    detailIconText: 'text-sky-700',
  },
};

function isCalendarEvent(event: Event): boolean {
  if (!event) return false;
  if (event.id.startsWith('legislative-calendar-')) return true;
  if (event.source.toLowerCase().includes('calendar')) return true;
  return false;
}

function getEventCategory(event: Event): EventCategory {
  if (isCalendarEvent(event)) return 'calendar';
  if (event.branch === 'Senate') return 'senate';
  return 'house';
}

export function getEventColors(event: Event): EventColorTokens {
  const category = getEventCategory(event);
  return COLOR_MAP[category];
}

export function getEventCategoryLabel(event: Event): string {
  return COLOR_MAP[getEventCategory(event)].label;
}
