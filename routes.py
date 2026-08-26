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
    return jsonify({
        'id': current_user.id,
        'username': current_user.username,
        'email': current_user.email,
        'is_admin': current_user.is_admin,
    })


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


# ─── Notification API (personal, any logged-in user) ─────────────────────────

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
