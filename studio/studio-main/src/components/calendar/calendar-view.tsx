'use client';

import { useState, useMemo } from 'react';
import {
  addMonths,
  subMonths,
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  parseISO,
  isValid,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Event } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EventDetails } from './event-details';
import EventIcon from '../icons/event-icon';

interface CalendarViewProps {
  events: Event[];
}

export function CalendarView({ events }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const firstDayOfMonth = startOfMonth(currentDate);
  const lastDayOfMonth = endOfMonth(currentDate);

  const daysInMonth = eachDayOfInterval({
    start: startOfWeek(firstDayOfMonth),
    end: endOfWeek(lastDayOfMonth),
  });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const eventsByDate = useMemo(() => {
    return events.reduce((acc: { [key: string]: Event[] }, event) => {
      const parsedDate = parseISO(event.date);
      if (!isValid(parsedDate)) {
        // Handle cases where event.date is not a valid ISO string like '2024-08-15'
        // For example, if it's "Tuesday, October 7, 2025", we need to parse it differently
        // For now, we will skip invalid dates to prevent crashes
        return acc;
      }
      const dateKey = format(parsedDate, 'yyyy-MM-dd');
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(event);
      return acc;
    }, {});
  }, [events]);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto bg-card p-6 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-headline font-bold text-foreground">
            {format(currentDate, 'MMMM yyyy')}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth} aria-label="Next month">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div key={currentDate.toISOString()} className="animate-in fade-in duration-500">
          <div className="grid grid-cols-7 gap-px border-l border-t border-border bg-border">
            {weekdays.map((day) => (
              <div key={day} className="text-center font-semibold text-muted-foreground py-3 bg-card text-sm">
                {day}
              </div>
            ))}

            {daysInMonth.map((day) => {
              const dayEvents = eventsByDate[format(day, 'yyyy-MM-dd')] || [];
              return (
                <div
                  key={day.toString()}
                  className={cn(
                    'relative min-h-[120px] p-2 bg-card border-r border-b border-border transition-colors',
                    !isSameMonth(day, currentDate) && 'bg-muted/50'
                  )}
                >
                  <time
                    dateTime={format(day, 'yyyy-MM-dd')}
                    className={cn(
                      'h-8 w-8 flex items-center justify-center rounded-full text-sm',
                      isToday(day) && 'bg-accent text-accent-foreground font-bold',
                      !isSameMonth(day, currentDate) && 'text-muted-foreground'
                    )}
                  >
                    {format(day, 'd')}
                  </time>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 2).map((event) => (
                      <button
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className="w-full text-left p-1.5 rounded-lg bg-primary/30 hover:bg-primary/50 transition-colors"
                        aria-label={`View event: ${event.title}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <EventIcon category={event.category} className="h-3 w-3 text-accent flex-shrink-0" />
                          <span className="text-xs font-medium text-accent truncate">
                            {event.title}
                          </span>
                        </div>
                      </button>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-xs text-muted-foreground mt-1 pl-1.5">
                        + {dayEvents.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <EventDetails
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
