'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { Event } from '@/lib/types';
import { MeetingCard } from './meeting-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MeetingsBrowserProps {
  meetings: Event[];
  now: number;
}

interface DateFilters {
  from?: number;
  to?: number;
}

function getUniqueValues(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function parseDateBoundary(value?: string, endOfDay = false): number | null {
  if (!value) return null;
  const isoString = endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`;
  const timestamp = Date.parse(isoString);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function matchesSearch(meeting: Event, term: string): boolean {
  if (!term) return true;
  const haystack = [
    meeting.committee,
    meeting.branch,
    meeting.agenda,
    meeting.notes,
    meeting.venue,
    meeting.status,
    meeting.source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

function isWithinRange(meeting: Event, { from, to }: DateFilters): boolean {
  if (from === undefined && to === undefined) return true;
  if (!meeting.isoDate) return false;
  const timestamp = Date.parse(meeting.isoDate);
  if (Number.isNaN(timestamp)) return false;
  if (from !== undefined && timestamp < from) return false;
  if (to !== undefined && timestamp > to) return false;
  return true;
}

function isUpcoming(event: Event, now: number): boolean {
  if (!event.isoDate) return false;
  const timestamp = Date.parse(event.isoDate);
  if (Number.isNaN(timestamp)) return false;
  const oneDayMs = 1000 * 60 * 60 * 24;
  return timestamp >= now - oneDayMs;
}

export function MeetingsBrowser({ meetings, now }: MeetingsBrowserProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCommittee, setSelectedCommittee] = useState('all');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const committees = useMemo(
    () => getUniqueValues(meetings.map((meeting) => meeting.committee)),
    [meetings]
  );

  const branches = useMemo(
    () => getUniqueValues(meetings.map((meeting) => meeting.branch)),
    [meetings]
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const fromTimestamp = parseDateBoundary(fromDate);
  const toTimestamp = parseDateBoundary(toDate, true);

  const filteredMeetings = useMemo(() => {
    return meetings.filter((meeting) => {
      if (selectedCommittee !== 'all' && meeting.committee !== selectedCommittee) {
        return false;
      }

      if (selectedBranch !== 'all' && meeting.branch !== selectedBranch) {
        return false;
      }

      if (!isWithinRange(meeting, { from: fromTimestamp ?? undefined, to: toTimestamp ?? undefined })) {
        return false;
      }

      if (!matchesSearch(meeting, normalizedSearch)) {
        return false;
      }

      return true;
    });
  }, [meetings, normalizedSearch, selectedBranch, selectedCommittee, fromTimestamp, toTimestamp]);

  const upcomingMeetings = useMemo(
    () => filteredMeetings.filter((meeting) => isUpcoming(meeting, now)),
    [filteredMeetings, now]
  );

  const pastMeetings = useMemo(
    () =>
        filteredMeetings
          .filter((meeting) => !isUpcoming(meeting, now))
        .reverse(),
    [filteredMeetings, now]
  );

  const hasActiveFilters =
    normalizedSearch.length > 0 ||
    selectedCommittee !== 'all' ||
    selectedBranch !== 'all' ||
    fromDate !== '' ||
    toDate !== '';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedCommittee('all');
    setSelectedBranch('all');
    setFromDate('');
    setToDate('');
  };

  const renderEmptyState = (label: string) => (
    <p className="text-muted-foreground">
      {hasActiveFilters
        ? `No ${label} match the current filters. Try adjusting your search.`
        : `No ${label} found in the latest scrape.`}
    </p>
  );

  return (
    <div className="space-y-10">
      <section className="bg-card border border-border rounded-xl p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Refine meetings</h2>
            <p className="text-sm text-muted-foreground">
              Search by keyword or narrow results by date range, committee, or chamber.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="meeting-search">Keyword</Label>
              <Input
                id="meeting-search"
                placeholder="Search agendas, committees, notes..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting-committee">Committee</Label>
              <Select value={selectedCommittee} onValueChange={setSelectedCommittee}>
                <SelectTrigger id="meeting-committee">
                  <SelectValue placeholder="All committees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All committees</SelectItem>
                  {committees.map((committee) => (
                    <SelectItem key={committee} value={committee}>
                      {committee}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="meeting-branch">Chamber</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger id="meeting-branch">
                  <SelectValue placeholder="All chambers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All chambers</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="meeting-from">From date</Label>
                <Input
                  id="meeting-from"
                  type="date"
                  max={toDate || undefined}
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meeting-to">To date</Label>
                <Input
                  id="meeting-to"
                  type="date"
                  min={fromDate || undefined}
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </div>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-muted-foreground">
              <p>
                Showing {filteredMeetings.length} meeting{filteredMeetings.length === 1 ? '' : 's'} from{' '}
                {fromDate && fromTimestamp
                  ? format(fromTimestamp, 'MMM d, yyyy')
                  : 'the earliest available date'}{' '}
                to{' '}
                {toDate && toTimestamp ? format(toTimestamp, 'MMM d, yyyy') : 'any future date'}.
              </p>
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Upcoming meetings</h2>
          <p className="text-sm text-muted-foreground">
            Meetings happening soon based on the latest schedule data.
          </p>
        </div>
        {upcomingMeetings.length > 0 ? (
          <div className="space-y-6">
            {upcomingMeetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} />
            ))}
          </div>
        ) : (
          renderEmptyState('upcoming meetings')
        )}
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Recent meetings</h2>
          <p className="text-sm text-muted-foreground">
            Meetings that have already taken place are listed here for reference.
          </p>
        </div>
        {pastMeetings.length > 0 ? (
          <div className="space-y-6">
            {pastMeetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} />
            ))}
          </div>
        ) : (
          renderEmptyState('past meetings')
        )}
      </section>
    </div>
  );
}
