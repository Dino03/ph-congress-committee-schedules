import { MeetingCard } from '@/components/meetings/meeting-card';
import type { Event } from '@/lib/types';
import eventData from '@/lib/events.json';

export default function MeetingsPage() {
  const meetings: Event[] = eventData.events
    .filter((e) => e.category === 'senate' || e.category === 'house')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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

        <div className="space-y-6">
          {meetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      </div>
    </div>
  );
}
