/* ─── IIM Sambalpur Timetable PWA – Main App JS ─────────────────────────── */

'use strict';

// ─── STATE ──────────────────────────────────────────────────────────────────
const state = {
  currentView: 'today',
  today: null,
  todayOffset: 0,              // 0 = today, +1 = tomorrow, -1 = yesterday
  weekStart: null,
  calYear: null,
  calMonth: null,
  allSessions: {},   // date -> [sessions]  (populated by prefetch)
  courses: [],
  notifTimer: null,

  // Cache tracking
  sessionsCachedAt: null,      // timestamp of last full fetch
  weekCachedAt: null,          // timestamp of last week fetch
  coursesCachedAt: null,       // timestamp of last courses fetch
  prefetchPromise: null,       // deduplicates concurrent prefetch calls
  lastForcedRefresh: null,     // timestamp of last 6-hour forced refresh
};

// Cache TTLs
const SESSIONS_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const COURSES_TTL_MS  = 10 * 60 * 1000;  // 10 minutes

const SLOT_TIMES = {
  1: { start: '09:30', end: '11:00', label: '09:30 AM' },
  2: { start: '11:30', end: '13:00', label: '11:30 AM' },
  3: { start: '14:00', end: '15:30', label: '02:00 PM' },
  4: { start: '16:00', end: '17:30', label: '04:00 PM' },
};

function fmt(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.split('T')[0];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function toLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="toast-dot"></div><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function el(id) { return document.getElementById(id); }

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
function openSidebar() {
  el('sidebar').classList.add('open');
  el('sidebarOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  el('sidebar').classList.remove('open');
  el('sidebarOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

// ─── VIEW SWITCHING ───────────────────────────────────────────────────────────
const VIEW_TITLES = {
  today: "Today's Schedule",
  week: 'Weekly View',
  calendar: 'Calendar',
  courses: 'Courses',
  notifications: 'Notifications',
};

function showView(name) {
  state.currentView = name;

  // Update views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = el(`view${capitalize(name)}`);
  if (target) target.classList.add('active');

  // Update nav items
  ['today', 'week', 'calendar', 'courses', 'notifications'].forEach(v => {
    el(`nav${capitalize(v)}`)?.classList.toggle('active', v === name);
    el(`bnav${capitalize(v)}`)?.classList.toggle('active', v === name);
  });

  el('topbarTitle').textContent = VIEW_TITLES[name] || name;
  closeSidebar();

  // Lazy-load each view
  if (name === 'today') loadDay(state.todayOffset);
  if (name === 'week') loadWeek();
  if (name === 'calendar') renderCalendar();
  if (name === 'courses') loadCourses();
  if (name === 'notifications') initNotifications();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── DATE BADGE ──────────────────────────────────────────────────────────────
function updateDateBadge() {
  const now = new Date();
  el('dateBadge').textContent = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── SESSION CACHE (prefetch entire term) ─────────────────────────────────────

async function ensureSessionsLoaded({ forceRefresh = false } = {}) {
  const now = Date.now();
  const cacheOk = state.sessionsCachedAt && (now - state.sessionsCachedAt) < SESSIONS_TTL_MS;
  if (!forceRefresh && cacheOk && Object.keys(state.allSessions).length > 0) return;

  if (state.prefetchPromise) { await state.prefetchPromise; return; }

  state.prefetchPromise = (async () => {
    try {
      const sessions = await api('/api/sessions?start=2026-07-01&end=2026-12-31');
      state.allSessions = {};
      sessions.forEach(s => {
        if (!state.allSessions[s.date]) state.allSessions[s.date] = [];
        state.allSessions[s.date].push(s);
      });
      state.sessionsCachedAt = Date.now();
    } finally {
      state.prefetchPromise = null;
    }
  })();

  await state.prefetchPromise;
}

/**
 * Stage 2 of the waterfall: load this week's sessions from the dedicated
 * /api/sessions/week endpoint (small payload, ~100 ms).  Merges the result
 * into state.allSessions so that the Week view renders immediately on first
 * switch.  Then hands off to the full-term prefetch (Stage 3).
 */
async function loadWeekCache() {
  try {
    const data = await api('/api/sessions/week');
    const sessions = data.sessions || [];
    sessions.forEach(s => {
      if (!state.allSessions[s.date]) state.allSessions[s.date] = [];
      // Avoid duplicates if full cache already arrived
      if (!state.allSessions[s.date].find(x => x.id === s.id)) {
        state.allSessions[s.date].push(s);
      }
    });
    state.weekCachedAt = Date.now();
    // If Week view is already visible, re-paint it with the fresh data
    if (state.currentView === 'week') loadWeek();
  } catch (e) {
    // Non-fatal — full-term prefetch will cover this
  }
  // Stage 3 — full-term in background
  prefetchSessionsInBackground();
}

/**
 * Fire-and-forget prefetch. Runs entirely in background — never blocks a view.
 * After the data lands, if Calendar is active re-paint it, so the user sees
 * dots appear without having clicked away and back.
 */
function prefetchSessionsInBackground({ forceRefresh = false } = {}) {
  const p = forceRefresh
    ? ensureSessionsLoaded({ forceRefresh: true })
    : ensureSessionsLoaded();

  p.then(() => {
    // If calendar is visible and was painted with stale/empty cache, repaint it
    if (state.currentView === 'calendar') {
      _paintCalendar(new Date());
    }
  }).catch(() => {});
}

function getCachedSessions(dateStr) { return state.allSessions[dateStr] || []; }

function refreshSessionsInBackground() {
  prefetchSessionsInBackground({ forceRefresh: true });
}

async function ensureCoursesLoaded({ forceRefresh = false } = {}) {
  const now = Date.now();
  const cacheOk = state.coursesCachedAt && (now - state.coursesCachedAt) < COURSES_TTL_MS;
  if (!forceRefresh && cacheOk && state.courses.length > 0) return;
  const courses = await api('/api/courses');
  state.courses = courses;
  state.coursesCachedAt = Date.now();
}

// ─── TODAY / DAY NAVIGATION ───────────────────────────────────────────────────

/**
 * Central entry-point for the Today view.  offset=0 → real today,
 * offset=+1 → tomorrow, offset=-1 → yesterday, etc.
 */
async function loadDay(offset = 0) {
  state.todayOffset = offset;
  const baseDate = new Date();
  const targetDate = addDays(baseDate, offset);
  const dateStr = fmt(targetDate);
  state.today = fmt(baseDate); // always keep today's real date

  // ── Update hero header ─────────────────────────────────────────────────────
  el('todayWeekday').textContent = targetDate.toLocaleDateString('en-IN', { weekday: 'long' });
  el('todayFullDate').textContent = targetDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Show / hide Back-to-Today pill ────────────────────────────────────────
  const pill = el('backToTodayBtn');
  if (pill) pill.style.display = offset !== 0 ? 'flex' : 'none';

  // ── Hide next-class banner when not viewing today ──────────────────────────
  if (offset !== 0) el('nextClassBanner').style.display = 'none';

  // ── Animate slide direction ────────────────────────────────────────────────
  const list = el('todaySessions');
  if (list && offset !== 0) {
    list.classList.remove('slide-in-left', 'slide-in-right');
    void list.offsetWidth; // reflow
    list.classList.add(offset > 0 ? 'slide-in-right' : 'slide-in-left');
  }

  // ── Render from cache if warm ──────────────────────────────────────────────
  const cached = state.allSessions[dateStr];
  if (cached !== undefined || state.sessionsCachedAt) {
    // Full cache warm — use it even for past/future days
    renderTodaySessions(cached || [], targetDate);
    return;
  }

  // ── Cache cold: use fast /api/today for offset=0, or /api/sessions for others
  try {
    let sessions;
    if (offset === 0) {
      const data = await api('/api/today');
      sessions = data.sessions;
    } else {
      sessions = await api(`/api/sessions?start=${dateStr}&end=${dateStr}`);
    }
    renderTodaySessions(sessions, targetDate);
  } catch (err) {
    el('todaySessions').innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><div class="empty-title">Failed to load</div><div class="empty-desc">${err.message}</div></div>`;
  }
}

/** Exposed global — called by Prev/Next buttons and swipe handler */
function changeDay(dir) {
  loadDay(state.todayOffset + dir);
}

/** Called by the Back-to-Today pill */
function jumpToToday() {
  loadDay(0);
}

// Keep loadToday() as a thin alias so existing call-sites (sync-watch, etc.) still work
function loadToday() { loadDay(state.todayOffset); }

function renderTodaySessions(sessions, now) {
  const countEl = el('classCount');
  const realSessions = sessions.filter(s => !s.is_special);
  countEl.textContent = realSessions.length;

  if (sessions.length === 0) {
    el('todaySessions').innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🎉</span>
        <div class="empty-title">No classes today!</div>
        <div class="empty-desc">Enjoy your free day.</div>
      </div>`;
    el('nextClassBanner').style.display = 'none';
    return;
  }

  // ── Next-class banner: only relevant when viewing actual today ────────────
  let nextSession = null;
  let currentSession = null;

  if (state.todayOffset !== 0) {
    el('nextClassBanner').style.display = 'none';
    // Still render session cards below — skip banner logic entirely
  } else {
  // Determine next/current class
  const nowMins = now.getHours() * 60 + now.getMinutes();

  sessions.forEach(s => {
    const st = SLOT_TIMES[s.slot];
    if (!st) return;
    const [sh, sm] = st.start.split(':').map(Number);
    const [eh, em] = st.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;

    if (nowMins >= startMins && nowMins < endMins) {
      currentSession = s;
    } else if (nowMins < startMins && !nextSession) {
      nextSession = s;
    }
  });

  // Show next class banner
  if (nextSession || currentSession) {
    const banner = el('nextClassBanner');
    banner.style.display = 'flex';
    if (currentSession) {
      el('nextClassTimer').textContent = 'IN PROGRESS';
      el('nextClassSubject').textContent = currentSession.subject_raw || 'Class ongoing';
      banner.style.background = 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(59,130,246,0.08))';
    } else {
      // Count down
      updateCountdown(nextSession, now);
    }
  } else {
    el('nextClassBanner').style.display = 'none';
  }
  } // close outer else (offset === 0 banner block)

  // Render session cards
  el('todaySessions').innerHTML = sessions.map(s => {
    const st = SLOT_TIMES[s.slot] || {};
    let stateClass = 'upcoming';
    let statusTag = '';

    if (state.todayOffset < 0) {
      // Viewing a past day — all sessions are done
      stateClass = 'past';
    } else if (state.todayOffset > 0) {
      // Viewing a future day — all sessions are upcoming, no Now/Next tags
      stateClass = 'upcoming';
    } else {
      // Viewing today — use live time-of-day logic
      const nowMins2 = now.getHours() * 60 + now.getMinutes();
      stateClass = 'past';
      if (s.slot && st.start) {
        const [sh, sm] = st.start.split(':').map(Number);
        const [eh, em] = st.end.split(':').map(Number);
        const startM = sh * 60 + sm;
        const endM = eh * 60 + em;
        if (nowMins2 >= startM && nowMins2 < endM) {
          stateClass = 'current';
          statusTag = '<span class="session-status-tag status-now">Now</span>';
        } else if (nowMins2 < startM) {
          stateClass = 'upcoming';
          if (s === nextSession) statusTag = '<span class="session-status-tag status-next">Next</span>';
        }
      }
    }
    if (s.is_special) stateClass += ' special';

    const color = s.course?.color || '#6366f1';
    const faculty = s.course?.faculty || '';
    const credits = s.course?.credits ? `${s.course.credits} cr` : '';
    const area = s.course?.area || '';

    return `
      <div class="session-card ${stateClass}" style="--course-color: ${color}">
        <div class="session-time-col">
          <div class="session-time-slot">Slot ${s.slot}</div>
          <div class="session-time">${formatTime(st.start)}</div>
          <div class="session-sep">↓</div>
          <div class="session-time">${formatTime(st.end)}</div>
        </div>
        <div class="session-body">
          <div class="session-subject">${escHtml(s.subject_raw || 'Class')}</div>
          <div class="session-meta">
            ${s.course ? `<span class="session-badge" style="background:${color}22;color:${color};border-color:${color}44">${escHtml(s.course.short_name)}</span>` : ''}
            ${s.is_special ? '<span class="session-badge special-badge">Special</span>' : ''}
            ${credits ? `<span class="session-badge" style="background:none">${credits}</span>` : ''}
            ${area ? `<span class="session-badge" style="background:none">${area}</span>` : ''}
            ${statusTag}
          </div>
          ${faculty ? `<div class="session-faculty">👤 ${escHtml(truncate(faculty, 60))}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function updateCountdown(session, now) {
  const st = SLOT_TIMES[session.slot];
  if (!st) return;
  const [sh, sm] = st.start.split(':').map(Number);
  const targetMins = sh * 60 + sm;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const diffMins = targetMins - nowMins;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  el('nextClassTimer').textContent = h > 0 ? `${h}h ${m}m` : `${m} min`;
  el('nextClassSubject').textContent = session.subject_raw || 'Next class';
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

// ─── WEEK VIEW ────────────────────────────────────────────────────────────────
let weekOffset = 0;

async function loadWeek() {
  // Monday-based week
  const today = new Date();
  const mon = new Date(today);
  const dayOfWeek = today.getDay();
  mon.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  const sun = addDays(mon, 6);

  el('weekLabel').textContent = `${fmtShort(mon)} – ${fmtShort(sun)}`;

  // Render from cache immediately (even if partially warm)
  const days = [];
  for (let i = 0; i <= 6; i++) days.push(addDays(mon, i));

  if (state.sessionsCachedAt) {
    // Cache exists — paint instantly
    const weekSessions = days.flatMap(d => state.allSessions[fmt(d)] || []);
    renderWeek(weekSessions, mon, sun, today);
    return;
  }

  // Cache is cold — wait for the background prefetch (already in flight from DOMContentLoaded)
  try {
    await ensureSessionsLoaded();
    const weekSessions = days.flatMap(d => state.allSessions[fmt(d)] || []);
    renderWeek(weekSessions, mon, sun, today);
  } catch (err) {
    el('weekGrid').innerHTML = `<div class="empty-state"><div class="empty-title">Failed to load</div></div>`;
  }
}

function fmtShort(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function renderWeek(sessions, mon, sun, today) {
  // Group by date
  const byDate = {};
  sessions.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  const days = [];
  for (let i = 0; i <= 6; i++) {
    days.push(addDays(mon, i));
  }

  el('weekGrid').innerHTML = days.map(d => {
    const dateStr = fmt(d);
    const daySessions = byDate[dateStr] || [];
    const isToday = dateStr === fmt(today);

    const sessionsHtml = daySessions.length === 0
      ? '<div class="week-no-class">No classes</div>'
      : daySessions.map(s => {
          const st = SLOT_TIMES[s.slot] || {};
          const color = s.course?.color || '#6366f1';
          return `
            <div class="week-session-item" style="--course-color:${color}">
              <div class="week-session-time">${formatTime(st.start)}</div>
              <div class="week-session-subject">${escHtml(s.subject_raw || 'Class')}</div>
            </div>`;
        }).join('');

    return `
      <div class="week-day-card ${isToday ? 'week-day-today' : ''}">
        <div class="week-day-header">
          <div class="week-day-name">${d.toLocaleDateString('en-IN', { weekday: 'short' })}, ${d.getDate()}</div>
          ${isToday ? '<span class="week-day-badge">Today</span>' : `<span style="font-size:12px;color:var(--text-2)">${d.toLocaleDateString('en-IN', { month: 'short' })}</span>`}
        </div>
        <div class="week-sessions">${sessionsHtml}</div>
      </div>`;
  }).join('');
}

function changeWeek(dir) {
  weekOffset += dir;
  loadWeek();
}

// ─── CALENDAR VIEW ─────────────────────────────────────────────────────────────────
function renderCalendar() {
  const today = new Date();
  if (state.calYear === null) {
    state.calYear = today.getFullYear();
    state.calMonth = today.getMonth();
  }

  // Paint immediately from whatever is in cache (may be empty dots if still loading)
  _paintCalendar(today);

  // If the big prefetch hasn't completed yet, show a subtle loading indicator
  // and re-paint the moment data arrives — no user action required
  if (state.prefetchPromise) {
    _showCalendarLoadingHint(true);
    state.prefetchPromise.then(() => {
      _showCalendarLoadingHint(false);
      _paintCalendar(new Date());
    }).catch(() => {
      _showCalendarLoadingHint(false);
    });
  }
}

function _showCalendarLoadingHint(show) {
  let hint = el('calLoadingHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'calLoadingHint';
    hint.style.cssText = [
      'text-align:center',
      'font-size:12px',
      'color:var(--text-3, #888)',
      'padding:6px 0 2px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:6px',
      'transition:opacity 0.3s',
    ].join(';');
    hint.innerHTML = `<span class="cal-spinner"></span><span>Loading calendar…</span>`;
    // Insert before the grid
    const grid = el('calendarGrid');
    grid?.parentNode?.insertBefore(hint, grid);
  }
  hint.style.opacity = show ? '1' : '0';
  setTimeout(() => { if (!show && hint) hint.remove(); }, show ? 0 : 350);
}

function _paintCalendar(today) {
  const monthName = new Date(state.calYear, state.calMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  el('calMonthLabel').textContent = monthName;

  const firstDay = new Date(state.calYear, state.calMonth, 1);
  const lastDay = new Date(state.calYear, state.calMonth + 1, 0);
  let startPad = (firstDay.getDay() + 6) % 7;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let html = `
    <div class="cal-weekdays">
      ${days.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
    </div>
    <div class="cal-days">`;

  for (let i = 0; i < startPad; i++) html += '<div class="cal-day empty"></div>';

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(state.calYear, state.calMonth, d);
    const dateStr = fmt(date);
    const isToday = dateStr === fmt(today);
    const sessions = state.allSessions[dateStr] || [];
    const dots = sessions.slice(0, 4).map(s => {
      const color = s.course?.color || (s.is_special ? '#f59e0b' : '#6366f1');
      return `<div class="cal-dot" style="background:${color}"></div>`;
    }).join('');
    html += `
      <div class="cal-day${isToday ? ' today' : ''}${sessions.length > 0 ? ' has-class' : ''}" onclick="showCalDay('${dateStr}')">
        <div class="cal-day-num">${d}</div>
        ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
      </div>`;
  }
  html += '</div>';
  el('calendarGrid').innerHTML = html;
}

function showCalDay(dateStr) {
  const sessions = state.allSessions[dateStr] || [];
  const d = toLocalDate(dateStr);
  el('calDetailDate').textContent = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  if (sessions.length === 0) {
    el('calDetailSessions').innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-desc">No sessions on this day.</div></div>';
  } else {
    el('calDetailSessions').innerHTML = sessions.map(s => {
      const st = SLOT_TIMES[s.slot] || {};
      const color = s.course?.color || '#6366f1';
      return `
        <div class="week-session-item" style="--course-color:${color}">
          <div class="week-session-time">${formatTime(st.start)}</div>
          <div class="week-session-subject">${escHtml(s.subject_raw || 'Class')}</div>
        </div>`;
    }).join('');
  }
  el('calDetail').style.display = 'block';
  el('calDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeCalDetail() { el('calDetail').style.display = 'none'; }

function changeMonth(dir) {
  state.calMonth += dir;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  el('calDetail').style.display = 'none';
  // Paint instantly from cache — no network call
  _paintCalendar(new Date());
}

// ─── COURSES VIEW ───────────────────────────────────────────────────────────────
async function loadCourses() {
  if (state.courses.length > 0) {
    renderCourses(state.courses);
    const now = Date.now();
    if (!state.coursesCachedAt || (now - state.coursesCachedAt) > COURSES_TTL_MS) {
      ensureCoursesLoaded({ forceRefresh: true }).then(() => renderCourses(state.courses)).catch(() => {});
    }
    return;
  }
  try {
    await ensureCoursesLoaded();
    renderCourses(state.courses);
  } catch (err) {
    el('coursesGrid').innerHTML = `<div class="empty-state"><div class="empty-title">Failed to load</div></div>`;
  }
}

function renderCourses(courses) {
  if (courses.length === 0) {
    el('coursesGrid').innerHTML = `<div class="empty-state"><span class="empty-icon">📚</span><div class="empty-title">No courses</div></div>`;
    return;
  }
  el('coursesGrid').innerHTML = courses.map(c => {
    const hasLink = c.course_link && c.course_link.trim() !== '';
    const cardContent = `
      <div class="course-abbr">${escHtml(c.short_name || c.code)}</div>
      <div class="course-name">${escHtml(c.name)}</div>
      <div class="course-meta">
        <span class="course-tag">${c.credits} cr</span>
        ${c.area ? `<span class="course-tag">${escHtml(c.area)}</span>` : ''}
        <span class="course-tag">${escHtml(c.code)}</span>
      </div>
      ${c.faculty ? `<div class="course-faculty">👤 ${escHtml(c.faculty)}</div>` : ''}
      ${hasLink ? `<div class="course-link-hint">View Course →</div>` : ''}`;
    if (hasLink) {
      return `<a class="course-card course-card-link" href="${escHtml(c.course_link)}" target="_blank" rel="noopener" onclick="window.open(this.href, '_blank'); return false;" style="--course-color:${c.color}">${cardContent}</a>`;
    }
    return `<div class="course-card" style="--course-color:${c.color}">${cardContent}</div>`;
  }).join('');
}


// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function initNotifications() {
  const dotEl = el('notifDot');
  const statusEl = el('notifStatus');
  const enableBtn = el('notifEnableBtn');
  const settingsCard = el('notifSettings');
  const infoBox = el('notifInfoBox');

  if (!('Notification' in window)) {
    dotEl.className = 'notif-status-dot denied';
    statusEl.textContent = 'Notifications not supported in this browser.';
    return;
  }

  const perm = Notification.permission;

  if (perm === 'granted') {
    dotEl.className = 'notif-status-dot granted';
    statusEl.textContent = 'Notifications are enabled.';
    settingsCard.style.display = 'block';
    enableBtn.style.display = 'none';
    // Load saved settings
    loadNotifSettings();
    // Start local scheduler
    scheduleLocalNotifications();
  } else if (perm === 'denied') {
    dotEl.className = 'notif-status-dot denied';
    statusEl.textContent = 'Notifications blocked. Enable them in browser settings.';
    infoBox.style.display = 'flex';
    el('notifInfoText').textContent = 'To enable: click the lock/info icon in the address bar and allow notifications.';
  } else {
    dotEl.className = 'notif-status-dot default';
    statusEl.textContent = 'Notifications not yet enabled.';
    enableBtn.style.display = 'block';
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getBrowserPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/notifications/vapid-public-key');
    if (!publicKey) return null;

    let sub = await reg.pushManager.getSubscription();
    // If an existing subscription exists, renew it with the current VAPID key
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch (e) {}
    }

    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    return sub ? sub.toJSON() : null;
  } catch (err) {
    console.warn('[Push] Subscription failed:', err);
    return null;
  }
}

async function requestNotifPermission() {
  const perm = await Notification.requestPermission();
  initNotifications();
  if (perm === 'granted') {
    showToast('Notifications enabled!', 'success');
    await saveNotifSettings();
  }
}

async function loadNotifSettings() {
  try {
    const s = await api('/api/notifications/settings');
    el('toggleBeforeClass').checked = s.notify_before_class;
    el('minutesBefore').value = s.notify_minutes_before;
    el('toggleMorning').checked = s.notify_morning;
    el('morningTime').value = s.morning_time;
  } catch (e) { }
}

async function saveNotifSettings() {
  if (Notification.permission !== 'granted') return;
  try {
    const pushSub = await getBrowserPushSubscription();
    await api('/api/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: pushSub,
        notify_before_class: el('toggleBeforeClass').checked,
        notify_minutes_before: parseInt(el('minutesBefore').value),
        notify_morning: el('toggleMorning').checked,
        morning_time: el('morningTime').value,
      })
    });
    showToast('Settings saved & Push notifications active!', 'success');
    scheduleLocalNotifications();
  } catch (e) {
    showToast('Failed to save settings', 'error');
  }
}

// Local notification scheduler (runs in-browser tab)
function scheduleLocalNotifications() {
  clearTimeout(state.notifTimer);

  if (Notification.permission !== 'granted') return;

  const notifyBefore = el('toggleBeforeClass')?.checked ?? true;
  const minsBefore = parseInt(el('minutesBefore')?.value ?? 15);
  const morningEnabled = el('toggleMorning')?.checked ?? true;
  const morningTime = el('morningTime')?.value ?? '07:00';

  const now = new Date();
  const todayStr = fmt(now);

  // Check morning notification
  if (morningEnabled) {
    const [mh, mm] = morningTime.split(':').map(Number);
    const morningMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), mh, mm, 0) - now;
    if (morningMs > 0 && morningMs < 24 * 60 * 60 * 1000) {
      setTimeout(() => sendMorningSummary(todayStr), morningMs);
    }
  }

  // Check class notifications — use cached data if available
  if (notifyBefore) {
    const todaySessions = getCachedSessions(todayStr);
    if (todaySessions.length > 0) {
      _scheduleClassNotifs(todaySessions, now, minsBefore);
    } else {
      api('/api/today').then(data => _scheduleClassNotifs(data.sessions, now, minsBefore)).catch(() => {});
    }
  }

  // Re-check in 1 hour
  state.notifTimer = setTimeout(scheduleLocalNotifications, 60 * 60 * 1000);
}

function _scheduleClassNotifs(sessions, now, minsBefore) {
  sessions.forEach(s => {
    if (s.is_special) return;
    const st = SLOT_TIMES[s.slot];
    if (!st) return;
    const [sh, sm] = st.start.split(':').map(Number);
    const classTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0);
    const alertTime = new Date(classTime.getTime() - minsBefore * 60 * 1000);
    const delay = alertTime - now;
    if (delay > 0 && delay < 8 * 60 * 60 * 1000) {
      setTimeout(() => {
        new Notification('Class Starting Soon! 📚', {
          body: `${s.subject_raw} starts in ${minsBefore} minutes`,
          icon: '/static/icons/icon-192.png',
          badge: '/static/icons/badge.png',
          tag: `class-${s.id}`,
          silent: false,
        });
      }, delay);
    }
  });
}

async function sendMorningSummary(dateStr) {
  try {
    // Use cache if warm, otherwise fetch from API so we always have real data
    let sessions = getCachedSessions(dateStr);
    if (sessions.length === 0) {
      try {
        const data = await api('/api/today');
        sessions = data.sessions || [];
      } catch (e) { /* ignore network errors */ }
    }
    const classSessions = sessions.filter(s => !s.is_special);
    const count = classSessions.length;
    const body = count > 0
      ? `You have ${count} class${count > 1 ? 'es' : ''} today. First: ${classSessions[0]?.subject_raw}`
      : 'No classes today! Enjoy your day. 🎉';
    new Notification('Good Morning! 🌅', {
      body,
      icon: '/static/icons/icon-192.png',
      tag: 'morning-summary',
    });
  } catch (e) { }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateDateBadge();

  // ── Shell-first / waterfall strategy ────────────────────────────────────────
  // Stage 1: Render Today instantly (uses /api/today if cache cold)
  showView('today');

  // Stage 2 (next tick): load this week → Stage 3 (after week): full term.
  // This 3-stage pipeline means:
  //   • Today  — instant  (Stage 1)
  //   • Week   — ~100 ms later (Stage 2 week payload)
  //   • Calendar / all other dates — warm by the time the user navigates there
  setTimeout(() => {
    loadWeekCache();           // Stage 2 → fires Stage 3 internally
    ensureCoursesLoaded().catch(() => {});
  }, 0);

  // ── Swipe gesture on Today sessions list ─────────────────────────────────
  _initTodaySwipe();

  // 3. If notifications are already granted, silently re-register the push
  //    subscription with the server so the stored endpoint stays fresh after
  //    browser restarts (subscriptions can rotate). This is what makes
  //    server-side daily reminders work reliably.
  if ('Notification' in window && Notification.permission === 'granted') {
    setTimeout(async () => {
      try {
        const pushSub = await getBrowserPushSubscription();
        const s = await api('/api/notifications/settings');
        await api('/api/notifications/subscribe', {
          method: 'POST',
          body: JSON.stringify({
            subscription: pushSub,
            notify_before_class: s.notify_before_class,
            notify_minutes_before: s.notify_minutes_before,
            notify_morning: s.notify_morning,
            morning_time: s.morning_time,
          })
        });
        // Re-arm the local scheduler now that we have a fresh subscription
        scheduleLocalNotifications();
      } catch (e) {
        // Non-fatal — local notifications still work even if push re-reg fails
        scheduleLocalNotifications();
      }
    }, 2000); // wait 2 s so SW is ready
  }

  // Auto-refresh today view every 5 minutes (reads from cache if fresh)
  setInterval(() => {
    if (state.currentView === 'today') loadToday();
  }, 5 * 60 * 1000);

  // Silently refresh session cache every 5 minutes in the background
  setInterval(refreshSessionsInBackground, SESSIONS_TTL_MS);

  // Watch for timetable syncs — invalidate cache within ~1 min of any sync
  watchForTimetableSync();

  // Update date badge every minute
  setInterval(updateDateBadge, 60 * 1000);

  // Show one-time disclaimer on first visit (localStorage-gated, no DB)
  showDisclaimer();
  
  // Show day navigation feature tour
  showDayNavTour();
});

// ─── DAY NAV FEATURE TOUR ────────────────────────────────────────────────────
const DAY_NAV_TOUR_KEY = 'iim_day_nav_tour_ack';

function showDayNavTour() {
  if (!localStorage.getItem(DAY_NAV_TOUR_KEY)) {
    const el = document.getElementById('dayNavTour');
    if (el) el.style.display = 'flex';
  }
}

function dismissDayNavTour() {
  localStorage.setItem(DAY_NAV_TOUR_KEY, '1');
  const el = document.getElementById('dayNavTour');
  if (el) el.style.display = 'none';
}

// ─── SWIPE GESTURE (Today view) ───────────────────────────────────────────────
function _initTodaySwipe() {
  const container = el('viewToday');
  if (!container) return;
  let startX = 0, startY = 0;
  container.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  container.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // Only treat horizontal swipes (dx > 50 px, and more horizontal than vertical)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      changeDay(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
}

// ─── ONE-TIME DISCLAIMER ─────────────────────────────────────────────────────
const DISCLAIMER_KEY = 'iim_disclaimer_ack';

function showDisclaimer() {
  if (localStorage.getItem(DISCLAIMER_KEY)) return; // already seen on this device
  // Small delay so the main UI renders first — less jarring
  setTimeout(() => {
    el('disclaimerBackdrop').classList.add('show');
    el('disclaimerSheet').classList.add('show');
    el('disclaimerGotIt').focus();
  }, 600);
}

function dismissDisclaimer() {
  el('disclaimerBackdrop').classList.remove('show');
  el('disclaimerSheet').classList.remove('show');
  localStorage.setItem(DISCLAIMER_KEY, '1');
}

// ─── SYNC WATCH ───────────────────────────────────────────────────────────────
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Poll /api/last-sync every 60 s (reactive) AND force a full refresh every
 * 6 hours regardless (proactive cadence).
 */
async function watchForTimetableSync() {
  const POLL_MS = 60 * 1000;
  state.lastForcedRefresh = Date.now();

  async function check() {
    try {
      const { last_sync } = await api('/api/last-sync');
      const now = Date.now();

      // ── Reactive: server has new data since our cache ──────────────────────
      if (last_sync) {
        const serverSyncMs = new Date(last_sync).getTime();
        if (state.sessionsCachedAt && serverSyncMs > state.sessionsCachedAt) {
          console.log('[Sync Watch] Timetable updated on server — refreshing...');
          await ensureSessionsLoaded({ forceRefresh: true });
          const v = state.currentView;
          if (v === 'today')    loadToday();
          if (v === 'week')     loadWeek();
          if (v === 'calendar') _paintCalendar(new Date());
          showToast('Timetable updated!', 'success');
          state.lastForcedRefresh = now;
          return;
        }
      }

      // ── Proactive: force a refresh every 6 hours ───────────────────────────
      if (now - state.lastForcedRefresh >= SIX_HOURS_MS) {
        console.log('[Sync Watch] 6-hour proactive refresh...');
        state.lastForcedRefresh = now;
        await ensureSessionsLoaded({ forceRefresh: true });
        const v = state.currentView;
        if (v === 'today')    loadToday();
        if (v === 'week')     loadWeek();
        if (v === 'calendar') _paintCalendar(new Date());
      }
    } catch (e) { /* network errors are non-fatal */ }
  }

  // Wait 30 s for initial load to complete, then check every minute
  setTimeout(() => { check(); setInterval(check, POLL_MS); }, 30 * 1000);
}

// ─── PROFILE DRAWER ───────────────────────────────────────────────────────────
async function openProfile() {
  try {
    const me = await api('/api/profile');
    el('profileAvatar').textContent = me.username[0].toUpperCase();
    el('profileName').textContent = me.username;
    el('profileRole').textContent = me.is_super_admin ? '★ Super Admin' : me.is_admin ? 'Administrator' : 'Student';
    el('profileEmail').value = me.email;

    const usernameGroup = el('profileUsernameGroup');
    const usernameLockedGroup = el('profileUsernameLockedGroup');
    if (me.is_super_admin) {
      // Hide the editable username field — super admin name is permanently 'admin'
      if (usernameGroup) usernameGroup.style.display = 'none';
      if (usernameLockedGroup) usernameLockedGroup.style.display = '';
    } else {
      if (usernameGroup) usernameGroup.style.display = '';
      if (usernameLockedGroup) usernameLockedGroup.style.display = 'none';
      el('profileUsername').value = me.username;
    }

    el('profileCurrentPwd').value = '';
    el('profileNewPwd').value = '';
    el('profileConfirmPwd').value = '';
  } catch (e) { /* silently ignore if profile fetch fails */ }
  el('profileOverlay').classList.add('show');
  el('profileDrawer').classList.add('open');
  closeSidebar();
}

function closeProfile() {
  el('profileOverlay').classList.remove('show');
  el('profileDrawer').classList.remove('open');
}

async function saveProfile() {
  const btn = el('profileSaveBtn');
  btn.disabled = true;
  try {
    const payload = { email: el('profileEmail').value.trim() };
    // Only send username if the field is visible (non-super-admin)
    const usernameGroup = el('profileUsernameGroup');
    if (!usernameGroup || usernameGroup.style.display !== 'none') {
      payload.username = el('profileUsername').value.trim();
    }
    const updated = await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    // Reflect new username in sidebar
    el('profileAvatar').textContent = updated.username[0].toUpperCase();
    el('profileName').textContent = updated.username;
    document.querySelector('.user-avatar')?.setAttribute('data-initial', updated.username[0].toUpperCase());
    document.querySelector('.user-name')?.textContent && (document.querySelector('.user-name').textContent = updated.username);
    showToast('Profile updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function changeOwnPassword() {
  const currentPwd = el('profileCurrentPwd').value;
  const newPwd = el('profileNewPwd').value;
  const confirmPwd = el('profileConfirmPwd').value;
  if (!currentPwd) { showToast('Enter your current password', 'error'); return; }
  if (!newPwd || newPwd.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
  if (newPwd !== confirmPwd) { showToast('Passwords do not match', 'error'); return; }
  const btn = el('profilePwdBtn');
  btn.disabled = true;
  try {
    await api('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
    });
    el('profileCurrentPwd').value = '';
    el('profileNewPwd').value = '';
    el('profileConfirmPwd').value = '';
    showToast('Password updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function toggleProfilePwd(inputId, btn) {
  const inp = el(inputId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
