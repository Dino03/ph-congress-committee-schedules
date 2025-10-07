'use client';

import { format } from 'date-fns';
import type { Event } from '@/lib/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import EventIcon from '@/components/icons/event-icon';

interface DayEventsDialogProps {
  date: Date | null;
  events: Event[];
  isOpen: boolean;
  onClose: () => void;
  onSelectEvent: (event: Event) => void;
}

export function DayEventsDialog({ date, events, isOpen, onClose, onSelectEvent }: DayEventsDialogProps) {
  if (!date) return null;

  const formattedDate = format(date, 'EEEE, MMMM d, yyyy');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px] bg-card rounded-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl font-headline text-foreground">Meetings on {formattedDate}</DialogTitle>
          <p className="text-sm text-muted-foreground">Select a meeting to view full details.</p>
        </DialogHeader>
        <Separator />
        <div className="space-y-3 py-4">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => {
                onSelectEvent(event);
              }}
              className="w-full text-left rounded-lg border border-border bg-muted/30 hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <div className="flex flex-col gap-2 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <EventIcon branch={event.branch} className="h-4 w-4 text-accent" />
                    <Badge variant="secondary" className="w-fit">
                      {event.branch}
                    </Badge>
                  </div>
                  {event.time && <span className="text-xs text-muted-foreground">{event.time}</span>}
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">{event.committee}</p>
                  {event.venue && <p className="text-xs text-muted-foreground">Venue: {event.venue}</p>}
                  {event.agenda && <p className="text-xs text-muted-foreground line-clamp-2">Agenda: {event.agenda}</p>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
