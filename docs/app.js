const state = {
  search: '',
  branches: new Set(['House of Representatives', 'Senate']),
  startDate: '',
  endDate: '',
  showPast: false,
  calendarMonth: null
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
  noResults: document.getElementById('no-results'),
  calendarGrid: document.getElementById('calendar-grid'),
  calendarMonth: document.getElementById('calendar-month'),
  calendarPrev: document.getElementById('calendar-prev'),
  calendarNext: document.getElementById('calendar-next')
};

let records = [];
let metadata = null;

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const calendarFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric'
});

const dayFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const historyFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium'
});

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

function formatHistoryTimestamp(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return historyFormatter.format(parsed);
}

function getRecordDateKey(record) {
  if (record.isoDate && /^\d{4}-\d{2}-\d{2}/.test(record.isoDate)) {
    return record.isoDate.slice(0, 10);
  }

  if (record.date && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return record.date;
  }

  if (record.date && /^\d{4}-\d{2}-\d{2}T/.test(record.date)) {
    return record.date.slice(0, 10);
  }

  return '';
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

function setCalendarMonthFromIso(iso) {
  if (!iso) return;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return;
  state.calendarMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function initializeCalendarMonth(preferredIso = '') {
  if (preferredIso) {
    setCalendarMonthFromIso(preferredIso);
    return;
  }

  if (state.calendarMonth) return;

  const todayIso = new Date().toISOString().slice(0, 10);
  const orderedDates = records
    .map((record) => getRecordDateKey(record))
    .filter(Boolean)
    .sort();

  const targetIso = orderedDates.find((iso) => iso >= todayIso) || orderedDates[0] || todayIso;
  setCalendarMonthFromIso(targetIso);
}

function applyFilters() {
  const today = toStartOfDay(new Date());
  const filtered = records.filter((record) => {
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

  renderCalendar(filtered);
  renderResults(filtered);
}

function renderResults(items) {
  elements.resultsList.innerHTML = '';
  elements.noResults.hidden = items.length > 0;
  elements.resultsCount.textContent = `${items.length.toLocaleString()} hearing${
    items.length === 1 ? '' : 's'
  } shown`;

  if (!items.length) {
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((record) => {
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

    if (record.firstSeenAt || record.lastSeenAt) {
      const captured = document.createElement('p');
      captured.className = 'result-card__notes';
      const first = formatHistoryTimestamp(record.firstSeenAt);
      const last = formatHistoryTimestamp(record.lastSeenAt);
      if (first && last && first !== last) {
        captured.textContent = `Captured ${first} • Last confirmed ${last}`;
      } else {
        captured.textContent = `Captured ${first || last}`;
      }
      parts.push(captured);
    }

    if (record.source) {
      const source = document.createElement('p');
      source.className = 'result-card__notes';
      source.textContent = `Source: ${record.source}`;
      parts.push(source);
    }

    parts.forEach((el) => card.appendChild(el));
    fragment.appendChild(card);
  });

  elements.resultsList.appendChild(fragment);
}

function renderCalendar(items) {
  if (!elements.calendarGrid || !elements.calendarMonth) return;

  initializeCalendarMonth();

  const activeMonth = state.calendarMonth
    ? new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1)
    : new Date();
  activeMonth.setDate(1);

  elements.calendarMonth.textContent = calendarFormatter.format(activeMonth);

  const counts = new Map();
  items.forEach((item) => {
    const iso = getRecordDateKey(item);
    if (!iso) return;
    const entry = counts.get(iso) || { total: 0 };
    entry.total += 1;
    counts.set(iso, entry);
  });

  const year = activeMonth.getFullYear();
  const monthIndex = activeMonth.getMonth();
  const firstDayIndex = activeMonth.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const fragment = document.createDocumentFragment();

  const todayIso = new Date().toISOString().slice(0, 10);
  const selectedStart = state.startDate;
  const selectedEnd = state.endDate || state.startDate;
  const hasRange = Boolean(selectedStart && selectedEnd);

  const createSpacer = () => {
    const spacer = document.createElement('div');
    spacer.className = 'calendar__day calendar__day--inactive';
    spacer.setAttribute('aria-hidden', 'true');
    fragment.appendChild(spacer);
  };

  for (let i = 0; i < firstDayIndex; i += 1) {
    createSpacer();
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayInfo = counts.get(iso);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar__day';
    button.dataset.date = iso;

    const eventLabel = dayInfo
      ? `${dayInfo.total} hearing${dayInfo.total === 1 ? '' : 's'}`
      : 'No hearings';
    button.setAttribute('aria-label', `${dayFormatter.format(new Date(`${iso}T00:00:00`))} · ${eventLabel}`);

    if (dayInfo) {
      button.classList.add('calendar__day--has-events');
    }

    if (iso === todayIso) {
      button.classList.add('calendar__day--today');
    }

    if (hasRange && iso >= selectedStart && iso <= selectedEnd) {
      if (selectedStart === selectedEnd) {
        button.classList.add('calendar__day--selected');
      } else {
        button.classList.add('calendar__day--in-range');
      }
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.setAttribute('aria-pressed', 'false');
    }

    const dayNumber = document.createElement('span');
    dayNumber.className = 'calendar__day-number';
    dayNumber.textContent = String(day);

    const countLabel = document.createElement('span');
    countLabel.className = 'calendar__day-count';
    countLabel.textContent = dayInfo ? `${dayInfo.total} hearing${dayInfo.total === 1 ? '' : 's'}` : '—';

    button.append(dayNumber, countLabel);
    button.addEventListener('click', () => handleCalendarDayClick(iso));

    fragment.appendChild(button);
  }

  const totalCells = firstDayIndex + daysInMonth;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) {
    createSpacer();
  }

  elements.calendarGrid.innerHTML = '';
  elements.calendarGrid.appendChild(fragment);
}

function changeCalendarMonth(offset) {
  if (!state.calendarMonth) {
    state.calendarMonth = new Date();
  }

  const next = new Date(state.calendarMonth);
  next.setMonth(state.calendarMonth.getMonth() + offset, 1);
  state.calendarMonth = next;
  applyFilters();
}

function handleCalendarDayClick(iso) {
  if (!iso) return;

  if (state.startDate === iso && state.endDate === iso) {
    state.startDate = '';
    state.endDate = '';
    elements.startDate.value = '';
    elements.endDate.value = '';
  } else {
    state.startDate = iso;
    state.endDate = iso;
    elements.startDate.value = iso;
    elements.endDate.value = iso;
  }

  setCalendarMonthFromIso(iso);
  applyFilters();
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

  const messages = [];

  if (!metadata.counts.senate) {
    messages.push('Senate schedule could not be downloaded from the public website at this time.');
  }

  const senateHistory = metadata?.history?.senate;
  if (senateHistory?.entries) {
    const first = formatHistoryTimestamp(senateHistory.firstSeenAt);
    const last = formatHistoryTimestamp(senateHistory.lastSeenAt);
    if (first && last && first !== last) {
      messages.push(`Senate archive covers ${senateHistory.entries.toLocaleString()} hearings captured between ${first} and ${last}.`);
    } else if (last) {
      messages.push(
        `Senate archive tracks ${senateHistory.entries.toLocaleString()} hearings (last updated ${last}).`
      );
    } else {
      messages.push(`Senate archive tracks ${senateHistory.entries.toLocaleString()} hearings.`);
    }
  }

  const suffix = messages.length ? ` • ${messages.join(' • ')}` : '';
  elements.status.textContent = `Data refreshed ${formatted}.${suffix}`;
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
  state.calendarMonth = null;

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
    if (state.startDate) {
      setCalendarMonthFromIso(state.startDate);
    }
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

  if (elements.calendarPrev) {
    elements.calendarPrev.addEventListener('click', () => changeCalendarMonth(-1));
  }

  if (elements.calendarNext) {
    elements.calendarNext.addEventListener('click', () => changeCalendarMonth(1));
  }
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
    state.calendarMonth = null;
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
