import { CalendarView } from '@/components/calendar/calendar-view';
import { loadEvents } from '@/lib/load-events';
import type { Event } from '@/lib/types';

export const dynamic = 'force-static';

function countUpcoming(events: Event[]) {
  const now = Date.now();
  return events.filter((event) => {
    if (!event.isoDate) return false;
    const timestamp = Date.parse(event.isoDate);
    if (Number.isNaN(timestamp)) return false;
    return timestamp >= now - 1000 * 60 * 60 * 24;
  }).length;
}

export default async function HomePage() {
  const events = await loadEvents();
  const upcomingCount = countUpcoming(events);
  const houseCount = events.filter((event) => event.branch === 'House of Representatives').length;
  const senateCount = events.filter((event) => event.branch === 'Senate').length;

  return (
    <div className="bg-background min-h-screen">
      <section className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              Live committee monitoring
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Philippine Congress Committee Calendar
            </h1>
            <p className="text-base text-muted-foreground">
              View all upcoming committee hearings from the House of Representatives and the Senate in
              one place. The calendar is automatically updated whenever new schedules are released.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Upcoming (24h window)
              </dt>
              <dd className="text-2xl font-bold text-foreground">{upcomingCount}</dd>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                House hearings
              </dt>
              <dd className="text-2xl font-bold text-foreground">{houseCount}</dd>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Senate hearings
              </dt>
              <dd className="text-2xl font-bold text-foreground">{senateCount}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="bg-background">
        <CalendarView events={events} />
      </section>
    </div>
  );
}
