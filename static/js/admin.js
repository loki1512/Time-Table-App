/* ─── IIM Sambalpur – Admin Panel JS ─────────────────────────────────────── */
'use strict';

const COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];

function el(id) { return document.getElementById(id); }

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
  const c = el('toastContainer');
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

function openSidebar() { el('sidebar').classList.add('open'); el('sidebarOverlay').classList.add('show'); }
function closeSidebar() { el('sidebar').classList.remove('open'); el('sidebarOverlay').classList.remove('show'); }

// ─── ADMIN VIEW SWITCHING ─────────────────────────────────────────────────────
const adminViews = { sessions: 'Sessions', courses: 'Courses', users: 'Users', import: 'Import Excel' };

function showAdminView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = el(`adminView${capitalize(name)}`);
  if (target) target.classList.add('active');

  Object.keys(adminViews).forEach(k => {
    el(`nav${capitalize(k)}`)?.classList.toggle('active', k === name);
  });

  el('adminTopbarTitle').textContent = adminViews[name] || name;
  closeSidebar();

  // Update topbar add button
  const addBtn = el('topbarAddBtn');
  if (name === 'sessions') {
    addBtn.style.display = '';
    addBtn.onclick = () => openAddSessionModal();
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Session';
  } else if (name === 'courses') {
    addBtn.style.display = '';
    addBtn.onclick = () => openAddCourseModal();
    addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Course';
  } else {
    addBtn.style.display = 'none';
  }

  if (name === 'sessions') loadAdminSessions();
  if (name === 'courses') loadAdminCourses();
  if (name === 'users') loadAdminUsers();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function openAddModal() { /* overridden per view */ }

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
async function loadAdminSessions() {
  const start = el('filterStart').value;
  const end = el('filterEnd').value;
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  try {
    const sessions = await api(`/api/sessions?${params}`);
    renderAdminSessions(sessions);
  } catch (err) {
    el('adminSessionsList').innerHTML = `<div class="loading-text">Error: ${err.message}</div>`;
  }
}

function slotLabel(slot) {
  const m = { 1: '09:30 AM', 2: '11:30 AM', 3: '02:00 PM', 4: '04:00 PM' };
  return m[slot] || `Slot ${slot}`;
}

function renderAdminSessions(sessions) {
  if (sessions.length === 0) {
    el('adminSessionsList').innerHTML = '<div class="loading-text">No sessions found for selected range.</div>';
    return;
  }
  el('adminSessionsList').innerHTML = sessions.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    return `
      <div class="admin-session-item">
        <div class="asi-date-col">
          <div class="asi-date-day">${d.toLocaleDateString('en-IN',{weekday:'short'})}</div>
          <div class="asi-date-num">${d.getDate()}</div>
          <div class="asi-date-month">${d.toLocaleDateString('en-IN',{month:'short'})}</div>
        </div>
        <div class="asi-slot-col">
          <div>${slotLabel(s.slot)}</div>
          <div style="font-size:10px;color:var(--text-3)">Slot ${s.slot}</div>
        </div>
        <div class="asi-content">
          <div class="asi-subject">${escHtml(s.subject_raw || '–')}</div>
          <div class="asi-course">${s.course ? escHtml(`${s.course.short_name} – ${s.course.name}`) : 'No course linked'}</div>
        </div>
        ${s.is_special ? '<span class="asi-special-tag">Special</span>' : ''}
        <div class="asi-actions">
          <button class="action-btn edit" title="Edit" onclick="openEditSessionModal(${JSON.stringify(s).replace(/"/g,'&quot;')})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn delete" title="Delete" onclick="deleteSession(${s.id})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function resetDateFilter() {
  const today = new Date().toISOString().split('T')[0];
  el('filterStart').value = today;
  el('filterEnd').value = today;
  loadAdminSessions();
}

// Session modal
let editingSessionId = null;
let coursesCache = [];

async function openAddSessionModal() {
  editingSessionId = null;
  el('sessionModalTitle').textContent = 'Add Session';
  el('sessionId').value = '';
  el('sessionDate').value = new Date().toISOString().split('T')[0];
  el('sessionSlot').value = '1';
  el('sessionCourse').value = '';
  el('sessionSubject').value = '';
  el('sessionNotes').value = '';
  el('sessionSpecial').checked = false;
  await loadCoursesIntoSelect();
  el('sessionModalOverlay').classList.add('show');
}

function openEditSessionModal(s) {
  editingSessionId = s.id;
  el('sessionModalTitle').textContent = 'Edit Session';
  el('sessionId').value = s.id;
  el('sessionDate').value = s.date;
  el('sessionSlot').value = s.slot;
  el('sessionCourse').value = s.course?.id || '';
  el('sessionSubject').value = s.subject_raw || '';
  el('sessionNotes').value = s.notes || '';
  el('sessionSpecial').checked = s.is_special;
  loadCoursesIntoSelect().then(() => {
    el('sessionCourse').value = s.course?.id || '';
  });
  el('sessionModalOverlay').classList.add('show');
}

function closeSessionModal() { el('sessionModalOverlay').classList.remove('show'); }

async function loadCoursesIntoSelect() {
  try {
    coursesCache = await api('/api/courses');
    const sel = el('sessionCourse');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— No course / Special —</option>' +
      coursesCache.map(c => `<option value="${c.id}">${escHtml(c.short_name)} – ${escHtml(c.name)}</option>`).join('');
    sel.value = cur;
  } catch (e) {}
}

async function saveSession() {
  const btn = el('sessionSaveBtn');
  btn.disabled = true;
  const data = {
    date: el('sessionDate').value,
    slot: parseInt(el('sessionSlot').value),
    course_id: el('sessionCourse').value || null,
    subject_raw: el('sessionSubject').value,
    notes: el('sessionNotes').value,
    is_special: el('sessionSpecial').checked,
  };
  try {
    if (editingSessionId) {
      await api(`/api/sessions/${editingSessionId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Session updated', 'success');
    } else {
      await api('/api/sessions', { method: 'POST', body: JSON.stringify(data) });
      showToast('Session created', 'success');
    }
    closeSessionModal();
    loadAdminSessions();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    showToast('Deleted', 'success');
    loadAdminSessions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── COURSES ──────────────────────────────────────────────────────────────────
async function loadAdminCourses() {
  try {
    const courses = await api('/api/courses');
    if (courses.length === 0) {
      el('adminCoursesGrid').innerHTML = '<div class="loading-text">No courses found.</div>';
      return;
    }
    el('adminCoursesGrid').innerHTML = courses.map(c => `
      <div class="admin-course-card">
        <div class="acc-color-bar" style="background:${c.color}"></div>
        <div class="acc-body">
          <div class="acc-short" style="color:${c.color}">${escHtml(c.short_name || c.code)}</div>
          <div class="acc-name">${escHtml(c.name)}</div>
          <div class="acc-meta">
            <span class="acc-tag">${c.credits} credits</span>
            ${c.area ? `<span class="acc-tag">${escHtml(c.area)}</span>` : ''}
            <span class="acc-tag">${escHtml(c.code)}</span>
            ${c.course_link ? `<a class="acc-tag acc-link-tag" href="${escHtml(c.course_link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🔗 Course Page</a>` : ''}
          </div>
          <div class="acc-faculty">${c.faculty ? escHtml(c.faculty) : '—'}</div>
          <div class="acc-actions">
            <button class="acc-edit-btn" onclick="openEditCourseModal(${JSON.stringify(c).replace(/"/g,'&quot;')})">Edit</button>
            <button class="acc-del-btn" onclick="deleteCourse(${c.id})">Delete</button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    el('adminCoursesGrid').innerHTML = `<div class="loading-text">Error: ${err.message}</div>`;
  }
}

let editingCourseId = null;

function openAddCourseModal() {
  editingCourseId = null;
  el('courseModalTitle').textContent = 'Add Course';
  el('courseId').value = '';
  el('courseCode').value = '';
  el('courseShortName').value = '';
  el('courseName').value = '';
  el('courseCredits').value = '3';
  el('courseArea').value = '';
  el('courseFaculty').value = '';
  el('courseLinkUrl').value = '';
  el('courseColor').value = '#6366f1';
  buildColorPresets();
  el('courseModalOverlay').classList.add('show');
}

function openEditCourseModal(c) {
  editingCourseId = c.id;
  el('courseModalTitle').textContent = 'Edit Course';
  el('courseId').value = c.id;
  el('courseCode').value = c.code || '';
  el('courseShortName').value = c.short_name || '';
  el('courseName').value = c.name || '';
  el('courseCredits').value = c.credits || 3;
  el('courseArea').value = c.area || '';
  el('courseFaculty').value = c.faculty || '';
  el('courseLinkUrl').value = c.course_link || '';
  el('courseColor').value = c.color || '#6366f1';
  buildColorPresets(c.color);
  el('courseModalOverlay').classList.add('show');
}

function closeCourseModal() { el('courseModalOverlay').classList.remove('show'); }

function buildColorPresets(selected) {
  const container = el('colorPresets');
  container.innerHTML = COLORS.map(c => `
    <div class="color-preset${c === selected ? ' selected' : ''}" 
         style="background:${c}" 
         onclick="selectColor('${c}', this)" 
         title="${c}"></div>`).join('');
}

function selectColor(color, el) {
  document.getElementById('courseColor').value = color;
  document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

async function saveCourse() {
  const btn = el('courseSaveBtn');
  btn.disabled = true;
  const data = {
    code: el('courseCode').value,
    short_name: el('courseShortName').value,
    name: el('courseName').value,
    credits: parseFloat(el('courseCredits').value),
    area: el('courseArea').value,
    faculty: el('courseFaculty').value,
    color: el('courseColor').value,
    course_link: el('courseLinkUrl').value.trim() || '',
  };
  try {
    if (editingCourseId) {
      await api(`/api/courses/${editingCourseId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Course updated', 'success');
    } else {
      await api('/api/courses', { method: 'POST', body: JSON.stringify(data) });
      showToast('Course created', 'success');
    }
    closeCourseModal();
    loadAdminCourses();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteCourse(id) {
  if (!confirm('Delete this course? Sessions using it will lose the course link.')) return;
  try {
    await api(`/api/courses/${id}`, { method: 'DELETE' });
    showToast('Course deleted', 'success');
    loadAdminCourses();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── USERS ────────────────────────────────────────────────────────────────────
async function loadAdminUsers() {
  try {
    const users = await api('/api/admin/users');
    el('usersTableBody').innerHTML = users.map(u => `
      <tr>
        <td><strong>${escHtml(u.username)}</strong></td>
        <td style="color:var(--text-2)">${escHtml(u.email)}</td>
        <td>
          <span class="role-badge ${u.is_admin ? 'role-admin' : 'role-user'}">
            ${u.is_admin ? 'Admin' : 'Student'}
          </span>
        </td>
        <td style="color:var(--text-2);font-size:12px">${new Date(u.created_at).toLocaleDateString('en-IN')}</td>
        <td>
          <button class="action-btn edit" title="${u.is_admin ? 'Remove admin' : 'Make admin'}" onclick="toggleAdmin(${u.id}, ${!u.is_admin})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          </button>
        </td>
      </tr>`).join('');
  } catch (err) {
    el('usersTableBody').innerHTML = `<tr><td colspan="5" class="loading-text">Error: ${err.message}</td></tr>`;
  }
}

async function toggleAdmin(id, makeAdmin) {
  if (!confirm(`${makeAdmin ? 'Grant admin rights to' : 'Remove admin rights from'} this user?`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ is_admin: makeAdmin }) });
    showToast(`User updated`, 'success');
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── IMPORT EXCEL ─────────────────────────────────────────────────────────────
async function importExcel() {
  const btn = el('importExcelBtn');
  btn.disabled = true;
  btn.textContent = 'Importing...';
  const result = el('importResult');
  result.style.display = 'none';
  try {
    const data = await api('/api/admin/import-excel', { method: 'POST' });
    result.className = 'import-result success';
    result.textContent = '✅ ' + (data.message || 'Import successful!');
    result.style.display = 'block';
    showToast('Excel imported successfully!', 'success');
  } catch (err) {
    result.className = 'import-result error';
    result.textContent = '❌ Error: ' + err.message;
    result.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import Excel Now';
  }
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Set default date filter to this week
  const today = new Date();
  const week = new Date(today);
  week.setDate(today.getDate() - today.getDay() + 1);
  const weekEnd = new Date(week);
  weekEnd.setDate(week.getDate() + 6);

  el('filterStart').value = week.toISOString().split('T')[0];
  el('filterEnd').value = weekEnd.toISOString().split('T')[0];

  showAdminView('sessions');
  buildColorPresets();
});
