const state = {
  search: '',
  branches: new Set(['House of Representatives', 'Senate']),
  startDate: '',
  endDate: '',
  showPast: false
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
  noResults: document.getElementById('no-results')
};

let records = [];
let metadata = null;

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric'
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
