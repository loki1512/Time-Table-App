"""
migrate_to_supabase.py
~~~~~~~~~~~~~~~~~~~~~~
One-shot script: reads all data from the local SQLite database and
inserts it into the Supabase PostgreSQL database.

Usage:
    python migrate_to_supabase.py

The Supabase DATABASE_URL must be set as an environment variable OR
the SUPABASE_URL constant below is used as fallback.
"""

import os
import sqlite3
import sys

# ── Connection strings ────────────────────────────────────────────────────────

SQLITE_PATH = os.path.join(os.path.dirname(__file__), 'instance', 'timetable.db')

SUPABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres.bqshxvwokpetqempxlah:LuiUgO2WQEVCqKLm@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def sqlite_conn():
    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def pg_conn():
    import psycopg2
    return psycopg2.connect(SUPABASE_URL, sslmode='require')


def to_bool(value):
    """Convert SQLite int (0/1) to Python bool for PostgreSQL."""
    if value is None:
        return None
    return bool(value)


# ── Schema creation ───────────────────────────────────────────────────────────

def create_tables(pg):
    """Create tables in Supabase if they don't exist (mirrors SQLAlchemy models)."""
    cur = pg.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS "user" (
            id              SERIAL PRIMARY KEY,
            username        VARCHAR(80)  UNIQUE NOT NULL,
            email           VARCHAR(120) UNIQUE NOT NULL,
            password_hash   VARCHAR(255) NOT NULL,
            is_admin        BOOLEAN DEFAULT FALSE,
            created_at      TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS course (
            id          SERIAL PRIMARY KEY,
            code        VARCHAR(20)  UNIQUE NOT NULL,
            name        VARCHAR(200) NOT NULL,
            credits     FLOAT DEFAULT 3.0,
            area        VARCHAR(50),
            faculty     VARCHAR(300),
            short_name  VARCHAR(20),
            color       VARCHAR(7) DEFAULT '#6366f1',
            course_link VARCHAR(500)
        );

        CREATE TABLE IF NOT EXISTS time_slot (
            id          SERIAL PRIMARY KEY,
            slot_number INTEGER UNIQUE NOT NULL,
            label       VARCHAR(50) NOT NULL,
            start_time  VARCHAR(5)  NOT NULL,
            end_time    VARCHAR(5)  NOT NULL,
            created_at  TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS class_session (
            id          SERIAL PRIMARY KEY,
            date        DATE    NOT NULL,
            day_name    VARCHAR(20),
            slot        INTEGER NOT NULL,
            subject_raw VARCHAR(300),
            course_id   INTEGER REFERENCES course(id),
            is_special  BOOLEAN DEFAULT FALSE,
            notes       TEXT,
            created_at  TIMESTAMP DEFAULT NOW(),
            updated_at  TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS notification (
            id                    SERIAL PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES "user"(id),
            push_subscription     TEXT,
            notify_before_class   BOOLEAN DEFAULT TRUE,
            notify_minutes_before INTEGER DEFAULT 15,
            notify_morning        BOOLEAN DEFAULT TRUE,
            morning_time          VARCHAR(5) DEFAULT '07:00',
            created_at            TIMESTAMP DEFAULT NOW()
        );
    """)
    pg.commit()
    cur.close()
    print('[OK] Tables created / verified in Supabase.')


def reset_sequence(cur, pg, table, col='id'):
    """Reset the SERIAL sequence to avoid future PK collisions."""
    cur.execute(f"""
        SELECT setval(
            pg_get_serial_sequence('{table}', '{col}'),
            COALESCE((SELECT MAX({col}) FROM {table}), 1)
        )
    """)
    pg.commit()


# ── Per-table migrations ──────────────────────────────────────────────────────

def migrate_users(sqlite, pg):
    rows = sqlite.execute(
        'SELECT id, username, email, password_hash, is_admin, created_at FROM "user"'
    ).fetchall()
    if not rows:
        print('  [SKIP] user: no rows')
        return

    cur = pg.cursor()
    inserted = skipped = 0
    for r in rows:
        try:
            cur.execute(
                """INSERT INTO "user" (id, username, email, password_hash, is_admin, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (r['id'], r['username'], r['email'], r['password_hash'],
                 to_bool(r['is_admin']), r['created_at'])
            )
            inserted += cur.rowcount
            if not cur.rowcount:
                skipped += 1
        except Exception as e:
            pg.rollback()
            print(f'  [WARN] user row {r["id"]} skipped: {e}')
            skipped += 1

    pg.commit()
    reset_sequence(cur, pg, '"user"')
    cur.close()
    print(f'  [OK] user: {inserted} inserted, {skipped} skipped.')


def migrate_courses(sqlite, pg):
    rows = sqlite.execute(
        'SELECT id, code, name, credits, area, faculty, short_name, color, course_link FROM course'
    ).fetchall()
    if not rows:
        print('  [SKIP] course: no rows')
        return

    cur = pg.cursor()
    inserted = skipped = 0
    for r in rows:
        try:
            cur.execute(
                """INSERT INTO course (id, code, name, credits, area, faculty, short_name, color, course_link)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (r['id'], r['code'], r['name'], r['credits'], r['area'],
                 r['faculty'], r['short_name'], r['color'], r['course_link'])
            )
            inserted += cur.rowcount
            if not cur.rowcount:
                skipped += 1
        except Exception as e:
            pg.rollback()
            print(f'  [WARN] course row {r["id"]} skipped: {e}')
            skipped += 1

    pg.commit()
    reset_sequence(cur, pg, 'course')
    cur.close()
    print(f'  [OK] course: {inserted} inserted, {skipped} skipped.')


def migrate_time_slots(sqlite, pg):
    rows = sqlite.execute(
        'SELECT id, slot_number, label, start_time, end_time, created_at FROM time_slot'
    ).fetchall()
    if not rows:
        print('  [SKIP] time_slot: no rows')
        return

    cur = pg.cursor()
    inserted = skipped = 0
    for r in rows:
        try:
            cur.execute(
                """INSERT INTO time_slot (id, slot_number, label, start_time, end_time, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (r['id'], r['slot_number'], r['label'], r['start_time'], r['end_time'], r['created_at'])
            )
            inserted += cur.rowcount
            if not cur.rowcount:
                skipped += 1
        except Exception as e:
            pg.rollback()
            print(f'  [WARN] time_slot row {r["id"]} skipped: {e}')
            skipped += 1

    pg.commit()
    reset_sequence(cur, pg, 'time_slot')
    cur.close()
    print(f'  [OK] time_slot: {inserted} inserted, {skipped} skipped.')


def migrate_sessions(sqlite, pg):
    rows = sqlite.execute(
        'SELECT id, date, day_name, slot, subject_raw, course_id, is_special, notes, created_at, updated_at FROM class_session'
    ).fetchall()
    if not rows:
        print('  [SKIP] class_session: no rows')
        return

    cur = pg.cursor()
    inserted = skipped = 0
    for r in rows:
        try:
            cur.execute(
                """INSERT INTO class_session
                       (id, date, day_name, slot, subject_raw, course_id, is_special, notes, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (r['id'], r['date'], r['day_name'], r['slot'], r['subject_raw'],
                 r['course_id'], to_bool(r['is_special']), r['notes'],
                 r['created_at'], r['updated_at'])
            )
            inserted += cur.rowcount
            if not cur.rowcount:
                skipped += 1
        except Exception as e:
            pg.rollback()
            print(f'  [WARN] class_session row {r["id"]} skipped: {e}')
            skipped += 1

    pg.commit()
    reset_sequence(cur, pg, 'class_session')
    cur.close()
    print(f'  [OK] class_session: {inserted} inserted, {skipped} skipped.')


def migrate_notifications(sqlite, pg):
    rows = sqlite.execute(
        'SELECT id, user_id, push_subscription, notify_before_class, notify_minutes_before, notify_morning, morning_time, created_at FROM notification'
    ).fetchall()
    if not rows:
        print('  [SKIP] notification: no rows')
        return

    cur = pg.cursor()
    inserted = skipped = 0
    for r in rows:
        try:
            cur.execute(
                """INSERT INTO notification
                       (id, user_id, push_subscription, notify_before_class,
                        notify_minutes_before, notify_morning, morning_time, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING""",
                (r['id'], r['user_id'], r['push_subscription'],
                 to_bool(r['notify_before_class']), r['notify_minutes_before'],
                 to_bool(r['notify_morning']), r['morning_time'], r['created_at'])
            )
            inserted += cur.rowcount
            if not cur.rowcount:
                skipped += 1
        except Exception as e:
            pg.rollback()
            print(f'  [WARN] notification row {r["id"]} skipped: {e}')
            skipped += 1

    pg.commit()
    reset_sequence(cur, pg, 'notification')
    cur.close()
    print(f'  [OK] notification: {inserted} inserted, {skipped} skipped.')


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(SQLITE_PATH):
        print(f'[ERROR] SQLite DB not found at {SQLITE_PATH}')
        sys.exit(1)

    print(f'[INFO] Reading from SQLite: {SQLITE_PATH}')
    print(f'[INFO] Writing to Supabase: {SUPABASE_URL[:60]}...\n')

    sqlite = sqlite_conn()
    pg = pg_conn()
    print('[OK] Connected to both databases.\n')

    create_tables(pg)
    print()

    print('[INFO] Migrating users...')
    migrate_users(sqlite, pg)

    print('[INFO] Migrating courses...')
    migrate_courses(sqlite, pg)

    print('[INFO] Migrating time slots...')
    migrate_time_slots(sqlite, pg)

    print('[INFO] Migrating class sessions...')
    migrate_sessions(sqlite, pg)

    print('[INFO] Migrating notifications...')
    migrate_notifications(sqlite, pg)

    sqlite.close()
    pg.close()

    print('\n[DONE] Migration complete!')


if __name__ == '__main__':
    main()
