📋 Action Plan: Course Notes Feature

Scope: Add a "View Notes" button to course cards → class-level notes with public/private visibility, plus making sessions immutable after they start.

🔍 Current State (Diagnosis)
Architecture
Backend: Flask + SQLAlchemy (SQLite/Postgres) with two blueprints: main_bp (routes.py) and admin_bp (admin_routes.py)
Frontend: Single-page PWA (index.html + app.js) — no page routing, everything is modals/views
Data flow: Excel → import_excel() in helpers.py → deletes ALL sessions (ClassSession.query.delete()) then re-imports from scratch
Critical Problem: Sessions Are Wiped on Every Import

In helpers.py line 225:

python
# Delete existing sessions before re-import
ClassSession.query.delete()

This means every sync from Google Sheets or Excel re-import destroys all sessions, which would also destroy any class notes attached to them. This is the core immutability problem to solve.

Existing Models
Model	Relevant Fields
ClassSession	id, date, slot, course_id, subject_raw, notes (admin notes), is_special
Course	id, code, short_name, color, etc.
User	id, username, is_admin

No ClassNote model exists yet.

🏗️ Implementation Plan
Phase 1 — Session Immutability (Foundation Fix)

IMPORTANT

This must be done FIRST. Without it, every Google Sheet sync will wipe all user notes.

Problem: import_excel() calls ClassSession.query.delete() unconditionally, then re-inserts everything. This is destructive.

Solution: Upsert strategy — never delete sessions that have already started.

Changes to helpers.py → import_excel():

Add a started_at column to ClassSession (migration needed) OR use date + slot logic to determine if a session has "started" (date < today OR date == today and slot time has passed).
Replace the blanket ClassSession.query.delete() with a smart upsert:
For each session in the Excel: check if a row with (date, slot) already exists
If it does not exist → INSERT
If it exists and has not started yet → UPDATE subject_raw, course_id, is_special (but never touch notes)
If it exists and has started/ended → SKIP entirely (immutable)
For deletions: only delete sessions that (a) no longer appear in the new Excel AND (b) have not started yet

New field on ClassSession:

python
is_locked = db.Column(db.Boolean, default=False)  # True once class has started

Alternatively, derive "locked" from date < today at query time (simpler, no extra column needed).

Phase 2 — New ClassNote Model

New model in models.py:

python
class ClassNote(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    session_id  = db.Column(db.Integer, db.ForeignKey('class_session.id', ondelete='CASCADE'), nullable=False)
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)
    content     = db.Column(db.Text, nullable=False)          # max 1000 chars enforced in app + DB
    is_public   = db.Column(db.Boolean, default=False)        # True = visible to all users
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    session = db.relationship('ClassSession', backref='class_notes')
    user    = db.relationship('User', backref='class_notes')
    def to_dict(self, current_user_id=None):
        return {
            'id':         self.id,
            'session_id': self.session_id,
            'user_id':    self.user_id,
            'username':   self.user.username,
            'content':    self.content,
            'is_public':  self.is_public,
            'is_mine':    self.user_id == current_user_id,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }

DB migration: Run db.create_all() or a migration script to add the table.

Phase 3 — Backend API Endpoints

Add to routes.py (user-facing, login required):

Method	URL	Description
GET	/api/courses/<id>/ended-sessions	Return all sessions for course where date < today
GET	/api/sessions/<session_id>/notes	Return public notes + current user's private notes for a session
POST	/api/sessions/<session_id>/notes	Create a new note (body: {content, is_public})
PUT	/api/notes/<note_id>	Edit own note
DELETE	/api/notes/<note_id>	Delete own note

Access control rules:

GET notes: Return all is_public=True notes + all notes where user_id == current_user.id
POST/PUT/DELETE: Only the note's author can mutate it
content length validated server-side: len(content) > 1000 → 400 error
Phase 4 — Frontend: "View Notes" Button on Course Cards

In app.js → buildCards() function (around line 677):

Add a third action button alongside "Course Page" and "View Course Classes":

html
<button type="button" class="btn-course-notes" onclick="openCourseNotesModal(${c.id})" style="--btn-color:${c.color}">
  <svg><!-- notebook icon --></svg>
  <span>View Notes</span>
</button>
Phase 5 — Frontend: Course Notes Modal (Ended Classes List)

New modal: courseNotesOverlay

Flow: View Notes → modal shows list of ended classes only for that course → click "View Class Notes" on a class → opens class notes sub-modal.

Structure:

[Course Notes Modal]
  Header: Course name + color bar
  Body: List of ended sessions (date, slot, session title, "View Class Notes" button)
  Empty state if no ended sessions yet

JS functions to add:

javascript
async function openCourseNotesModal(courseId)   // fetch ended sessions, render list
function closeCourseNotesModal()
function renderEndedSessionsList(sessions)       // builds the list cards
Phase 6 — Frontend: Class Notes Sub-Modal

New modal: classNotesOverlay (or a "sub-view" pushed onto the same overlay)

Structure:

[Class Notes Modal]
  ← Back button (to course notes list)
  Header: Session date + time + subject
  ─────────────────────────────────
  [Create New Note] button  (always at top)
    ↳ Textarea (1000 char limit with live counter)
    ↳ ☐ Make it public  (checkbox)
    ↳ [Save Note] button
  ─────────────────────────────────
  Notes List:
    Public notes (from all users, labelled with username)
    Private notes (only current user's, labelled "My note")
    Each note: content, author, date, [Edit] [Delete] (only on own notes)

JS functions to add:

javascript
async function openClassNotesModal(sessionId, sessionInfo)
function closeClassNotesModal()
async function saveClassNote(sessionId)          // POST /api/sessions/:id/notes
async function deleteClassNote(noteId)
async function editClassNote(noteId)
function renderClassNotesList(notes)
Phase 7 — Styling (style.css)

New CSS classes needed:

.btn-course-notes — third button style on course card (similar to btn-course-classes)
.course-notes-overlay / .course-notes-modal — base modal styles (can reuse courseClassesOverlay patterns)
.cn-session-row — ended session row in notes list
.cn-note-card — individual note card
.cn-note-mine — visual distinction for own notes
.cn-note-public — badge for public notes
.cn-char-counter — live 1000-char counter below textarea
.cn-create-form — the note creation form area
📁 Files to Modify
File	Changes
models.py	Add ClassNote model
helpers.py	Rewrite import_excel() upsert logic (immutability)
routes.py	Add 5 new API endpoints for notes
static/js/app.js	Add "View Notes" button, 2 new modals, 8+ new JS functions
templates/index.html	Add 2 new modal HTML structures
static/css/style.css	Add styles for new UI components
🔄 Detailed Immutability Logic (Phase 1 Deep-Dive)
python
def import_excel(source):
    # ... parse courses as before ...
    from datetime import date as _date
    today = _date.today()
    for row in ws.iter_rows(...):
        # ... parse date_val, slot_num, text, course_obj ...
        # Check if session already exists
        existing = ClassSession.query.filter_by(date=date_val, slot=slot_num).first()
        # Determine if this session has already started/ended
        # A session is "locked" if its date is before today, 
        # OR if it's today and the slot's end_time has passed
        is_started = date_val < today  # Simple: past date = locked
        if existing:
            if is_started:
                # IMMUTABLE: session already happened, skip entirely
                continue
            else:
                # Update only schedule metadata (not notes)
                existing.subject_raw = text
                existing.course_id = course_obj.id if course_obj else None
                existing.is_special = is_special
                # DO NOT touch existing.notes
        else:
            # New session: insert
            session_obj = ClassSession(
                date=date_val, day_name=day_name, slot=slot_num,
                subject_raw=text, course_id=course_obj.id if course_obj else None,
                is_special=is_special,
            )
            db.session.add(session_obj)
    # Remove future sessions that no longer appear in the new Excel
    # (Only safe to delete sessions that haven't started yet)
    # Build set of (date, slot) from new Excel, then delete non-matching future sessions
⚠️ Edge Cases & Decisions Needed

WARNING

These need your input before implementation begins:

Can a user edit their own note after posting? (Suggested: Yes, with an Edit button)
Can a user delete their own note? (Suggested: Yes)
Can an admin see all private notes? (Suggested: No — keep them truly private)
Can an admin delete any note? (Suggested: Yes, for moderation)
Is "today's" session class shown in the notes list? (Suggested: No — only strictly past dates date < today)
Should notes be tied to ClassSession.id (which could change on reimport)? → This is why the upsert strategy is critical: session IDs must be stable once created.
Multiple notes per user per session? (Suggested: Yes, users can add multiple notes to the same class)
🗂️ Implementation Order

TIP

Phase 1 is the riskiest change — it touches the import pipeline. It should be done first and tested in isolation before proceeding to the notes feature.

✅ Acceptance Criteria
 Excel/Google Sheet re-import does not delete sessions with date < today
 Excel/Google Sheet re-import does not overwrite session data where date < today
 Course cards show 3 action buttons: "Course Page" (if link set), "View Course Classes", "View Notes"
 "View Notes" shows only ended classes (past sessions) for that course
 Each ended class has a "View Class Notes" button
 Class notes page shows all public notes from all users + current user's private notes
 "Create New Note" text area has 1000-char limit with live counter
 "Make it public" checkbox works: unchecked = private (only visible to author), checked = visible to all
 User can edit and delete their own notes
 Notes survive a timetable re-sync/import