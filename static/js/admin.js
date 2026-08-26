/* â”€â”€â”€ IIM Sambalpur â€“ Admin Panel JS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
'use strict';

const COLORS = ['#2952CC','#4F78E8','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];

function el(id) { return document.getElementById(id); }

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(d) {
  if (!d) return '';
  if (typeof d === 'string') return d.split('T')[0];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// ─── ADMIN VIEW SWITCHING ──────────────────────────────────────────────────
const adminViews = { 
  sessions: 'Sessions', 
  courses: 'Courses', 
  users: 'Users', 
  import: 'Import Excel', 
  slots: 'Time Slots',
  broadcast: 'Broadcast Alerts'
};

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
  if (name === 'slots') loadAdminSlots();
  if (name === 'import') loadExcelFiles();
  if (name === 'broadcast') loadBroadcastInfo();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function openAddModal() { /* overridden per view */ }

// â”€â”€â”€ SESSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAdminSessions() {
  if (!slotsCache || slotsCache.length === 0) {
    try { slotsCache = await api('/api/slots'); } catch(e) {}
  }
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
  const s = slotsCache.find(x => x.slot_number === slot);
  if (s) return s.label;
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
          <div class="asi-subject">${escHtml(s.subject_raw || 'â€“')}</div>
          <div class="asi-course">${s.course ? escHtml(`${s.course.short_name} â€“ ${s.course.name}`) : 'No course linked'}</div>
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
  const today = fmt(new Date());
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
  el('sessionDate').value = fmt(new Date());
  el('sessionSubject').value = '';
  el('sessionNotes').value = '';
  el('sessionSpecial').checked = false;
  await Promise.all([loadCoursesIntoSelect(), loadSlotsIntoSelect()]);
  const firstSlot = slotsCache.length > 0 ? slotsCache[0].slot_number : '1';
  el('sessionSlot').value = firstSlot;
  el('sessionCourse').value = '';
  el('sessionModalOverlay').classList.add('show');
}

function openEditSessionModal(s) {
  editingSessionId = s.id;
  el('sessionModalTitle').textContent = 'Edit Session';
  el('sessionId').value = s.id;
  el('sessionDate').value = s.date;
  el('sessionSubject').value = s.subject_raw || '';
  el('sessionNotes').value = s.notes || '';
  el('sessionSpecial').checked = s.is_special;
  Promise.all([loadCoursesIntoSelect(), loadSlotsIntoSelect()]).then(() => {
    el('sessionCourse').value = s.course?.id || '';
    el('sessionSlot').value = s.slot;
  });
  el('sessionModalOverlay').classList.add('show');
}

function closeSessionModal() { el('sessionModalOverlay').classList.remove('show'); }

async function loadCoursesIntoSelect() {
  try {
    coursesCache = await api('/api/courses');
    const sel = el('sessionCourse');
    const cur = sel.value;
    sel.innerHTML = '<option value="">â€” No course / Special â€”</option>' +
      coursesCache.map(c => `<option value="${c.id}">${escHtml(c.short_name)} â€“ ${escHtml(c.name)}</option>`).join('');
    sel.value = cur;
  } catch (e) {}
}

async function loadSlotsIntoSelect() {
  try {
    slotsCache = await api('/api/slots');
    const sel = el('sessionSlot');
    const cur = sel.value;
    sel.innerHTML = slotsCache.map(s => `<option value="${s.slot_number}">${escHtml(s.label)}</option>`).join('');
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

// â”€â”€â”€ COURSES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            ${c.course_link ? `<a class="acc-tag acc-link-tag" href="${escHtml(c.course_link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">ðŸ”— Course Page</a>` : ''}
          </div>
          <div class="acc-faculty">${c.faculty ? escHtml(c.faculty) : 'â€”'}</div>
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
  el('courseColor').value = '#2952CC';
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
  el('courseColor').value = c.color || '#2952CC';
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

// â”€â”€â”€ USERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ IMPORT EXCEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadExcelFiles() {
  const select = el('excelFileSelect');
  if (select) {
    select.innerHTML = '<option value="">Loading files...</option>';
    try {
      const files = await api('/api/admin/excel-files');
      if (files.length === 0) {
        select.innerHTML = '<option value="">No Excel files found</option>';
      } else {
        select.innerHTML = files.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
      }
    } catch (err) {
      select.innerHTML = `<option value="">Error loading files: ${err.message}</option>`;
    }
  }

  // Check server-side Google Sync configuration
  try {
    const status = await api('/api/admin/sync-status');
    const indicator = el('syncStatusIndicator');
    const syncInput = el('googleSyncUrlInput');
    if (status.configured) {
      if (indicator) indicator.style.display = 'block';
      if (syncInput && status.url) {
        syncInput.value = status.url;
      }
    }
  } catch (e) {}

  // Fallback: Restore saved Google Apps Script Sync URL from localStorage if input is still empty
  const savedSyncUrl = localStorage.getItem('iim_google_sync_url');
  const syncInput = el('googleSyncUrlInput');
  if (syncInput && savedSyncUrl && !syncInput.value) {
    syncInput.value = savedSyncUrl;
  }
}

async function syncGoogleSheet() {
  const btn = el('googleSyncBtn');
  const result = el('googleSyncResult');

  btn.disabled = true;
  btn.textContent = 'Syncing with Google...';
  result.style.display = 'none';

  try {
    const data = await api('/api/admin/sync-google-sheet', {
      method: 'POST',
      body: JSON.stringify({})
    });
    result.className = 'import-result success';
    result.textContent = '[OK] ' + (data.message || 'Timetable synced successfully!');
    result.style.display = 'block';
    showToast('Timetable synced from Google Sheet!', 'success');
  } catch (err) {
    result.className = 'import-result error';
    result.textContent = '[Error] ' + err.message;
    result.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Sync Timetable Now';
  }
}

// ─── BROADCAST NOTIFICATIONS ────────────────────────────────────────────────
async function loadBroadcastInfo() {
  const badge = el('subscriberCountBadge');
  if (badge) {
    try {
      const data = await api('/api/admin/notification-subscribers-count');
      badge.innerHTML = `<span class="badge" style="background:rgba(41,82,204,0.15); color:var(--accent-2); padding:4px 10px; border-radius:6px;">📱 <strong>${data.count}</strong> user(s) subscribed to live push alerts</span>`;
    } catch (e) {
      badge.textContent = '';
    }
  }

  // Bind live preview
  const titleInput = el('notifTitle');
  const bodyInput = el('notifBody');
  const prevTitle = el('previewTitle');
  const prevBody = el('previewBody');

  if (titleInput && prevTitle) {
    titleInput.oninput = () => {
      prevTitle.textContent = titleInput.value.trim() || 'Notification Title';
    };
  }
  if (bodyInput && prevBody) {
    bodyInput.oninput = () => {
      prevBody.textContent = bodyInput.value.trim() || 'Message body will appear here...';
    };
  }
}

async function sendBroadcastNotification() {
  const title = el('notifTitle')?.value.trim();
  const body = el('notifBody')?.value.trim();
  const url = el('notifUrl')?.value.trim() || '/';
  const btn = el('sendBroadcastBtn');
  const result = el('broadcastResult');

  if (!title || !body) {
    showToast('Please enter both Title and Message', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending Push Alerts...';
  result.style.display = 'none';

  try {
    const data = await api('/api/admin/broadcast-notification', {
      method: 'POST',
      body: JSON.stringify({ title, body, url })
    });
    result.className = 'import-result success';
    result.textContent = '[OK] ' + (data.message || 'Notification broadcast successfully!');
    result.style.display = 'block';
    showToast(data.message || 'Sent successfully!', 'success');

    // Clear form
    el('notifTitle').value = '';
    el('notifBody').value = '';
    el('previewTitle').textContent = 'Notification Title';
    el('previewBody').textContent = 'Message body will appear here...';
    loadBroadcastInfo();
  } catch (err) {
    result.className = 'import-result error';
    result.textContent = '[Error] ' + err.message;
    result.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Notification to All Users';
  }
}

async function importExcel() {
  const btn = el('importExcelBtn');
  const select = el('excelFileSelect');
  const filename = select ? select.value : '';
  
  if (!filename) {
    showToast('Please select an Excel file', 'error');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Importing...';
  const result = el('importResult');
  result.style.display = 'none';
  try {
    const data = await api('/api/admin/import-excel', { 
      method: 'POST',
      body: JSON.stringify({ filename })
    });
    result.className = 'import-result success';
    result.textContent = '[OK] ' + (data.message || 'Import successful!');
    result.style.display = 'block';
    showToast('Excel imported successfully!', 'success');
  } catch (err) {
    result.className = 'import-result error';
    result.textContent = '[Error] ' + err.message;
    result.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import Server File';
  }
}

// â”€â”€â”€ LOCAL FILE UPLOAD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _selectedFile = null;

function handleFileSelect(event) {
  const file = event.target.files[0];
  _applySelectedFile(file);
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  el('dropZone').classList.add('drag-over');
}

function handleDragLeave(event) {
  event.preventDefault();
  el('dropZone').classList.remove('drag-over');
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  el('dropZone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) _applySelectedFile(file);
}

function _applySelectedFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    showToast('Only .xlsx files are supported', 'error');
    return;
  }
  _selectedFile = file;
  const zone = el('dropZone');
  zone.classList.add('has-file');
  el('dropZoneText').innerHTML = `<strong>${escHtml(file.name)}</strong><br><span>${(file.size / 1024).toFixed(1)} KB â€” click to change</span>`;
  el('uploadExcelBtn').disabled = false;
}

async function uploadExcel() {
  if (!_selectedFile) { showToast('Please select a file first', 'error'); return; }

  const btn = el('uploadExcelBtn');
  const result = el('uploadResult');
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  result.style.display = 'none';

  try {
    const formData = new FormData();
    formData.append('file', _selectedFile);

    const resp = await fetch('/api/admin/upload-excel', {
      method: 'POST',
      body: formData   // multipart â€” do NOT set Content-Type manually
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');

    result.className = 'import-result success';
    result.textContent = '[OK] ' + (data.message || 'Import successful!');
    result.style.display = 'block';
    showToast(data.message || 'Imported successfully!', 'success');

    // Reset drop zone
    _selectedFile = null;
    el('excelUploadInput').value = '';
    el('dropZone').classList.remove('has-file');
    el('dropZoneText').innerHTML = 'Drag &amp; drop an <strong>.xlsx</strong> file here<br><span>or click to browse</span>';
    btn.disabled = true;
  } catch (err) {
    result.className = 'import-result error';
    result.textContent = '[Error] ' + err.message;
    result.style.display = 'block';
    showToast(err.message, 'error');
  } finally {
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload &amp; Import';
    if (_selectedFile) btn.disabled = false;
  }
}

// â”€â”€â”€ TIME SLOTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let slotsCache = [];
let editingSlotId = null;

async function loadAdminSlots() {
  try {
    const slots = await api('/api/slots');
    slotsCache = slots;
    renderAdminSlots(slots);
  } catch (err) {
    el('adminSlotsList').innerHTML = `<div class="loading-text">Error: ${err.message}</div>`;
  }
}

function renderAdminSlots(slots) {
  if (!slots || slots.length === 0) {
    el('adminSlotsList').innerHTML = '<div class="loading-text">No slots defined. Click "Add Slot" to create one.</div>';
    return;
  }
  el('adminSlotsList').innerHTML = slots.map(s => {
    const num = s.slot_number;
    const start12 = fmt12(s.start_time);
    const end12   = fmt12(s.end_time);
    return `
      <div class="admin-slot-item">
        <div class="asi-slot-badge">Slot ${num}</div>
        <div class="asi-slot-info">
          <div class="asi-slot-label">${escHtml(s.label)}</div>
          <div class="asi-slot-time">${start12} &rarr; ${end12}</div>
        </div>
        <div class="asi-actions">
          <button class="action-btn edit" title="Edit" onclick='openEditSlotModal(${JSON.stringify(s)})'>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn delete" title="Delete" onclick="deleteSlot(${s.id})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function openAddSlotModal() {
  editingSlotId = null;
  el('slotModalTitle').textContent = 'Add Time Slot';
  el('slotId').value = '';
  const max = slotsCache.reduce((mx, s) => Math.max(mx, s.slot_number || 0), 0);
  el('slotNumber').value = max + 1;
  el('slotNumber').readOnly = false;
  el('slotLabel').value = '';
  el('slotStart').value = '';
  el('slotEnd').value = '';
  el('slotModalOverlay').classList.add('show');
}

function openEditSlotModal(s) {
  editingSlotId = s.id;
  el('slotModalTitle').textContent = 'Edit Time Slot';
  el('slotId').value = s.id;
  el('slotNumber').value = s.slot_number;
  el('slotNumber').readOnly = true;
  el('slotLabel').value = s.label || '';
  el('slotStart').value = s.start_time || '';
  el('slotEnd').value = s.end_time || '';
  el('slotModalOverlay').classList.add('show');
}

function closeSlotModal() { el('slotModalOverlay').classList.remove('show'); }

async function saveSlot() {
  const btn = el('slotSaveBtn');
  btn.disabled = true;
  const data = {
    slot_number: parseInt(el('slotNumber').value),
    label: el('slotLabel').value.trim(),
    start_time: el('slotStart').value,
    end_time: el('slotEnd').value,
  };
  if (!data.label)       { showToast('Label is required', 'error'); btn.disabled = false; return; }
  if (!data.start_time)  { showToast('Start time is required', 'error'); btn.disabled = false; return; }
  if (!data.end_time)    { showToast('End time is required', 'error'); btn.disabled = false; return; }
  try {
    if (editingSlotId) {
      await api(`/api/slots/${editingSlotId}`, { method: 'PUT', body: JSON.stringify(data) });
      showToast('Slot updated', 'success');
    } else {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(data) });
      showToast('Slot created', 'success');
    }
    closeSlotModal();
    loadAdminSlots();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteSlot(id) {
  if (!confirm('Delete this time slot? This will fail if any sessions use it.')) return;
  try {
    await api(`/api/slots/${id}`, { method: 'DELETE' });
    showToast('Slot deleted', 'success');
    loadAdminSlots();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// â”€â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', () => {
  // Set default date filter to this week
  const today = new Date();
  const week = new Date(today);
  week.setDate(today.getDate() - today.getDay() + 1);
  const weekEnd = new Date(week);
  weekEnd.setDate(week.getDate() + 6);

  el('filterStart').value = fmt(week);
  el('filterEnd').value = fmt(weekEnd);

  showAdminView('sessions');
  buildColorPresets();
});

