import { MeetingCard } from '@/components/meetings/meeting-card';
import { loadUpcomingEvents } from '@/lib/load-events';

export const dynamic = 'force-static';

export default async function MeetingsPage() {
  const meetings = await loadUpcomingEvents();

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

        {meetings.length > 0 ? (
          <div className="space-y-6">
            {meetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No upcoming meetings found in the generated data.</p>
        )}
      </div>
    </div>
  );
}
