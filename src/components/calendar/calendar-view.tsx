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
import { getEventColors } from '@/lib/event-colors';
import { EventDetails } from './event-details';
import EventIcon from '../icons/event-icon';
import { DayEventsDialog } from './day-events-dialog';

interface CalendarViewProps {
  events: Event[];
}

export function CalendarView({ events }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [expandedDay, setExpandedDay] = useState<{ date: Date; events: Event[] } | null>(null);

  const firstDayOfMonth = startOfMonth(currentDate);
  const lastDayOfMonth = endOfMonth(currentDate);

  const daysInMonth = eachDayOfInterval({
    start: startOfWeek(firstDayOfMonth),
    end: endOfWeek(lastDayOfMonth),
  });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const eventsByDate = useMemo(() => {
    return events.reduce((acc: Record<string, Event[]>, event) => {
      if (!event.isoDate) return acc;
      const parsedDate = parseISO(event.isoDate);
      if (!isValid(parsedDate)) return acc;
      const dateKey = format(parsedDate, 'yyyy-MM-dd');
      acc[dateKey] = acc[dateKey] ? [...acc[dateKey], event] : [event];
      return acc;
    }, {} as Record<string, Event[]>);
  }, [events]);

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
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
              const sortedDayEvents = [...dayEvents].sort((a, b) =>
                (a.isoDate || '').localeCompare(b.isoDate || '')
              );
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
                    {sortedDayEvents
                      .slice(0, 2)
                      .map((event) => {
                        const colors = getEventColors(event);
                        return (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEvent(event)}
                            className={cn(
                              'w-full text-left p-1.5 rounded-lg transition-colors',
                              colors.itemBg,
                              colors.itemHoverBg
                            )}
                            aria-label={`View event: ${event.committee}`}
                          >
                            <div className="flex items-center gap-1.5">
                              <EventIcon
                                branch={event.branch}
                                className={cn('h-3 w-3 flex-shrink-0', colors.icon)}
                              />
                              <span className={cn('text-[11px] font-medium truncate', colors.itemText)}>
                                {event.time ? `${event.time} · ` : ''}
                                {event.committee}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    {sortedDayEvents.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setExpandedDay({ date: day, events: sortedDayEvents })}
                        className="mt-1 pl-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
                        aria-label={`View ${sortedDayEvents.length - 2} more events on ${format(day, 'MMMM d, yyyy')}`}
                      >
                        + {sortedDayEvents.length - 2} more
                      </button>
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
      <DayEventsDialog
        date={expandedDay?.date ?? null}
        events={expandedDay?.events ?? []}
        isOpen={!!expandedDay}
        onClose={() => setExpandedDay(null)}
        onSelectEvent={(event) => {
          setSelectedEvent(event);
          setExpandedDay(null);
        }}
      />
    </div>
  );
}
