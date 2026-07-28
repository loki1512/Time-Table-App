/* ─── IIM Sambalpur Timetable PWA – Main App JS ─────────────────────────── */

'use strict';

// ─── STATE ──────────────────────────────────────────────────────────────────
const state = {
  currentView: 'today',
  today: null,
  weekStart: null,
  calYear: null,
  calMonth: null,
  allSessions: {},   // date -> [sessions]
  courses: [],
  notifTimer: null,
};

const SLOT_TIMES = {
  1: { start: '09:30', end: '11:00', label: '09:30 AM' },
  2: { start: '11:30', end: '13:00', label: '11:30 AM' },
  3: { start: '14:00', end: '15:30', label: '02:00 PM' },
  4: { start: '16:00', end: '17:30', label: '04:00 PM' },
};

// ─── UTILITY ─────────────────────────────────────────────────────────────────
function fmt(d) {
  return d.toISOString().split('T')[0];
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
  if (name === 'today') loadToday();
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

// ─── TODAY VIEW ───────────────────────────────────────────────────────────────
async function loadToday() {
  const now = new Date();
  state.today = fmt(now);

  el('todayWeekday').textContent = now.toLocaleDateString('en-IN', { weekday: 'long' });
  el('todayFullDate').textContent = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const data = await api('/api/today');
    renderTodaySessions(data.sessions, now);
  } catch (err) {
    el('todaySessions').innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><div class="empty-title">Failed to load</div><div class="empty-desc">${err.message}</div></div>`;
  }
}

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

  // Determine next/current class
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let nextSession = null;
  let currentSession = null;

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

  // Render session cards
  el('todaySessions').innerHTML = sessions.map(s => {
    const st = SLOT_TIMES[s.slot] || {};
    const nowMins2 = now.getHours() * 60 + now.getMinutes();
    let stateClass = 'past';
    let statusTag = '';
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

  const startStr = fmt(mon);
  const endStr = fmt(sun);

  el('weekLabel').textContent = `${fmtShort(mon)} – ${fmtShort(sun)}`;

  try {
    const data = await api(`/api/sessions/week?start=${startStr}&end=${endStr}`);
    renderWeek(data.sessions, mon, sun, today);
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

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
let calSessions = {};

async function loadCalendarSessions(year, month) {
  const start = fmt(new Date(year, month, 1));
  const end = fmt(new Date(year, month + 1, 0));
  try {
    const sessions = await api(`/api/sessions?start=${start}&end=${end}`);
    calSessions = {};
    sessions.forEach(s => {
      if (!calSessions[s.date]) calSessions[s.date] = [];
      calSessions[s.date].push(s);
    });
  } catch (e) {
    console.error(e);
  }
}

async function renderCalendar() {
  const today = new Date();
  if (state.calYear === null) {
    state.calYear = today.getFullYear();
    state.calMonth = today.getMonth();
  }

  await loadCalendarSessions(state.calYear, state.calMonth);

  const monthName = new Date(state.calYear, state.calMonth).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  el('calMonthLabel').textContent = monthName;

  const firstDay = new Date(state.calYear, state.calMonth, 1);
  const lastDay = new Date(state.calYear, state.calMonth + 1, 0);
  // Monday-first: Monday=0 ... Sunday=6
  let startPad = (firstDay.getDay() + 6) % 7;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let html = `
    <div class="cal-weekdays">
      ${days.map(d => `<div class="cal-weekday">${d}</div>`).join('')}
    </div>
    <div class="cal-days">`;

  // Empty cells
  for (let i = 0; i < startPad; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(state.calYear, state.calMonth, d);
    const dateStr = fmt(date);
    const isToday = dateStr === fmt(today);
    const sessions = calSessions[dateStr] || [];
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
  const sessions = calSessions[dateStr] || [];
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

function closeCalDetail() {
  el('calDetail').style.display = 'none';
}

function changeMonth(dir) {
  state.calMonth += dir;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  el('calDetail').style.display = 'none';
  renderCalendar();
}

// ─── COURSES VIEW ─────────────────────────────────────────────────────────────
async function loadCourses() {
  try {
    const courses = await api('/api/courses');
    state.courses = courses;
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
        return `<a class="course-card course-card-link" href="${escHtml(c.course_link)}" target="_blank" rel="noopener" style="--course-color:${c.color}">${cardContent}</a>`;
      }
      return `<div class="course-card" style="--course-color:${c.color}">${cardContent}</div>`;
    }).join('');
  } catch (err) {
    el('coursesGrid').innerHTML = `<div class="empty-state"><div class="empty-title">Failed to load</div></div>`;
  }
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
    await api('/api/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: null,  // local notifications only (no push server needed)
        notify_before_class: el('toggleBeforeClass').checked,
        notify_minutes_before: parseInt(el('minutesBefore').value),
        notify_morning: el('toggleMorning').checked,
        morning_time: el('morningTime').value,
      })
    });
    showToast('Settings saved', 'success');
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

  // Check class notifications
  if (notifyBefore) {
    api(`/api/today`).then(data => {
      data.sessions.forEach(s => {
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
    }).catch(() => {});
  }

  // Re-check in 1 hour
  state.notifTimer = setTimeout(scheduleLocalNotifications, 60 * 60 * 1000);
}

async function sendMorningSummary(dateStr) {
  try {
    const data = await api('/api/today');
    const count = data.sessions.filter(s => !s.is_special).length;
    new Notification('Good Morning! 🌅', {
      body: count > 0
        ? `You have ${count} class${count > 1 ? 'es' : ''} today. First: ${data.sessions[0]?.subject_raw}`
        : 'No classes today! Enjoy your day. 🎉',
      icon: '/static/icons/icon-192.png',
      tag: 'morning-summary',
    });
  } catch (e) { }
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateDateBadge();
  showView('today');

  // Auto-refresh today view every 5 minutes
  setInterval(() => {
    if (state.currentView === 'today') loadToday();
  }, 5 * 60 * 1000);

  // Update date badge every minute
  setInterval(updateDateBadge, 60 * 1000);
});
