const state = {
  search: '',
  branches: new Set(['House of Representatives', 'Senate']),
  startDate: '',
  endDate: '',
  showPast: false,
  view: 'list'
};

const elements = {
  status: document.getElementById('data-status'),
  layout: document.querySelector('main.layout'),
  search: document.getElementById('search-input'),
  branchHouse: document.getElementById('branch-house'),
  branchSenate: document.getElementById('branch-senate'),
  startDate: document.getElementById('start-date'),
  endDate: document.getElementById('end-date'),
  showPast: document.getElementById('show-past'),
  reset: document.getElementById('reset-filters'),
  countUpcoming: document.getElementById('count-upcoming'),
  countHouse: document.getElementById('count-house'),
  countSenate: document.getElementById('count-senate'),
  resultsCount: document.getElementById('results-count'),
  resultsList: document.getElementById('results-list'),
  resultsCalendar: document.getElementById('results-calendar'),
  viewButtons: Array.from(document.querySelectorAll('.view-toggle__button')),
  noResults: document.getElementById('no-results')
};

let records = [];
let metadata = null;
let filteredRecords = [];

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric'
});

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toStartOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDate(record) {
  if (!record.isoDate && !record.date) return 'Date TBD';
  const iso = record.isoDate || `${record.date}T00:00:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return record.date || 'Date TBD';
  }
  return dateFormatter.format(parsed);
}

function formatTime(record) {
  return record.time || 'Time TBD';
}

function sanitizeAgenda(agenda) {
  if (!agenda) return 'Agenda to follow';
  return agenda.replace(/\s*\u2022\s*/g, ' • ').trim();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareRecords(a, b) {
  const dateA = parseDate(a.isoDate);
  const dateB = parseDate(b.isoDate);

  if (dateA && dateB) {
    return dateA - dateB;
  }
  if (dateA) return -1;
  if (dateB) return 1;

  if (a.time && b.time) {
    return a.time.localeCompare(b.time);
  }

  return (a.committee || '').localeCompare(b.committee || '');
}

function computeSearchText(record) {
  if (record.searchText) return record.searchText;
  return [
    record.branch,
    record.committee,
    record.venue,
    record.agenda,
    record.status,
    record.notes
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function applyFilters() {
  const today = toStartOfDay(new Date());
  filteredRecords = records.filter((record) => {
    if (!state.branches.has(record.branch)) return false;

    if (state.search) {
      const text = computeSearchText(record);
      if (!text.includes(state.search)) return false;
    }

    if (state.startDate && record.date && record.date < state.startDate) {
      return false;
    }

    if (state.endDate && record.date && record.date > state.endDate) {
      return false;
    }

    if (!state.showPast) {
      if (record.isoDate) {
        const recordDate = toStartOfDay(new Date(record.isoDate));
        if (recordDate < today) {
          return false;
        }
      } else if (record.date && record.date < new Date().toISOString().slice(0, 10)) {
        return false;
      }
    }

    return true;
  });

  renderResults(filteredRecords);
}

function createRecordCard(record) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const header = document.createElement('div');
  header.className = 'result-card__header';

  const branch = document.createElement('span');
  branch.className = 'result-card__branch';
  branch.textContent = record.branch;

  const title = document.createElement('h2');
  title.className = 'result-card__title';
  title.textContent = record.committee || 'Untitled committee';

  header.append(branch, title);

  const badge = document.createElement('span');
  badge.className = 'result-card__badge';
  badge.textContent = `Status: ${record.status || 'Scheduled'}`;

  const meta = document.createElement('div');
  meta.className = 'result-card__meta';

  const date = document.createElement('span');
  date.textContent = `🗓️ ${formatDate(record)}`;

  const time = document.createElement('span');
  time.textContent = `⏰ ${formatTime(record)}`;

  const venue = document.createElement('span');
  venue.textContent = `📍 ${record.venue || 'Venue TBA'}`;

  meta.append(date, time, venue);

  const agenda = document.createElement('p');
  agenda.className = 'result-card__agenda';
  agenda.textContent = sanitizeAgenda(record.agenda);

  const parts = [header, badge, meta, agenda];

  if (record.notes) {
    const notes = document.createElement('p');
    notes.className = 'result-card__notes';
    notes.textContent = record.notes;
    parts.push(notes);
  }

  if (record.source) {
    const source = document.createElement('p');
    source.className = 'result-card__notes';
    source.textContent = `Source: ${record.source}`;
    parts.push(source);
  }

  parts.forEach((el) => card.appendChild(el));
  return card;
}

function renderListView(items) {
  const fragment = document.createDocumentFragment();

  items.forEach((record) => {
    fragment.appendChild(createRecordCard(record));
  });

  elements.resultsList.appendChild(fragment);
}

function renderCalendarView(items) {
  const months = new Map();
  const undated = [];

  items.forEach((record) => {
    const iso = record.isoDate || (record.date ? `${record.date}T00:00:00` : '');
    const parsed = parseDate(iso);

    if (!parsed) {
      undated.push(record);
      return;
    }

    const normalized = toStartOfDay(parsed);
    const monthKey = `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, '0')}`;

    if (!months.has(monthKey)) {
      months.set(monthKey, {
        monthDate: new Date(normalized.getFullYear(), normalized.getMonth(), 1),
        days: new Map()
      });
    }

    const monthData = months.get(monthKey);
    const day = normalized.getDate();
    if (!monthData.days.has(day)) {
      monthData.days.set(day, []);
    }
    monthData.days.get(day).push(record);
  });

  const fragment = document.createDocumentFragment();
  const sortedMonths = Array.from(months.values()).sort((a, b) => a.monthDate - b.monthDate);

  sortedMonths.forEach((monthData) => {
    const section = document.createElement('section');
    section.className = 'calendar-month';

    const header = document.createElement('header');
    header.className = 'calendar-month__header';

    const title = document.createElement('h3');
    title.className = 'calendar-month__title';
    title.textContent = monthFormatter.format(monthData.monthDate);

    const hearingsCount = Array.from(monthData.days.values()).reduce(
      (total, events) => total + events.length,
      0
    );

    const count = document.createElement('span');
    count.className = 'calendar-month__count';
    count.textContent = `${hearingsCount} hearing${hearingsCount === 1 ? '' : 's'}`;

    header.append(title, count);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'calendar-month__grid';

    weekdayLabels.forEach((label) => {
      const weekday = document.createElement('div');
      weekday.className = 'calendar-month__weekday';
      weekday.textContent = label;
      grid.appendChild(weekday);
    });

    const firstWeekday = monthData.monthDate.getDay();
    for (let index = 0; index < firstWeekday; index += 1) {
      const filler = document.createElement('div');
      filler.className = 'calendar-month__cell calendar-month__cell--inactive';
      grid.appendChild(filler);
    }

    const year = monthData.monthDate.getFullYear();
    const monthIndex = monthData.monthDate.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement('div');
      cell.className = 'calendar-month__cell';

      const dateLabel = document.createElement('div');
      dateLabel.className = 'calendar-month__date';
      dateLabel.textContent = day;
      cell.appendChild(dateLabel);

      const dailyEvents = monthData.days.get(day);

      if (dailyEvents && dailyEvents.length) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'calendar-month__events';

        dailyEvents
          .slice()
          .sort(compareRecords)
          .forEach((record) => {
            const eventEl = document.createElement('article');
            eventEl.className = 'calendar-month__event';

            const eventHeader = document.createElement('div');
            eventHeader.className = 'calendar-month__event-row';

            const time = document.createElement('span');
            time.className = 'calendar-month__event-time';
            time.textContent = `⏰ ${formatTime(record)}`;

            const status = document.createElement('span');
            status.className = 'calendar-month__event-status';
            status.textContent = record.status
              ? `Status: ${record.status}`
              : 'Status: Scheduled';

            eventHeader.append(time, status);

            const titleEl = document.createElement('h4');
            titleEl.className = 'calendar-month__event-title';
            titleEl.textContent = record.committee || 'Untitled committee';

            const meta = document.createElement('div');
            meta.className = 'calendar-month__event-meta';

            const branch = document.createElement('span');
            branch.textContent = `🏛️ ${record.branch}`;

            const venue = document.createElement('span');
            venue.textContent = `📍 ${record.venue || 'Venue TBA'}`;

            meta.append(branch, venue);

            const agenda = document.createElement('p');
            agenda.className = 'calendar-month__event-agenda';
            agenda.textContent = sanitizeAgenda(record.agenda);

            eventEl.append(eventHeader, titleEl, meta, agenda);

            if (record.notes) {
              const notes = document.createElement('p');
              notes.className = 'calendar-month__event-notes';
              notes.textContent = record.notes;
              eventEl.appendChild(notes);
            }

            if (record.source) {
              const source = document.createElement('p');
              source.className = 'calendar-month__event-notes';
              source.textContent = `Source: ${record.source}`;
              eventEl.appendChild(source);
            }

            eventsContainer.appendChild(eventEl);
          });

        cell.appendChild(eventsContainer);
      } else {
        cell.classList.add('calendar-month__cell--quiet');
      }

      grid.appendChild(cell);
    }

    const trailing = (firstWeekday + daysInMonth) % 7;
    if (trailing) {
      for (let index = trailing; index < 7; index += 1) {
        const filler = document.createElement('div');
        filler.className = 'calendar-month__cell calendar-month__cell--inactive';
        grid.appendChild(filler);
      }
    }

    section.appendChild(grid);
    fragment.appendChild(section);
  });

  if (undated.length) {
    const section = document.createElement('section');
    section.className = 'calendar-month calendar-month--tbd';

    const header = document.createElement('header');
    header.className = 'calendar-month__header';

    const title = document.createElement('h3');
    title.className = 'calendar-month__title';
    title.textContent = 'Date to be determined';

    const count = document.createElement('span');
    count.className = 'calendar-month__count';
    count.textContent = `${undated.length} hearing${undated.length === 1 ? '' : 's'}`;

    header.append(title, count);
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'calendar-month__tbd-list';

    undated
      .slice()
      .sort(compareRecords)
      .forEach((record) => {
        list.appendChild(createRecordCard(record));
      });

    section.appendChild(list);
    fragment.appendChild(section);
  }

  elements.resultsCalendar.appendChild(fragment);
}

function updateViewButtons() {
  elements.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle('view-toggle__button--active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function renderResults(items) {
  elements.resultsList.innerHTML = '';
  elements.resultsCalendar.innerHTML = '';

  const hasItems = items.length > 0;

  elements.noResults.hidden = hasItems;
  elements.resultsCount.textContent = `${items.length.toLocaleString()} hearing${
    items.length === 1 ? '' : 's'
  } shown`;

  elements.resultsList.hidden = !hasItems || state.view !== 'list';
  elements.resultsCalendar.hidden = !hasItems || state.view !== 'calendar';

  if (!hasItems) {
    return;
  }

  if (state.view === 'list') {
    renderListView(items);
  } else {
    renderCalendarView(items);
  }
}

function updateStats() {
  if (!metadata) return;

  const today = toStartOfDay(new Date());

  const upcoming = records.filter((record) => {
    if (!record.isoDate) return false;
    return toStartOfDay(new Date(record.isoDate)) >= today;
  });

  const upcomingHouse = upcoming.filter((item) => item.branch === 'House of Representatives');
  const upcomingSenate = upcoming.filter((item) => item.branch === 'Senate');

  elements.countUpcoming.textContent = upcoming.length.toLocaleString();
  elements.countHouse.textContent = upcomingHouse.length.toLocaleString();
  elements.countSenate.textContent = upcomingSenate.length.toLocaleString();
}

function renderStatusMessage() {
  if (!metadata) {
    elements.status.textContent = 'Loading latest datasets…';
    return;
  }

  const time = new Date(metadata.generatedAt);
  const formatted = Number.isNaN(time.getTime())
    ? metadata.generatedAt
    : `${time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

  const senateNote = metadata.counts.senate
    ? ''
    : ' • Senate schedule could not be downloaded from the public website at this time.';

  elements.status.textContent = `Data refreshed ${formatted}.${senateNote}`;
}

function resetFilters() {
  state.search = '';
  state.branches = new Set(['House of Representatives', 'Senate']);
  state.startDate = '';
  state.endDate = '';
  state.showPast = false;

  elements.search.value = '';
  elements.branchHouse.checked = true;
  elements.branchSenate.checked = true;
  elements.startDate.value = '';
  elements.endDate.value = '';
  elements.showPast.checked = false;

  applyFilters();
}

function attachEventListeners() {
  elements.search.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  [elements.branchHouse, elements.branchSenate].forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.branches.add(checkbox.value);
      } else {
        state.branches.delete(checkbox.value);
      }
      if (!state.branches.size) {
        // Prevent all chambers from being unchecked
        state.branches.add(checkbox.value);
        checkbox.checked = true;
        return;
      }
      applyFilters();
    });
  });

  elements.startDate.addEventListener('change', (event) => {
    state.startDate = event.target.value;
    applyFilters();
  });

  elements.endDate.addEventListener('change', (event) => {
    state.endDate = event.target.value;
    applyFilters();
  });

  elements.showPast.addEventListener('change', (event) => {
    state.showPast = event.target.checked;
    applyFilters();
  });

  elements.reset.addEventListener('click', resetFilters);

  elements.viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      if (!view || view === state.view) return;
      state.view = view;
      updateViewButtons();
      renderResults(filteredRecords);
    });
  });

  updateViewButtons();
}

async function loadData() {
  try {
    renderStatusMessage();
    const [metaResponse, allResponse] = await Promise.all([
      fetch('data/metadata.json', { cache: 'no-store' }),
      fetch('data/all.json', { cache: 'no-store' })
    ]);

    if (!metaResponse.ok || !allResponse.ok) {
      throw new Error('Failed to load schedule data');
    }

    metadata = await metaResponse.json();
    const payload = await allResponse.json();

    records = Array.isArray(payload)
      ? payload.map((item) => ({
          ...item,
          searchText: computeSearchText(item)
        }))
      : [];

    elements.layout.setAttribute('aria-busy', 'false');
    renderStatusMessage();
    updateStats();
    applyFilters();
  } catch (error) {
    elements.layout.setAttribute('aria-busy', 'false');
    elements.status.textContent =
      'Unable to load schedules right now. Please refresh the page or check the data files.';
    elements.resultsCount.textContent = 'Unable to load data';
    console.error(error);
  }
}

attachEventListeners();
loadData();
