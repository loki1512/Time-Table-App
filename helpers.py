"""
helpers.py
~~~~~~~~~~
Pure utility functions and constants shared across the application.
No Flask routing lives here — this keeps helpers easy to test and
portable when migrating to Supabase (just swap the DB calls).
"""

import openpyxl
from datetime import datetime

from extensions import db
from models import Course, ClassSession, TimeSlot, User

# ─── Constants ────────────────────────────────────────────────────────────────

DEFAULT_SLOTS = [
    {'slot_number': 1, 'label': '09:30 AM – 11:00 AM', 'start_time': '09:30', 'end_time': '11:00'},
    {'slot_number': 2, 'label': '11:30 AM – 01:00 PM', 'start_time': '11:30', 'end_time': '13:00'},
    {'slot_number': 3, 'label': '02:00 PM – 03:30 PM', 'start_time': '14:00', 'end_time': '15:30'},
    {'slot_number': 4, 'label': '04:00 PM – 05:30 PM', 'start_time': '16:00', 'end_time': '17:30'},
]

COURSE_COLORS = [
    '#2952CC',  # IIM Royal Blue
    '#C9A227',  # IIM Gold
    '#1565C0',  # Deep Blue
    '#0891B2',  # Teal
    '#10b981',  # Emerald
    '#4F78E8',  # Light IIM Blue
    '#D97706',  # Amber-Gold
    '#0E7490',  # Dark Teal
]

COURSE_ABBR_MAP = {
    'FRA': 'FRA', 'MM': 'MM', 'DS': 'DS-I', 'DS-I': 'DS-I',
    'MC': 'MC', 'MComp': 'MComp', 'OBD': 'OBD', 'BE': 'BE',
    'IBA': 'IBA',
}


# ─── Slot helpers ─────────────────────────────────────────────────────────────

def get_slots_dict():
    """Return slot dict from DB, falling back to DEFAULT_SLOTS if table is empty."""
    slots = TimeSlot.query.order_by(TimeSlot.slot_number).all()
    if slots:
        return {s.slot_number: {'label': s.label, 'start': s.start_time, 'end': s.end_time} for s in slots}
    return {d['slot_number']: {'label': d['label'], 'start': d['start_time'], 'end': d['end_time']} for d in DEFAULT_SLOTS}


def seed_default_slots():
    """Seed default time slots on first run."""
    if TimeSlot.query.count() == 0:
        for d in DEFAULT_SLOTS:
            db.session.add(TimeSlot(**d))
        db.session.commit()
        print('[OK] Default time slots seeded.')


# ─── Course / Excel helpers ───────────────────────────────────────────────────

def parse_subject_abbr(text):
    """Extract short course code from cell text."""
    if not text:
        return None
    text = text.strip()
    for abbr in ['DS-I', 'MComp', 'FRA', 'MM', 'MC', 'OBD', 'BE', 'IBA']:
        if text.upper().startswith(abbr.upper()) or f'{abbr}-' in text or f'{abbr} ' in text.upper():
            return abbr
    return text.split()[0] if text else None


def import_excel(source):
    """Parse Excel timetable and populate the DB.

    Args:
        source: A file path string OR a file-like object (e.g. io.BytesIO from
                an uploaded file).  openpyxl accepts both transparently.
    """
    wb = openpyxl.load_workbook(source)
    ws = wb.active

    course_color_idx = 0
    courses_by_short = {}

    # Read course table at bottom (rows where col[0] is a numeric course number)
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True):
        if row[0] is None:
            continue
        try:
            float(row[0])
        except (TypeError, ValueError):
            continue
        # Skip rows that are actually date values (datetime parses to float too)
        if isinstance(row[0], datetime):
            continue

        no = float(row[0])
        name = str(row[1]).strip() if row[1] else None
        credits = float(row[2]) if row[2] else 3.0
        area = str(row[3]).strip() if row[3] else None
        code = str(row[4]).strip() if row[4] else f'MBA-BA{int(no):03d}'
        faculty = str(row[5]).strip() if row[5] else None

        if not name:
            continue

        short_map = {
            'Business Economics': 'BE',
            'Decision Sciences': 'DS-I',
            'Financial Reporting': 'FRA',
            'Introduction to Business Analytics': 'IBA',
            'Managerial Communication': 'MC',
            'Managerial Computing': 'MComp',
            'Marketing Management': 'MM',
            'Organizational Behaviour': 'OBD',
        }
        short = next((v for k, v in short_map.items() if k.lower() in name.lower()), name[:4])

        existing = Course.query.filter_by(code=code).first()
        if not existing:
            course = Course(
                code=code,
                name=name,
                credits=credits,
                area=area,
                faculty=faculty,
                short_name=short,
                color=COURSE_COLORS[course_color_idx % len(COURSE_COLORS)],
            )
            db.session.add(course)
            db.session.flush()
            course_color_idx += 1
            courses_by_short[short] = course
        else:
            courses_by_short[existing.short_name] = existing

    db.session.commit()

    # Refresh courses_by_short from DB
    for c in Course.query.all():
        courses_by_short[c.short_name] = c

    # Column index → slot number (0-indexed cols)
    col_to_slot = {2: 1, 3: 2, 5: 3, 6: 4}

    # Delete existing sessions before re-import
    ClassSession.query.delete()

    for row in ws.iter_rows(min_row=4, max_row=ws.max_row, values_only=True):
        if row[0] is None:
            continue
        if not isinstance(row[0], datetime):
            continue

        date_val = row[0].date()
        day_name = str(row[1]).strip() if row[1] else ''

        for col_idx, slot_num in col_to_slot.items():
            cell_val = row[col_idx] if col_idx < len(row) else None
            if not cell_val:
                continue
            text = str(cell_val).strip()
            if not text:
                continue

            is_special = any(kw in text.upper() for kw in ['TERM', 'HOLIDAY', 'INDEPENDENCE', 'MILAD', 'BREAK', 'MID'])
            abbr = parse_subject_abbr(text)
            course_obj = courses_by_short.get(abbr) if abbr else None

            session_obj = ClassSession(
                date=date_val,
                day_name=day_name,
                slot=slot_num,
                subject_raw=text,
                course_id=course_obj.id if course_obj else None,
                is_special=is_special,
            )
            db.session.add(session_obj)

    db.session.commit()


# ─── Google Sheets Sync & Scheduler ───────────────────────────────────────────

def sync_from_google_sheet(sync_url=None):
    """Fetch timetable from Google Apps Script Web App proxy or direct export link."""
    import base64
    import io
    import os
    from urllib.request import urlopen, Request
    from config import Config

    raw_url = (sync_url or '').strip() or os.environ.get('GOOGLE_SHEET_SYNC_URL', '').strip() or Config.GOOGLE_SHEET_SYNC_URL
    if not raw_url:
        return False, "Google Sheet Sync URL is not configured. Set GOOGLE_SHEET_SYNC_URL in env or enter the URL in Admin."

    # Sanitize URL: remove any accidental newlines, carriage returns, or spaces from copy-paste
    url = raw_url.replace('\n', '').replace('\r', '').replace(' ', '').strip()

    try:
        req = Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urlopen(req, timeout=45) as resp:
            content = resp.read()

        file_bytes = None
        try:
            decoded = base64.b64decode(content, validate=True)
            if decoded.startswith(b'PK'):  # Standard zip/xlsx header
                file_bytes = decoded
        except Exception:
            pass

        if not file_bytes:
            if content.startswith(b'PK'):
                file_bytes = content
            else:
                return False, "Invalid response from Google Sheets proxy. Verify the script URL and permissions."

        stream = io.BytesIO(file_bytes)
        import_excel(stream)
        return True, "Timetable successfully synced from Google Sheet!"
    except Exception as e:
        return False, f"Failed to sync: {str(e)}"


def start_morning_scheduler(app):
    """Start a background daemon thread that checks every morning at 06:00 AM IST to auto-sync."""
    import threading
    import time
    from datetime import datetime, timedelta, timezone

    def _scheduler_loop():
        time.sleep(10)  # Initial delay after server boot
        # IST is UTC+5:30
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        last_synced_date = None

        while True:
            try:
                now_ist = datetime.now(ist_tz)
                today_str = now_ist.strftime('%Y-%m-%d')

                # Check if it's 6:00 AM or later and we haven't synced today yet
                if now_ist.hour >= 6 and last_synced_date != today_str:
                    from config import Config
                    if Config.GOOGLE_SHEET_SYNC_URL:
                        with app.app_context():
                            print(f'[AUTO-SYNC] [{now_ist.strftime("%Y-%m-%d %H:%M:%S")}] Running daily morning timetable sync...')
                            success, msg = sync_from_google_sheet()
                            print(f'[AUTO-SYNC] Result: {msg}')
                            if success:
                                last_synced_date = today_str
            except Exception as ex:
                print(f'[AUTO-SYNC Error] {ex}')

            time.sleep(300)  # Check every 5 minutes

    thread = threading.Thread(target=_scheduler_loop, daemon=True)
    thread.start()


def broadcast_push_notification(title, body, url='/', tag='announcement'):
    """Send a custom push notification to all users who have an active push subscription."""
    import json
    from datetime import datetime
    from pywebpush import webpush, WebPushException
    from config import Config
    from models import Notification
    from extensions import db

    if not Config.VAPID_PUBLIC_KEY or not Config.VAPID_PRIVATE_KEY:
        return {'total': 0, 'sent': 0, 'failed': 0, 'error': 'VAPID keys not configured.'}

    # Query all active subscriptions in existing DB (filter out 'null' strings and empties)
    subscriptions = Notification.query.filter(
        Notification.push_subscription.isnot(None),
        Notification.push_subscription != 'null',
        Notification.push_subscription != ''
    ).all()
    if not subscriptions:
        return {'total': 0, 'sent': 0, 'failed': 0, 'message': 'No users have enabled push notifications yet.'}

    vapid_claims = {'sub': f'mailto:{Config.VAPID_CLAIM_EMAIL}'}
    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url or '/',
        'tag': tag or 'announcement',
        'timestamp': int(datetime.utcnow().timestamp() * 1000)
    })

    sent = 0
    failed = 0

    for notif in subscriptions:
        try:
            if not notif.push_subscription or notif.push_subscription == 'null':
                continue
            sub_info = json.loads(notif.push_subscription)
            if not isinstance(sub_info, dict) or not sub_info.get('endpoint'):
                continue

            webpush(
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=Config.VAPID_PRIVATE_KEY,
                vapid_claims=vapid_claims,
                timeout=10
            )
            sent += 1
        except WebPushException as ex:
            failed += 1
            # If subscription expired/unregistered or has invalid VAPID token (400, 401, 404, 410), clear it
            status_code = getattr(ex.response, 'status_code', None) if hasattr(ex, 'response') else None
            if status_code in [400, 401, 404, 410]:
                try:
                    notif.push_subscription = None
                    db.session.commit()
                except Exception:
                    db.session.rollback()
        except Exception:
            failed += 1

    return {
        'total': len(subscriptions),
        'sent': sent,
        'failed': failed,
        'message': f'Notification sent to {sent} of {len(subscriptions)} subscriber(s).'
    }

# ─── DB seeding ───────────────────────────────────────────────────────────────

def create_default_admin():
    """Create the default admin user and seed slots on first run."""
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(username='admin', email='admin@iimsambalpur.ac.in', is_admin=True)
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        print('[OK] Default admin created: admin / admin123')
    seed_default_slots()

