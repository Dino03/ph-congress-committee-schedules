import { CalendarView } from '@/components/calendar/calendar-view';
import { loadEvents } from '@/lib/load-events';

export default async function HomePage() {
  const events = await loadEvents();

  return (
    <div className="h-full">
      <CalendarView events={events} />
    </div>
  );
}
