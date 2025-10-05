export type EventBranch = 'House of Representatives' | 'Senate';

export interface Event {
  id: string;
  branch: EventBranch;
  committee: string;
  date: string;
  time: string;
  venue: string;
  agenda: string;
  status: string;
  notes: string;
  isoDate: string;
  source: string;
}
