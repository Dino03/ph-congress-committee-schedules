import { MeetingCard } from '@/components/meetings/meeting-card';
import { isUpcomingEvent, loadEvents } from '@/lib/load-events';

export const dynamic = 'force-static';

export default async function MeetingsPage() {
  const meetings = await loadEvents();
  const now = Date.now();
  const upcomingMeetings = meetings.filter((meeting) => isUpcomingEvent(meeting, now));
  const pastMeetings = meetings
    .filter((meeting) => !isUpcomingEvent(meeting, now))
    .reverse();

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

        <div className="space-y-12">
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-4">Upcoming meetings</h2>
            {upcomingMeetings.length > 0 ? (
              <div className="space-y-6">
                {upcomingMeetings.map((meeting) => (
                  <MeetingCard key={meeting.id} meeting={meeting} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                No upcoming meetings found in the latest scrape. Recent and past meetings are listed below.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-4">Recent meetings</h2>
            {pastMeetings.length > 0 ? (
              <div className="space-y-6">
                {pastMeetings.map((meeting) => (
                  <MeetingCard key={meeting.id} meeting={meeting} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Past meetings will appear here once data is available.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
