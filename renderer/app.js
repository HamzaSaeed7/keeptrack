// ── State ─────────────────────────────────────────────────────────────────
let entries          = [];
let activeTab        = 'watching';
let searchQuery      = '';
let editingId        = null;
let pendingPosterPath = null;

// ── DOM refs ──────────────────────────────────────────────────────────────
const cardList      = document.getElementById('card-list');
const emptyState    = document.getElementById('empty-state');
const searchInput   = document.getElementById('search-input');
const modalOverlay  = document.getElementById('modal-overlay');
const modalTitle    = document.getElementById('modal-title');

const fName         = document.getElementById('f-name');
const fSeason       = document.getElementById('f-season');
const fEpisode      = document.getElementById('f-episode');
const fHours        = document.getElementById('f-hours');
const fMinutes      = document.getElementById('f-minutes');
const fSeconds      = document.getElementById('f-seconds');
const fTotalEp      = document.getElementById('f-total-ep');
const fTotalHours   = document.getElementById('f-total-hours');
const fTotalMinutes = document.getElementById('f-total-minutes');
const fRating       = document.getElementById('f-rating');
const fDesc         = document.getElementById('f-desc');
const ratingDisplay = document.getElementById('rating-display');
const posterPreview = document.getElementById('poster-preview');
const btnClearPoster = document.getElementById('btn-clear-poster');
const tvFields      = document.getElementById('tv-fields');
const movieFields   = document.getElementById('movie-fields');

// ── Settings ──────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { vlcHost: 'localhost', vlcPort: 8080, vlcPassword: '', tmdbApiKey: '' };
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('keeptrack-settings') || '{}');
    settings = { ...DEFAULT_SETTINGS, ...saved };
  } catch {}
}

function persistSettings() {
  localStorage.setItem('keeptrack-settings', JSON.stringify(settings));
}

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('s-tmdb-key').value      = settings.tmdbApiKey;
  document.getElementById('s-vlc-host').value      = settings.vlcHost;
  document.getElementById('s-vlc-port').value      = settings.vlcPort;
  document.getElementById('s-vlc-password').value  = settings.vlcPassword;
  document.getElementById('settings-overlay').style.display = 'flex';
});

function closeSettings() {
  document.getElementById('settings-overlay').style.display = 'none';
}
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-cancel').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
});
document.getElementById('settings-save').addEventListener('click', () => {
  settings.tmdbApiKey  = document.getElementById('s-tmdb-key').value.trim();
  settings.vlcHost     = document.getElementById('s-vlc-host').value.trim() || 'localhost';
  settings.vlcPort     = parseInt(document.getElementById('s-vlc-port').value) || 8080;
  settings.vlcPassword = document.getElementById('s-vlc-password').value;
  persistSettings();
  closeSettings();
  pollVLC();
});

// ── VLC Integration ───────────────────────────────────────────────────────
let vlcConnected  = false;
let vlcNowPlaying = null;
let vlcCurrentTime = null;
let lastAutoFile  = null;

function parseFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');              // strip extension
  const clean = base
    .replace(/\[.*?\]/g, '')                                  // strip [tags]
    .replace(/\((?!\d{4}\))[^)]*\)/g, '')                    // strip (tags) but keep (2024)
    .replace(/\s+/g, ' ').trim();
  let m = clean.match(/^(.+?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})/);
  if (m) return { name: cleanTitle(m[1]), season: parseInt(m[2]), episode: parseInt(m[3]) };
  m = clean.match(/^(.+?)[.\s_-]+(\d{1,2})x(\d{1,3})/i);
  if (m) return { name: cleanTitle(m[1]), season: parseInt(m[2]), episode: parseInt(m[3]) };
  return { name: cleanTitle(clean), season: null, episode: null };
}

function cleanTitle(raw) {
  return raw.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findExistingEntry(parsedName) {
  const lower = parsedName.toLowerCase();
  return entries.find(e => {
    const n = e.name.toLowerCase();
    return n === lower || lower.includes(n) || n.includes(lower);
  }) || null;
}

async function handleNowPlaying(filename, vlcTime) {
  if (!filename) return;

  const parsed   = parseFilename(filename);
  const existing = findExistingEntry(parsed.name);

  if (existing) {
    if (existing.type === 'show' && parsed.season !== null) {
      // Only update episode when the file changes
      if (filename === lastAutoFile) return;
      lastAutoFile = filename;
      const updated = await window.api.updateEntry({
        ...existing, season: parsed.season, episode: parsed.episode
      });
      const idx = entries.findIndex(e => e.id === existing.id);
      if (idx !== -1) entries[idx] = updated;
      render();
      showToast(`Updated "${existing.name}" → S${String(parsed.season).padStart(2,'0')}E${String(parsed.episode).padStart(2,'0')}`);

    } else if (existing.type === 'movie' && vlcTime != null) {
      // Update watch time whenever VLC position changes by more than 30s
      if (Math.abs((existing.watch_time || 0) - vlcTime) < 30) return;
      const updated = await window.api.updateEntry({ ...existing, watch_time: Math.floor(vlcTime) });
      const idx = entries.findIndex(e => e.id === existing.id);
      if (idx !== -1) entries[idx] = updated;
      existing.watch_time = Math.floor(vlcTime);
      // Update the time display in the card directly
      const timeEl = document.querySelector(`.card[data-id="${existing.id}"] .prog-val`);
      if (timeEl) timeEl.textContent = formatTime(Math.floor(vlcTime));
      // Update progress bar if total duration is known
      const progFill = document.querySelector(`.card[data-id="${existing.id}"] .progress-bar-fill`);
      if (progFill && existing.total > 0) {
        progFill.style.width = Math.min(100, (Math.floor(vlcTime) / existing.total) * 100) + '%';
      }
    }
  } else {
    // Only create a new card when we first see this file
    if (filename === lastAutoFile) return;
    lastAutoFile = filename;
    const isShow = parsed.season !== null;
    const entryType = isShow ? 'show' : 'movie';
    const newEntry = await window.api.addEntry({
      name: parsed.name, type: entryType,
      season: parsed.season || 1, episode: parsed.episode || 0,
      watch_time: isShow ? 0 : Math.floor(vlcTime || 0),
      rating: 0, description: '', poster_path: '', status: 'watching', total: 0
    });
    const posterUrl = await fetchTMDBPoster(parsed.name, entryType);
    if (posterUrl) {
      const posterPath = await window.api.downloadPoster(posterUrl, newEntry.id);
      if (posterPath) {
        const withPoster = await window.api.updateEntry({ ...newEntry, poster_path: posterPath });
        entries.unshift(withPoster);
        render();
        showToast(`Added "${parsed.name}" from VLC`);
        return;
      }
    }
    entries.unshift(newEntry);
    render();
    showToast(`Added "${parsed.name}" from VLC`);
  }
}

async function pollVLC() {
  const { vlcHost, vlcPort, vlcPassword } = settings;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(
      `http://${vlcHost}:${vlcPort}/requests/status.json`,
      { headers: { 'Authorization': 'Basic ' + btoa(':' + vlcPassword) }, signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) throw new Error('bad status');
    const data = await resp.json();
    vlcConnected  = true;
    const filename = data.information?.category?.meta?.filename || null;
    const isActive = data.state === 'playing' || data.state === 'paused';
    vlcNowPlaying  = (isActive && filename) ? filename : null;
    vlcCurrentTime = isActive ? (data.time || 0) : null;
  } catch {
    vlcConnected  = false;
    vlcNowPlaying = null;
    vlcCurrentTime = null;
  }
  updateVLCStatus();
  if (vlcNowPlaying) handleNowPlaying(vlcNowPlaying, vlcCurrentTime);
}

function matchedShow(filename) {
  if (!filename) return null;
  const lower = filename.toLowerCase();
  return entries.find(e => lower.includes(e.name.toLowerCase())) || null;
}

function updateVLCStatus() {
  const badge = document.getElementById('vlc-status');
  const label = document.getElementById('vlc-label');

  if (!vlcConnected) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'flex';
  if (!vlcNowPlaying) {
    badge.className = 'vlc-badge';
    label.textContent = 'VLC Connected';
    badge.title = 'Connected — nothing playing';
    return;
  }
  const match = matchedShow(vlcNowPlaying);
  badge.className = 'vlc-badge playing';
  label.textContent = match ? match.name : vlcNowPlaying.replace(/\.[^.]+$/, '');
  badge.title = vlcNowPlaying;
}

// ── Toast ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  loadSettings();
  entries = await window.api.getAll();
  render();
  pollVLC();
  setInterval(pollVLC, 5000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeTab = btn.dataset.tab;
  render();
});

// ── Search ────────────────────────────────────────────────────────────────
searchInput.addEventListener('input', e => {
  searchQuery = e.target.value.toLowerCase();
  render();
});

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const filtered = entries.filter(e => {
    if (activeTab !== 'all' && e.status !== activeTab) return false;
    if (searchQuery && !e.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  Array.from(cardList.children).forEach(child => {
    if (!child.id) cardList.removeChild(child);
  });

  emptyState.style.display = filtered.length === 0 ? 'block' : 'none';

  const countEl = document.getElementById('entry-count-val');
  if (countEl) countEl.textContent = filtered.length;

  filtered.forEach(entry => cardList.appendChild(buildCard(entry)));
}

// ── SVG Icons ─────────────────────────────────────────────────────────────
const EDIT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const DEL_ICON  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
const STAR_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

// ── Build a card ──────────────────────────────────────────────────────────
function buildCard(entry) {
  const card = document.createElement('div');
  card.className = `card ${entry.status}`;
  card.dataset.id = entry.id;

  // Poster
  const poster = document.createElement('div');
  poster.className = 'poster';
  poster.style.background = posterGradient(entry.name);

  const initialsEl = document.createElement('div');
  initialsEl.className = 'poster-initials';
  initialsEl.textContent = entry.name.split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  poster.appendChild(initialsEl);

  if (entry.poster_path) {
    window.api.getPosterData(entry.poster_path).then(dataUrl => {
      if (dataUrl) {
        const img = document.createElement('img');
        img.src = dataUrl;
        poster.innerHTML = '';
        poster.appendChild(img);
      }
    });
  }

  // Card body
  const body = document.createElement('div');
  body.className = 'card-body';

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = entry.name;
  titleEl.title = entry.name;
  const typeBadge = document.createElement('div');
  typeBadge.className = 'type-badge';
  typeBadge.textContent = entry.type === 'show' ? 'TV Show' : 'Movie';
  header.append(titleEl, typeBadge);

  // Progress
  const progress = document.createElement('div');
  progress.className = 'card-progress';

  let progressBarFill = null;

  if (entry.type === 'show') {
    progress.appendChild(makeProg('Season', entry.season, val => saveField(entry, 'season', val), 1));
    progress.appendChild(makeProg('Episode', entry.episode, async val => {
      await saveField(entry, 'episode', val);
      if (progressBarFill) {
        const pct = entry.total > 0 ? Math.min(100, (val / entry.total) * 100) : episodeProgress(val);
        progressBarFill.style.width = pct + '%';
      }
    }));
  } else {
    const timeItem = document.createElement('div');
    timeItem.className = 'prog-item';
    const timeLbl = document.createElement('span');
    timeLbl.className = 'prog-label';
    timeLbl.textContent = 'Watched';
    const timeVal = document.createElement('span');
    timeVal.className = 'prog-val';
    timeVal.style.fontSize = '13px';
    timeVal.textContent = formatTime(entry.watch_time);
    timeItem.append(timeLbl, timeVal);
    progress.appendChild(timeItem);
  }

  // Progress bar
  const barWrap = document.createElement('div');
  barWrap.className = 'progress-bar-wrap';
  progressBarFill = document.createElement('div');
  progressBarFill.className = 'progress-bar-fill';
  if (entry.type === 'show') {
    progressBarFill.style.width = entry.total > 0
      ? Math.min(100, (entry.episode / entry.total) * 100) + '%'
      : episodeProgress(entry.episode) + '%';
  } else {
    progressBarFill.style.width = entry.total > 0
      ? Math.min(100, (entry.watch_time / entry.total) * 100) + '%'
      : (entry.status === 'finished' ? '100%' : '0%');
  }
  barWrap.appendChild(progressBarFill);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const ratingEl = document.createElement('div');
  if (entry.rating) {
    ratingEl.className = 'rating';
    ratingEl.innerHTML = `${STAR_ICON} ${Number(entry.rating).toFixed(1)} / 5.0`;
  } else {
    ratingEl.className = 'rating-empty';
    ratingEl.textContent = 'No rating yet';
  }

  const lastWatchedEl = document.createElement('div');
  lastWatchedEl.className = 'last-watched';
  lastWatchedEl.textContent = entry.last_watched ? formatLastWatched(entry.last_watched) : '';

  const actions = document.createElement('div');
  actions.className = 'actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn edit';
  editBtn.innerHTML = EDIT_ICON;
  editBtn.addEventListener('click', () => openEdit(entry));

  const delBtn = document.createElement('button');
  delBtn.className = 'action-btn del';
  delBtn.innerHTML = DEL_ICON;
  delBtn.addEventListener('click', () => deleteEntry(entry.id));

  actions.append(editBtn, delBtn);
  footer.append(ratingEl, lastWatchedEl, actions);

  body.append(header, progress, barWrap, footer);
  card.append(poster, body);
  return card;
}

// ── Progress counter ──────────────────────────────────────────────────────
function makeProg(label, initialVal, onChange, min = 0) {
  const item = document.createElement('div');
  item.className = 'prog-item';

  const lbl = document.createElement('span');
  lbl.className = 'prog-label';
  lbl.textContent = label;

  const controls = document.createElement('div');
  controls.className = 'prog-controls';

  const dec = document.createElement('button');
  dec.className = 'prog-btn';
  dec.textContent = '−';

  const val = document.createElement('span');
  val.className = 'prog-val';
  val.textContent = initialVal;

  const inc = document.createElement('button');
  inc.className = 'prog-btn';
  inc.textContent = '+';

  let current = initialVal;
  dec.addEventListener('click', async () => {
    if (current <= min) return;
    current--;
    val.textContent = current;
    await onChange(current);
  });
  inc.addEventListener('click', async () => {
    current++;
    val.textContent = current;
    await onChange(current);
  });

  controls.append(dec, val, inc);
  item.append(lbl, controls);
  return item;
}

async function saveField(entry, field, value) {
  const updated = { ...entry, [field]: value };
  const result  = await window.api.updateEntry(updated);
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx !== -1) entries[idx] = result;
  entry[field] = value;
}

// ── Delete ────────────────────────────────────────────────────────────────
async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  await window.api.deleteEntry(id);
  entries = entries.filter(e => e.id !== id);
  render();
}

// ── Modal open/close ──────────────────────────────────────────────────────
document.getElementById('btn-add').addEventListener('click', () => openAdd());
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function openAdd() {
  editingId = null;
  pendingPosterPath = null;
  modalTitle.textContent = 'Add Entry';
  resetForm();
  modalOverlay.style.display = 'flex';
  fName.focus();
}

function openEdit(entry) {
  editingId = entry.id;
  pendingPosterPath = null;
  modalTitle.textContent = 'Edit Entry';
  resetForm();
  populateForm(entry);
  modalOverlay.style.display = 'flex';
  fName.focus();
}

function closeModal() {
  modalOverlay.style.display = 'none';
}

// ── Form helpers ──────────────────────────────────────────────────────────
function resetForm() {
  fName.value         = '';
  fSeason.value       = 1;
  fEpisode.value      = 0;
  fTotalEp.value      = 0;
  fHours.value        = 0;
  fMinutes.value      = 0;
  fSeconds.value      = 0;
  fTotalHours.value   = 0;
  fTotalMinutes.value = 0;
  fRating.value       = 0;
  ratingDisplay.textContent = '0.0';
  fDesc.value    = '';
  pendingPosterUrl = null;
  setPosterPreview(null);
  setType('show');
  setStatus('watching');
  const resultsEl = document.getElementById('poster-results');
  if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
}

function populateForm(entry) {
  fName.value   = entry.name;
  fRating.value = entry.rating || 0;
  ratingDisplay.textContent = Number(entry.rating || 0).toFixed(1);
  fDesc.value   = entry.description || '';
  setType(entry.type);
  setStatus(entry.status);
  if (entry.type === 'show') {
    fSeason.value  = entry.season;
    fEpisode.value = entry.episode;
    fTotalEp.value = entry.total || 0;
  } else {
    const t = entry.watch_time || 0;
    fHours.value        = Math.floor(t / 3600);
    fMinutes.value      = Math.floor((t % 3600) / 60);
    fSeconds.value      = t % 60;
    const tot = entry.total || 0;
    fTotalHours.value   = Math.floor(tot / 3600);
    fTotalMinutes.value = Math.floor((tot % 3600) / 60);
  }
  if (entry.poster_path) {
    window.api.getPosterData(entry.poster_path).then(dataUrl => {
      if (dataUrl) setPosterPreview(dataUrl);
    });
  }
}

function setType(type) {
  document.querySelectorAll('#seg-type .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.val === type);
  });
  tvFields.style.display    = type === 'show'  ? 'flex' : 'none';
  movieFields.style.display = type === 'movie' ? 'flex' : 'none';
  document.getElementById('movie-total-fields').style.display = type === 'movie' ? 'flex' : 'none';
}

function setStatus(status) {
  document.querySelectorAll('#seg-status .seg').forEach(b => {
    b.classList.toggle('active', b.dataset.val === status);
  });
}

function getPosterPreview() {
  return posterPreview.querySelector('img')?.src || null;
}

function setPosterPreview(dataUrl) {
  posterPreview.innerHTML = '';
  if (dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl;
    posterPreview.appendChild(img);
    btnClearPoster.style.display = 'block';
  } else {
    posterPreview.innerHTML = '<span>No image</span>';
    btnClearPoster.style.display = 'none';
  }
}

document.getElementById('seg-type').addEventListener('click', e => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  setType(btn.dataset.val);
});
document.getElementById('seg-status').addEventListener('click', e => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  setStatus(btn.dataset.val);
});

fRating.addEventListener('input', () => {
  ratingDisplay.textContent = Number(fRating.value).toFixed(1);
});

// ── TMDB Auto Poster ──────────────────────────────────────────────────────
async function fetchTMDBPoster(name, type) {
  if (!settings.tmdbApiKey) return null;
  try {
    const endpoint = type === 'show' ? 'search/tv' : 'search/movie';
    const resp = await fetch(
      `https://api.themoviedb.org/3/${endpoint}?api_key=${settings.tmdbApiKey}&query=${encodeURIComponent(name)}`
    );
    const data = await resp.json();
    const first = (data.results || []).find(r => r.poster_path);
    return first ? `https://image.tmdb.org/t/p/w500${first.poster_path}` : null;
  } catch {
    return null;
  }
}

// ── TMDB Metadata Fetch ───────────────────────────────────────────────────
async function fetchTMDBMeta(name, type, season) {
  if (!settings.tmdbApiKey) return 0;
  try {
    if (type === 'show') {
      const searchResp = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${settings.tmdbApiKey}&query=${encodeURIComponent(name)}`
      );
      const searchData = await searchResp.json();
      const show = searchData.results?.[0];
      if (!show) return 0;
      const seasonResp = await fetch(
        `https://api.themoviedb.org/3/tv/${show.id}/season/${season}?api_key=${settings.tmdbApiKey}`
      );
      const seasonData = await seasonResp.json();
      return seasonData.episodes?.length || 0;
    } else {
      const searchResp = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${settings.tmdbApiKey}&query=${encodeURIComponent(name)}`
      );
      const searchData = await searchResp.json();
      const movie = searchData.results?.[0];
      if (!movie) return 0;
      const movieResp = await fetch(
        `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${settings.tmdbApiKey}`
      );
      const movieData = await movieResp.json();
      return (movieData.runtime || 0) * 60;
    }
  } catch {
    return 0;
  }
}

// ── TMDB Poster Search ────────────────────────────────────────────────────
let pendingPosterUrl = null;

document.getElementById('btn-search-poster').addEventListener('click', async () => {
  const name = fName.value.trim();
  if (!name) { fName.focus(); return; }
  if (!settings.tmdbApiKey) {
    showToast('Add your TMDB API key in Settings first');
    return;
  }
  const resultsEl = document.getElementById('poster-results');
  resultsEl.style.display = 'flex';
  resultsEl.innerHTML = '<span class="poster-search-loading">Searching…</span>';

  try {
    const resp = await fetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${settings.tmdbApiKey}&query=${encodeURIComponent(name)}&page=1`
    );
    const data = await resp.json();
    const results = (data.results || []).filter(r => r.poster_path).slice(0, 10);

    if (!results.length) {
      resultsEl.innerHTML = '<span class="poster-search-loading">No results found</span>';
      return;
    }

    resultsEl.innerHTML = '';
    for (const r of results) {
      const imgUrl = `https://image.tmdb.org/t/p/w200${r.poster_path}`;
      const fullUrl = `https://image.tmdb.org/t/p/w500${r.poster_path}`;
      const title = r.title || r.name || '';

      const thumb = document.createElement('div');
      thumb.className = 'poster-thumb';
      thumb.title = title;
      thumb.innerHTML = `<img src="${imgUrl}" /><div class="poster-thumb-label">${title}</div>`;
      thumb.addEventListener('click', () => {
        pendingPosterUrl = fullUrl;
        pendingPosterPath = null;
        setPosterPreview(imgUrl);
        resultsEl.style.display = 'none';
      });
      resultsEl.appendChild(thumb);
    }
  } catch {
    resultsEl.innerHTML = '<span class="poster-search-loading">Search failed — check your API key</span>';
  }
});

document.getElementById('btn-pick-poster').addEventListener('click', async () => {
  const filePath = await window.api.openImage();
  if (!filePath) return;
  pendingPosterPath = filePath;
  const dataUrl = await window.api.getPosterData(filePath);
  if (dataUrl) setPosterPreview(dataUrl);
});

document.getElementById('btn-clear-poster').addEventListener('click', () => {
  pendingPosterPath = null;
  setPosterPreview(null);
});

// ── Save ──────────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', saveEntry);

async function saveEntry() {
  const name = fName.value.trim();
  if (!name) { fName.focus(); return; }

  const type   = document.querySelector('#seg-type .seg.active')?.dataset.val || 'show';
  const status = document.querySelector('#seg-status .seg.active')?.dataset.val || 'watching';
  const rating = parseFloat(fRating.value) || 0;
  const desc   = fDesc.value.trim();

  let season = 1, episode = 0, watchTime = 0, formTotal = 0;
  if (type === 'show') {
    season    = parseInt(fSeason.value)   || 1;
    episode   = parseInt(fEpisode.value)  || 0;
    formTotal = parseInt(fTotalEp.value)  || 0;
  } else {
    const h = parseInt(fHours.value)   || 0;
    const m = parseInt(fMinutes.value) || 0;
    const s = parseInt(fSeconds.value) || 0;
    watchTime = h * 3600 + m * 60 + s;
    const th = parseInt(fTotalHours.value)   || 0;
    const tm = parseInt(fTotalMinutes.value) || 0;
    formTotal = th * 3600 + tm * 60;
  }

  if (editingId !== null) {
    const existing = entries.find(e => e.id === editingId);
    let posterPath = existing?.poster_path || '';
    if (pendingPosterUrl) {
      posterPath = await window.api.downloadPoster(pendingPosterUrl, editingId);
    } else if (pendingPosterPath) {
      posterPath = await window.api.savePoster(pendingPosterPath, editingId);
    } else if (!getPosterPreview()) {
      posterPath = '';
    }
    let total = formTotal || await fetchTMDBMeta(name, type, season);
    const updated = await window.api.updateEntry({
      id: editingId, name, type, season, episode,
      watch_time: watchTime, rating, description: desc, poster_path: posterPath, status, total
    });
    const idx = entries.findIndex(e => e.id === editingId);
    if (idx !== -1) entries[idx] = updated;
  } else {
    const [total, autoPoster] = await Promise.all([
      formTotal ? Promise.resolve(formTotal) : fetchTMDBMeta(name, type, season),
      (!pendingPosterUrl && !pendingPosterPath) ? fetchTMDBPoster(name, type) : Promise.resolve(null)
    ]);
    const newEntry = await window.api.addEntry({
      name, type, season, episode,
      watch_time: watchTime, rating, description: desc, poster_path: '', status, total
    });
    let posterPath = '';
    if (pendingPosterUrl) {
      posterPath = await window.api.downloadPoster(pendingPosterUrl, newEntry.id);
    } else if (pendingPosterPath) {
      posterPath = await window.api.savePoster(pendingPosterPath, newEntry.id);
    } else if (autoPoster) {
      posterPath = await window.api.downloadPoster(autoPoster, newEntry.id);
    }
    if (posterPath) {
      const withPoster = await window.api.updateEntry({ ...newEntry, poster_path: posterPath });
      entries.unshift(withPoster);
    } else {
      entries.unshift(newEntry);
    }
  }

  closeModal();
  render();
}

// ── Utilities ─────────────────────────────────────────────────────────────
const POSTER_GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#2a5298)',
  'linear-gradient(135deg,#1b5e3b,#27a02c)',
  'linear-gradient(135deg,#5f1e3a,#a02752)',
  'linear-gradient(135deg,#3a1e5f,#7c5be8)',
  'linear-gradient(135deg,#5f3a1e,#a86428)',
  'linear-gradient(135deg,#1e4a5f,#1e7a9a)',
  'linear-gradient(135deg,#4a1a1e,#8b2513)',
  'linear-gradient(135deg,#1c1a10,#8b7513)',
];

function posterGradient(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return POSTER_GRADIENTS[Math.abs(h) % POSTER_GRADIENTS.length];
}

function episodeProgress(ep) {
  return Math.min(100, (ep % 13) / 13 * 100);
}

function formatLastWatched(dtStr) {
  // SQLite stores as UTC without 'Z', so append it for correct parsing
  const date = new Date(dtStr.includes('T') ? dtStr : dtStr.replace(' ', 'T') + 'Z');
  if (isNaN(date)) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH / 24);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH   < 24) return `${diffH}h ago`;
  if (diffD   < 7)  return `${diffD}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function formatTime(secs) {
  if (!secs) return '0:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── Start ─────────────────────────────────────────────────────────────────
init();
