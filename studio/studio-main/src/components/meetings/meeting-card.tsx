
import type { Event } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import EventIcon from '@/components/icons/event-icon';

interface MeetingCardProps {
  meeting: Event;
}

export function MeetingCard({ meeting }: MeetingCardProps) {
  const dateSource = meeting.isoDate ?? (meeting.date ? `${meeting.date}T00:00:00` : '');
  const parsedDate = dateSource ? new Date(dateSource) : null;
  const hasValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());
  const formattedDate = hasValidDate
    ? format(parsedDate!, 'EEEE, MMMM d, yyyy • h:mm aaa')
    : meeting.date || 'Date to be determined';

  const agendaItems = meeting.agenda
    ? meeting.agenda
        .split(/(?:•|;)/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return (
    <Card className="overflow-hidden shadow-md hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="bg-muted/30 border-b border-border p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-2">
            <Badge variant="secondary" className="w-fit">
              {meeting.branch}
            </Badge>
            <CardTitle className="text-xl font-bold text-foreground leading-tight">
              {meeting.committee}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <EventIcon branch={meeting.branch} className="h-5 w-5" />
            <span>{meeting.source}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 md:p-6 grid gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="flex items-start gap-3">
            <EventIcon branch={meeting.branch} className="h-5 w-5 mt-0.5 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold text-foreground">
                {meeting.branch}
              </p>
              <p className="text-muted-foreground">{formattedDate}</p>
              <p className="text-muted-foreground">
                {meeting.venue ? `Venue: ${meeting.venue}` : 'Venue to be determined'}
              </p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-foreground mb-2">
            Agenda / Description
          </h4>
          {agendaItems.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {agendaItems.map((item, index) => (
                <li key={`${meeting.id}-agenda-${index}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Agenda to follow.</p>
          )}

          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            <p>Status: {meeting.status || 'Scheduled'}</p>
            {meeting.notes && <p>Notes: {meeting.notes}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
