export type EventCategory =
  | 'work'
  | 'social'
  | 'birthday'
  | 'personal'
  | 'health'
  | 'senate'
  | 'house';

export interface Event {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD or other valid date string
  description: string;
  category: EventCategory;
  branch?: 'Senate' | 'House of Representatives';
}
