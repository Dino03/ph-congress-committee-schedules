'use client';

import type { Event } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import EventIcon from '@/components/icons/event-icon';
import { format } from 'date-fns';
import { Separator } from '../ui/separator';

interface EventDetailsProps {
  event: Event | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EventDetails({ event, isOpen, onClose }: EventDetailsProps) {
  if (!event) return null;

  // We add T00:00:00 to ensure the date is parsed in the local timezone
  const eventDate = new Date(`${event.date}T00:00:00`);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-card rounded-xl">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-full">
              <EventIcon category={event.category} className="h-6 w-6 text-accent" />
            </div>
            <DialogTitle className="text-2xl font-headline text-foreground">{event.title}</DialogTitle>
          </div>
        </DialogHeader>
        <Separator />
        <div className="space-y-4 py-4">
            <p className="text-muted-foreground font-semibold">
                {format(eventDate, 'EEEE, MMMM d, yyyy')}
            </p>
            <p className="text-foreground/90 leading-relaxed">{event.description}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
