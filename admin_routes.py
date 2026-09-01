"""
admin_routes.py
~~~~~~~~~~~~~~~
Admin Blueprint: all write/mutation API endpoints.
Every route here enforces current_user.is_admin.
"""

import io
import os
from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from extensions import db
from models import Course, ClassSession, TimeSlot, User, Notification
from helpers import import_excel

admin_bp = Blueprint('admin', __name__)


def _require_admin():
    """Return a 403 response if current user is not an admin, else None."""
    if not current_user.is_admin:
        return jsonify({'error': 'Admin only'}), 403
    return None


# ─── Session CRUD ─────────────────────────────────────────────────────────────

@admin_bp.route('/api/sessions', methods=['POST'])
@login_required
def create_session():
    err = _require_admin()
    if err:
        return err
    data = request.get_json()
    try:
        from datetime import date
        date_val = date.fromisoformat(data['date'])
    except (KeyError, ValueError):
        return jsonify({'error': 'Invalid date'}), 400

    slot = int(data.get('slot', 1))
    if not TimeSlot.query.filter_by(slot_number=slot).first():
        return jsonify({'error': 'Invalid slot'}), 400

    existing = ClassSession.query.filter_by(date=date_val, slot=slot).first()
    if existing:
        return jsonify({'error': 'Session already exists for this date and slot'}), 409

    session_obj = ClassSession(
        date=date_val,
        day_name=date_val.strftime('%A'),
        slot=slot,
        subject_raw=data.get('subject_raw', ''),
        course_id=data.get('course_id') or None,
        is_special=data.get('is_special', False),
        notes=data.get('notes', ''),
    )
    db.session.add(session_obj)
    db.session.commit()
    return jsonify(session_obj.to_dict()), 201


@admin_bp.route('/api/sessions/<int:session_id>', methods=['PUT'])
@login_required
def update_session(session_id):
    err = _require_admin()
    if err:
        return err
    session_obj = db.session.get(ClassSession, session_id)
    if not session_obj:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    if 'subject_raw' in data:
        session_obj.subject_raw = data['subject_raw']
    if 'course_id' in data:
        session_obj.course_id = data['course_id'] or None
    if 'is_special' in data:
        session_obj.is_special = data['is_special']
    if 'notes' in data:
        session_obj.notes = data['notes']
    session_obj.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(session_obj.to_dict())


@admin_bp.route('/api/sessions/<int:session_id>', methods=['DELETE'])
@login_required
def delete_session(session_id):
    err = _require_admin()
    if err:
        return err
    session_obj = db.session.get(ClassSession, session_id)
    if not session_obj:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(session_obj)
    db.session.commit()
    return jsonify({'success': True})


# ─── Course CRUD ──────────────────────────────────────────────────────────────

@admin_bp.route('/api/courses', methods=['POST'])
@login_required
def create_course():
    err = _require_admin()
    if err:
        return err
    data = request.get_json()
    course = Course(
        code=data.get('code', ''),
        name=data.get('name', ''),
        credits=data.get('credits', 3.0),
        area=data.get('area', ''),
        faculty=data.get('faculty', ''),
        short_name=data.get('short_name', ''),
        color=data.get('color', '#6366f1'),
        course_link=data.get('course_link', '') or None,
    )
    db.session.add(course)
    db.session.commit()
    return jsonify(course.to_dict()), 201


@admin_bp.route('/api/courses/<int:course_id>', methods=['PUT'])
@login_required
def update_course(course_id):
    err = _require_admin()
    if err:
        return err
    course = db.session.get(Course, course_id)
    if not course:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ['code', 'name', 'credits', 'area', 'faculty', 'short_name', 'color']:
        if field in data:
            setattr(course, field, data[field])
    if 'course_link' in data:
        course.course_link = data['course_link'] or None
    db.session.commit()
    return jsonify(course.to_dict())


@admin_bp.route('/api/courses/<int:course_id>', methods=['DELETE'])
@login_required
def delete_course(course_id):
    err = _require_admin()
    if err:
        return err
    course = db.session.get(Course, course_id)
    if not course:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(course)
    db.session.commit()
    return jsonify({'success': True})


# ─── Time Slot CRUD ───────────────────────────────────────────────────────────

@admin_bp.route('/api/slots', methods=['POST'])
@login_required
def create_slot():
    err = _require_admin()
    if err:
        return err
    data = request.get_json()
    slot_number = data.get('slot_number')
    if not slot_number or not isinstance(slot_number, int):
        return jsonify({'error': 'slot_number is required and must be an integer'}), 400
    if TimeSlot.query.filter_by(slot_number=slot_number).first():
        return jsonify({'error': f'Slot number {slot_number} already exists'}), 409
    slot = TimeSlot(
        slot_number=slot_number,
        label=data.get('label', f'Slot {slot_number}'),
        start_time=data.get('start_time', '00:00'),
        end_time=data.get('end_time', '00:00'),
    )
    db.session.add(slot)
    db.session.commit()
    return jsonify(slot.to_dict()), 201


@admin_bp.route('/api/slots/<int:slot_id>', methods=['PUT'])
@login_required
def update_slot(slot_id):
    err = _require_admin()
    if err:
        return err
    slot = db.session.get(TimeSlot, slot_id)
    if not slot:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json()
    for field in ['label', 'start_time', 'end_time']:
        if field in data:
            setattr(slot, field, data[field])
    if 'slot_number' in data:
        new_num = int(data['slot_number'])
        existing = TimeSlot.query.filter_by(slot_number=new_num).first()
        if existing and existing.id != slot_id:
            return jsonify({'error': f'Slot number {new_num} already taken'}), 409
        slot.slot_number = new_num
    db.session.commit()
    return jsonify(slot.to_dict())


@admin_bp.route('/api/slots/<int:slot_id>', methods=['DELETE'])
@login_required
def delete_slot(slot_id):
    err = _require_admin()
    if err:
        return err
    slot = db.session.get(TimeSlot, slot_id)
    if not slot:
        return jsonify({'error': 'Not found'}), 404
    sessions_using = ClassSession.query.filter_by(slot=slot.slot_number).count()
    if sessions_using > 0:
        return jsonify({'error': f'Cannot delete: {sessions_using} session(s) use this slot. Remove them first.'}), 409
    db.session.delete(slot)
    db.session.commit()
    return jsonify({'success': True})


# ─── Admin Utility API ────────────────────────────────────────────────────────

@admin_bp.route('/api/admin/excel-files', methods=['GET'])
@login_required
def admin_excel_files():
    err = _require_admin()
    if err:
        return err
    base_dir = os.path.dirname(os.path.abspath(__file__))
    files = [f for f in os.listdir(base_dir) if f.endswith('.xlsx')]
    return jsonify(files)


@admin_bp.route('/api/admin/import-excel', methods=['POST'])
@login_required
def admin_import_excel():
    err = _require_admin()
    if err:
        return err
    req_data = request.get_json(silent=True) or {}
    filename = req_data.get('filename')
    if not filename:
        filename = 'MBA BA 2026-28 Term I Schedule .xlsx'
    filename = os.path.basename(filename)  # Prevent directory traversal
    excel_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    if not os.path.exists(excel_path):
        return jsonify({'error': 'Excel file not found'}), 404
    try:
        import_excel(excel_path)
        return jsonify({'success': True, 'message': 'Excel imported successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/api/admin/upload-excel', methods=['POST'])
@login_required
def admin_upload_excel():
    """Accept a multipart .xlsx upload, parse it in memory — never saved to disk."""
    err = _require_admin()
    if err:
        return err

    if 'file' not in request.files:
        return jsonify({'error': 'No file part in request'}), 400

    uploaded = request.files['file']
    if uploaded.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not uploaded.filename.lower().endswith('.xlsx'):
        return jsonify({'error': 'Only .xlsx files are supported'}), 400

    try:
        # Read the upload into memory — no temp file written to disk
        stream = io.BytesIO(uploaded.read())
        import_excel(stream)
        return jsonify({'success': True, 'message': f'"{uploaded.filename}" imported successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/api/admin/sync-google-sheet', methods=['POST'])
@login_required
def admin_sync_google_sheet():
    """Fetch timetable from Google Apps Script Web App proxy or direct export link."""
    from helpers import sync_from_google_sheet

    err = _require_admin()
    if err:
        return err

    req_data = request.get_json(silent=True) or {}
    sync_url = req_data.get('url', '').strip()

    success, msg = sync_from_google_sheet(sync_url)
    if success:
        return jsonify({'success': True, 'message': msg})
    else:
        return jsonify({'error': msg}), 400


@admin_bp.route('/api/admin/sync-status', methods=['GET'])
@login_required
def admin_sync_status():
    """Return whether server has a default GOOGLE_SHEET_SYNC_URL configured and its value."""
    import os
    from config import Config
    err = _require_admin()
    if err:
        return err
    env_url = os.environ.get('GOOGLE_SHEET_SYNC_URL', '').strip() or Config.GOOGLE_SHEET_SYNC_URL
    return jsonify({
        'configured': bool(env_url),
        'url': env_url
    })


@admin_bp.route('/api/admin/notification-subscribers-count', methods=['GET'])
@login_required
def admin_notification_subscribers_count():
    """Return the total number of users with active push notification subscriptions."""
    err = _require_admin()
    if err:
        return err
    count = Notification.query.filter(
        Notification.push_subscription.isnot(None),
        Notification.push_subscription != 'null',
        Notification.push_subscription != ''
    ).count()
    return jsonify({'count': count})


@admin_bp.route('/api/admin/broadcast-notification', methods=['POST'])
@login_required
def admin_broadcast_notification():
    """Send a custom push notification to all subscribed users."""
    from helpers import broadcast_push_notification
    err = _require_admin()
    if err:
        return err

    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    body = (data.get('body') or '').strip()
    url = (data.get('url') or '/').strip()

    if not title or not body:
        return jsonify({'error': 'Title and Message are required.'}), 400

    result = broadcast_push_notification(title, body, url)
    if result.get('error'):
        return jsonify(result), 500
    return jsonify(result)


@admin_bp.route('/api/admin/users')
@login_required
def admin_users():
    err = _require_admin()
    if err:
        return err
    users = User.query.order_by(User.created_at).all()
    return jsonify([u.to_dict() for u in users])


@admin_bp.route('/api/admin/users', methods=['POST'])
@login_required
def create_user():
    """Create a new user. Only super-admin can create admins."""
    err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip()
    password = data.get('password', '')
    make_admin = bool(data.get('is_admin', False))

    if not username or not email or not password:
        return jsonify({'error': 'Username, email and password are required'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    # Only super-admin can create admin accounts
    if make_admin and not current_user.is_super_admin:
        return jsonify({'error': 'Only the super-admin can create admin accounts'}), 403

    user = User(username=username, email=email, is_admin=make_admin)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify(user.to_dict()), 201


@admin_bp.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@login_required
def update_user(user_id):
    """Edit username, email, is_admin. Role changes are super-admin only."""
    err = _require_admin()
    if err:
        return err
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    data = request.get_json() or {}

    # Role changes: only super-admin is allowed
    if 'is_admin' in data:
        if not current_user.is_super_admin:
            return jsonify({'error': 'Only the super-admin can change admin roles'}), 403
        # Prevent super-admin from demoting themselves
        if user.is_super_admin and not data['is_admin']:
            return jsonify({'error': 'The super-admin account cannot be demoted'}), 403
        user.is_admin = bool(data['is_admin'])

    if 'username' in data:
        new_name = data['username'].strip()
        if not new_name:
            return jsonify({'error': 'Username cannot be empty'}), 400
        clash = User.query.filter_by(username=new_name).first()
        if clash and clash.id != user_id:
            return jsonify({'error': 'Username already taken'}), 409
        # Protect the super-admin username from being changed
        if user.is_super_admin and new_name != 'admin':
            return jsonify({'error': "The 'admin' username cannot be changed"}), 403
        user.username = new_name

    if 'email' in data:
        new_email = data['email'].strip()
        if not new_email:
            return jsonify({'error': 'Email cannot be empty'}), 400
        clash = User.query.filter_by(email=new_email).first()
        if clash and clash.id != user_id:
            return jsonify({'error': 'Email already registered'}), 409
        user.email = new_email

    db.session.commit()
    return jsonify(user.to_dict())


@admin_bp.route('/api/admin/users/<int:user_id>/password', methods=['PUT'])
@login_required
def admin_change_password(user_id):
    """Admin changes any user's password. No current-password check needed."""
    err = _require_admin()
    if err:
        return err
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    data = request.get_json() or {}
    new_pw = data.get('password', '')
    if not new_pw or len(new_pw) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    user.set_password(new_pw)
    db.session.commit()
    return jsonify({'success': True})


@admin_bp.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    """Delete a user. Cannot delete yourself or the super-admin."""
    err = _require_admin()
    if err:
        return err
    if user_id == current_user.id:
        return jsonify({'error': 'You cannot delete your own account'}), 403
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.is_super_admin:
        return jsonify({'error': 'The super-admin account cannot be deleted'}), 403
    # Clean up their notifications first
    from models import Notification
    Notification.query.filter_by(user_id=user_id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True})
