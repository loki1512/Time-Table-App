"""
routes.py
~~~~~~~~~
Main Blueprint: auth pages, public/student-facing pages,
and read-only / personal API endpoints.
"""

import json
from datetime import date, timedelta

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, flash, send_from_directory,
)
from flask_login import login_user, logout_user, login_required, current_user

from extensions import db
from models import User, Course, ClassSession, Notification, TimeSlot
from helpers import get_slots_dict, DEFAULT_SLOTS

main_bp = Blueprint('main', __name__)


# ─── Auth ─────────────────────────────────────────────────────────────────────

@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        username = data.get('username', '').strip()
        password = data.get('password', '')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=True)
            if request.is_json:
                return jsonify({'success': True, 'is_admin': user.is_admin})
            return redirect(url_for('main.index'))
        if request.is_json:
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
        flash('Invalid username or password', 'error')
    return render_template('login.html')


@main_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('main.login'))


@main_bp.route('/register', methods=['GET', 'POST'])
def register():
    # Public self-registration is currently disabled (admin-only user provisioning)
    ALLOW_PUBLIC_REGISTRATION = False

    if not ALLOW_PUBLIC_REGISTRATION:
        if request.is_json:
            return jsonify({'success': False, 'error': 'Public registration is disabled. Please contact an administrator.'}), 403
        flash('Public registration is disabled. Please contact an administrator.', 'error')
        return redirect(url_for('main.login'))

    if current_user.is_authenticated:
        return redirect(url_for('main.index'))
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        username = data.get('username', '').strip()
        email = data.get('email', '').strip()
        password = data.get('password', '')

        if User.query.filter_by(username=username).first():
            msg = 'Username already taken'
            if request.is_json:
                return jsonify({'success': False, 'error': msg}), 400
            flash(msg, 'error')
            return render_template('login.html', mode='register')

        if User.query.filter_by(email=email).first():
            msg = 'Email already registered'
            if request.is_json:
                return jsonify({'success': False, 'error': msg}), 400
            flash(msg, 'error')
            return render_template('login.html', mode='register')

        user = User(username=username, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        login_user(user, remember=True)
        if request.is_json:
            return jsonify({'success': True})
        return redirect(url_for('main.index'))
    return render_template('login.html', mode='register')


# ─── Pages ────────────────────────────────────────────────────────────────────

@main_bp.route('/')
@login_required
def index():
    return render_template('index.html', user=current_user, slots=get_slots_dict())


@main_bp.route('/admin')
@login_required
def admin():
    if not current_user.is_admin:
        flash('Admin access required', 'error')
        return redirect(url_for('main.index'))
    courses = Course.query.all()
    return render_template('admin.html', user=current_user, slots=get_slots_dict(), courses=courses)


@main_bp.route('/health')
def health():
    return jsonify({'status': 'ok', 'database': 'connected'})


@main_bp.route('/api/last-sync')
@login_required
def api_last_sync():
    """Return the UTC timestamp of the most recent timetable import."""
    from helpers import get_last_sync_time
    ts = get_last_sync_time()
    return jsonify({'last_sync': ts.isoformat() + 'Z' if ts else None})


@main_bp.route('/api/cron/sync', methods=['GET', 'POST'])
def cron_sync():
    """Triggered by scheduled morning cron or Google Apps Script timer."""
    from config import Config
    from helpers import sync_from_google_sheet

    key = request.args.get('key') or request.headers.get('X-Cron-Key')
    if key != Config.CRON_SECRET:
        return jsonify({'error': 'Unauthorized cron key'}), 403

    success, msg = sync_from_google_sheet()
    if success:
        return jsonify({'status': 'ok', 'message': msg})
    return jsonify({'status': 'error', 'message': msg}), 500


# ─── PWA ──────────────────────────────────────────────────────────────────────

@main_bp.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')


@main_bp.route('/sw.js')
def service_worker():
    response = send_from_directory('static', 'sw.js')
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


# ─── Read-only / Personal API ─────────────────────────────────────────────────

@main_bp.route('/api/me')
@login_required
def api_me():
    return jsonify(current_user.to_dict())


@main_bp.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    return jsonify(current_user.to_dict())


@main_bp.route('/api/profile', methods=['PUT'])
@login_required
def update_profile():
    """User updates their own username/email."""
    data = request.get_json() or {}
    if 'username' in data:
        new_name = data['username'].strip()
        if not new_name:
            return jsonify({'error': 'Username cannot be empty'}), 400
        # Super-admin's username is permanently locked to 'admin'
        if current_user.is_super_admin:
            return jsonify({'error': "The super-admin username cannot be changed"}), 403
        clash = User.query.filter_by(username=new_name).first()
        if clash and clash.id != current_user.id:
            return jsonify({'error': 'Username already taken'}), 409
        current_user.username = new_name

    if 'email' in data:
        new_email = data['email'].strip()
        if not new_email:
            return jsonify({'error': 'Email cannot be empty'}), 400
        clash = User.query.filter_by(email=new_email).first()
        if clash and clash.id != current_user.id:
            return jsonify({'error': 'Email already registered'}), 409
        current_user.email = new_email

    db.session.commit()
    return jsonify(current_user.to_dict())


@main_bp.route('/api/profile/password', methods=['PUT'])
@login_required
def change_own_password():
    """User changes their own password — current password verification required."""
    data = request.get_json() or {}
    current_pw = data.get('current_password', '')
    new_pw = data.get('new_password', '')
    if not current_user.check_password(current_pw):
        return jsonify({'error': 'Current password is incorrect'}), 403
    if not new_pw or len(new_pw) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    current_user.set_password(new_pw)
    db.session.commit()
    return jsonify({'success': True})


@main_bp.route('/api/today')
@login_required
def api_today():
    today = date.today()
    sessions = ClassSession.query.filter_by(date=today).order_by(ClassSession.slot).all()
    return jsonify({
        'date': today.isoformat(),
        'day': today.strftime('%A'),
        'sessions': [s.to_dict() for s in sessions],
        'slots': get_slots_dict(),
    })


@main_bp.route('/api/sessions')
@login_required
def api_sessions():
    start_str = request.args.get('start')
    end_str = request.args.get('end')
    try:
        start = date.fromisoformat(start_str) if start_str else date.today()
        end = date.fromisoformat(end_str) if end_str else start
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    sessions = ClassSession.query.filter(
        ClassSession.date >= start,
        ClassSession.date <= end,
    ).order_by(ClassSession.date, ClassSession.slot).all()
    return jsonify([s.to_dict() for s in sessions])


@main_bp.route('/api/sessions/week')
@login_required
def api_sessions_week():
    today = date.today()
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    start_str = request.args.get('start', start.isoformat())
    end_str = request.args.get('end', end.isoformat())
    try:
        start = date.fromisoformat(start_str)
        end = date.fromisoformat(end_str)
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    sessions = ClassSession.query.filter(
        ClassSession.date >= start,
        ClassSession.date <= end,
    ).order_by(ClassSession.date, ClassSession.slot).all()
    return jsonify({
        'start': start.isoformat(),
        'end': end.isoformat(),
        'sessions': [s.to_dict() for s in sessions],
    })


@main_bp.route('/api/courses')
@login_required
def api_courses():
    courses = Course.query.all()
    return jsonify([c.to_dict() for c in courses])


@main_bp.route('/api/slots')
@login_required
def api_slots():
    slots = TimeSlot.query.order_by(TimeSlot.slot_number).all()
    if not slots:
        return jsonify(DEFAULT_SLOTS)
    return jsonify([s.to_dict() for s in slots])



# ─── Class Notes API ──────────────────────────────────────────────────────────

@main_bp.route('/api/courses/<int:course_id>/ended-sessions')
@login_required
def api_course_ended_sessions(course_id):
    """Return sessions that have ended by date (strictly before today)."""
    from datetime import date
    today = date.today()
    sessions = ClassSession.query.filter(
        ClassSession.course_id == course_id,
        ClassSession.date < today,
        ClassSession.is_special == False,
    ).order_by(ClassSession.date.desc(), ClassSession.slot).all()
    return jsonify([s.to_dict() for s in sessions])


@main_bp.route('/api/sessions/<int:session_id>/notes')
@login_required
def api_get_session_notes(session_id):
    """Return public notes + current user's own note for a session."""
    from models import ClassNote
    notes = ClassNote.query.filter(
        ClassNote.session_id == session_id,
        db.or_(
            ClassNote.is_public == True,
            ClassNote.user_id == current_user.id,
        )
    ).order_by(ClassNote.created_at).all()
    return jsonify([n.to_dict(current_user_id=current_user.id) for n in notes])


@main_bp.route('/api/sessions/<int:session_id>/notes', methods=['POST'])
@login_required
def api_create_session_note(session_id):
    """Create a note after a session has started or concluded."""
    from models import ClassNote
    from datetime import date, datetime

    session_obj = db.session.get(ClassSession, session_id)
    if not session_obj:
        return jsonify({'error': 'Session not found'}), 404

    # Past dates are concluded; on today's date, allow notes once the slot starts.
    today = date.today()
    if session_obj.date > today:
        return jsonify({'error': 'Notes are available after the class starts'}), 403
    if session_obj.date == today:
        from helpers import get_slots_dict
        slot = get_slots_dict().get(session_obj.slot)
        now = datetime.now().strftime('%H:%M')
        if not slot or now < slot['start']:
            return jsonify({'error': 'Notes are available after the class starts'}), 403

    data = request.get_json() or {}
    raw_content = data.get('content')
    if not isinstance(raw_content, str):
        return jsonify({'error': 'Note content must be text'}), 400
    content = raw_content.strip()
    if not content:
        return jsonify({'error': 'Note content cannot be empty'}), 400
    if len(content) > 1000:
        return jsonify({'error': 'Note exceeds 1000 character limit'}), 400

    note = ClassNote(
        session_id=session_id,
        user_id=current_user.id,
        content=content,
        is_public=bool(data.get('is_public', False)),
    )
    db.session.add(note)
    db.session.commit()
    return jsonify(note.to_dict(current_user_id=current_user.id)), 201


@main_bp.route('/api/export_timetable')
def api_export_timetable():
    """Export timetable as JSON for external use."""
    from helpers import export_timetable_json
    data = export_timetable_json()
    return jsonify(data)


@main_bp.route('/api/notes/<int:note_id>', methods=['PUT'])
@login_required
def api_update_note(note_id):
    """Edit own note."""
    from models import ClassNote
    note = db.session.get(ClassNote, note_id)
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    if note.user_id != current_user.id:
        return jsonify({'error': 'You can only edit your own notes'}), 403

    data = request.get_json() or {}
    if 'content' in data:
        if not isinstance(data['content'], str):
            return jsonify({'error': 'Note content must be text'}), 400
        content = data['content'].strip()
        if not content:
            return jsonify({'error': 'Note content cannot be empty'}), 400
        if len(content) > 1000:
            return jsonify({'error': 'Note exceeds 1000 character limit'}), 400
        note.content = content
    if 'is_public' in data:
        note.is_public = bool(data['is_public'])

    from datetime import datetime
    note.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(note.to_dict(current_user_id=current_user.id))


@main_bp.route('/api/notes/<int:note_id>', methods=['DELETE'])
@login_required
def api_delete_note(note_id):
    """Delete own note (or admin can delete any note)."""
    from models import ClassNote
    note = db.session.get(ClassNote, note_id)
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    if note.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'You can only delete your own notes'}), 403
    db.session.delete(note)
    db.session.commit()
    return jsonify({'success': True})


# ─── Notification API (personal, any logged-in user) ─────────────────────────

@main_bp.route('/api/notifications/vapid-public-key')
def vapid_public_key():
    """Return the VAPID public key for web push registration."""
    from config import Config
    return jsonify({'publicKey': Config.VAPID_PUBLIC_KEY})


@main_bp.route('/api/notifications/subscribe', methods=['POST'])
@login_required
def subscribe_notifications():
    data = request.get_json()
    notif = Notification.query.filter_by(user_id=current_user.id).first()
    if not notif:
        notif = Notification(user_id=current_user.id)
        db.session.add(notif)
    notif.push_subscription = json.dumps(data.get('subscription'))
    notif.notify_before_class = data.get('notify_before_class', True)
    notif.notify_minutes_before = int(data.get('notify_minutes_before', 15))
    notif.notify_morning = data.get('notify_morning', True)
    notif.morning_time = data.get('morning_time', '07:00')
    db.session.commit()
    return jsonify({'success': True})


@main_bp.route('/api/notifications/settings', methods=['GET'])
@login_required
def get_notification_settings():
    notif = Notification.query.filter_by(user_id=current_user.id).first()
    if not notif:
        return jsonify({
            'notify_before_class': True,
            'notify_minutes_before': 15,
            'notify_morning': True,
            'morning_time': '07:00',
            'subscribed': False,
        })
    return jsonify({
        'notify_before_class': notif.notify_before_class,
        'notify_minutes_before': notif.notify_minutes_before,
        'notify_morning': notif.notify_morning,
        'morning_time': notif.morning_time,
        'subscribed': bool(notif.push_subscription),
    })
