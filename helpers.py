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
    '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
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


def import_excel(filepath):
    """Parse Excel timetable and populate the DB."""
    wb = openpyxl.load_workbook(filepath)
    ws = wb.active

    course_color_idx = 0
    courses_by_short = {}

    # Read course table at bottom (after row 60 roughly)
    for row in ws.iter_rows(min_row=60, max_row=ws.max_row, values_only=True):
        if row[0] is None:
            continue
        try:
            float(row[0])
        except (TypeError, ValueError):
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

    for row in ws.iter_rows(min_row=4, max_row=59, values_only=True):
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
