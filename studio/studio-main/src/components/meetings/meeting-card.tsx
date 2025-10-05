'use client';

import type { Event } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import EventIcon from '@/components/icons/event-icon';

interface MeetingCardProps {
  meeting: Event;
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  // We add T00:00:00 to ensure the date is parsed in the local timezone
  const eventDate = new Date(`${meeting.date}T00:00:00`);

  // More robust date parsing
  let parsedDate;
  if (meeting.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    // Matches YYYY-MM-DD
    parsedDate = new Date(`${meeting.date}T00:00:00`);
  } else {
    // Attempts to parse other formats
    parsedDate = new Date(meeting.date);
  }

  const meetingDate = isValid(parsedDate) ? parsedDate : new Date();

  function isValid(date: Date) {
    return !isNaN(date.getTime());
  }

  return (
    <Card className="overflow-hidden shadow-md hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="bg-muted/30 border-b border-border p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <CardTitle className="text-xl font-bold text-foreground leading-tight">
            {meeting.title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 md:p-6 grid gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="flex items-start gap-3">
            <EventIcon
              category={meeting.category}
              className="h-5 w-5 mt-0.5 text-accent flex-shrink-0"
            />
            <div>
              <p className="font-semibold text-foreground">
                {meeting.branch || 'General'}
              </p>
              <p className="text-muted-foreground">
                {format(meetingDate, 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-foreground mb-2">
            Agenda / Description
          </h4>
          <div className="prose prose-sm max-w-none text-muted-foreground space-y-2">
            {meeting.description
              .split('•')
              .filter((item) => item.trim())
              .map(
                (item, index) =>
                  item.trim() && (
                    <p key={index} className="leading-relaxed">
                      {item.trim()}
                    </p>
                  )
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
