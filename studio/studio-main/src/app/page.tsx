import { CalendarView } from '@/components/calendar/calendar-view';
import type { Event } from '@/lib/types';
import eventData from '@/lib/events.json';

export default function HomePage() {
  const allEvents: Event[] = eventData.events;

  return (
    <div className="h-full">
      <CalendarView events={allEvents} />
    </div>
  );
}
