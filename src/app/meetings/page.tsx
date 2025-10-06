import { loadEvents } from '@/lib/load-events';
import { MeetingsBrowser } from '@/components/meetings/meetings-browser';

export const dynamic = 'force-static';

export default async function MeetingsPage() {
  const meetings = await loadEvents();
  const now = Date.now();

  return (
    <div className="bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Committee Meetings
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Schedules for the House of Representatives and the Senate.
          </p>
        </header>

        <MeetingsBrowser meetings={meetings} now={now} />
      </div>
    </div>
  );
}
