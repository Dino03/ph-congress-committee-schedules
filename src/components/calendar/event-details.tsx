'use client';

import type { Event } from '@/lib/types';
import { getEventColors, getEventCategoryLabel } from '@/lib/event-colors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EventIcon from '@/components/icons/event-icon';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';

interface EventDetailsProps {
  event: Event | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EventDetails({ event, isOpen, onClose }: EventDetailsProps) {
  if (!event) return null;

  const colors = getEventColors(event);
  const label = getEventCategoryLabel(event);

  const dateSource = event.isoDate ?? (event.date ? `${event.date}T00:00:00` : '');
  const parsedDate = dateSource ? new Date(dateSource) : null;
  const hasValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());
  const formattedDate = hasValidDate
    ? format(parsedDate!, 'EEEE, MMMM d, yyyy')
    : event.date || 'Date to be determined';

  const timeLabel = event.time || (hasValidDate ? format(parsedDate!, 'h:mm aaa') : 'Time to be determined');
  const venueLabel = event.venue || 'Venue to be determined';

  const agendaItems = event.agenda
    ? event.agenda
        .split(/(?:•|;)/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card rounded-xl">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className={cn(colors.detailIconBg, 'p-3 rounded-full')}>
              <EventIcon branch={event.branch} className={cn('h-6 w-6', colors.detailIconText)} />
            </div>
            <div className="space-y-1">
              <Badge
                variant="secondary"
                className={cn('w-fit', colors.badgeBg, colors.badgeText, colors.badgeBorder)}
              >
                {label}
              </Badge>
              <DialogTitle className="text-2xl font-headline text-foreground">
                {event.committee}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>
        <Separator />
        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <p className="text-muted-foreground font-semibold">{formattedDate}</p>
            <p className="text-sm text-muted-foreground">{timeLabel}</p>
            <p className="text-sm text-muted-foreground">{venueLabel}</p>
          </div>

          {agendaItems.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Agenda</h3>
              <ul className="list-disc pl-4 space-y-1 text-sm text-foreground/90">
                {agendaItems.map((item, index) => (
                  <li key={`${event.id}-agenda-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Agenda to follow.</p>
          )}

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Status: {event.status || 'Scheduled'}</p>
            {event.notes && <p>Notes: {event.notes}</p>}
            {event.source && <p>Source: {event.source}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
