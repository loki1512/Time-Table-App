import os
from pathlib import Path

# ── Load .env for local development ───────────────────────────────────────────
# python-dotenv loads the .env file only if it exists (local machine).
# On Render, no .env file is present — Render injects env vars directly,
# so DATABASE_URL will point to Supabase, not SQLite.
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).parent / '.env'
    if _env_path.exists():
        load_dotenv(_env_path, override=False)   # override=False → Render's vars win
        print(f'[CONFIG] Loaded .env from {_env_path}')
except ImportError:
    pass  # python-dotenv not installed; fall back to pure env vars


class Config:
    """
    Single config class.  Environment determines which database is used:

        Local dev  → .env sets DATABASE_URL=sqlite:///timetable.db
        Render     → Dashboard sets DATABASE_URL=<supabase-postgres-uri>

    No code changes needed to switch — just the env var.
    """

    # ── Security ──────────────────────────────────────────────────────────────
    SECRET_KEY = os.environ.get('SECRET_KEY', 'iim-sambalpur-timetable-secret-2026')
    CRON_SECRET = os.environ.get('CRON_SECRET', 'iim-timetable-cron-secret-2026')

    # ── Google Sheets Sync ─────────────────────────────────────────────────────
    GOOGLE_SHEET_SYNC_URL = os.environ.get('GOOGLE_SHEET_SYNC_URL', '')

    # ── Database ───────────────────────────────────────────────────────────────
    _db_url = os.environ.get('DATABASE_URL', 'sqlite:///timetable.db')

    # Render / Heroku supply "postgres://" — SQLAlchemy requires "postgresql://"
    if _db_url.startswith('postgres://'):
        _db_url = _db_url.replace('postgres://', 'postgresql://', 1)

    SQLALCHEMY_DATABASE_URI = _db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SEND_FILE_MAX_AGE_DEFAULT = 0  # Disable static file HTTP caching so updates load immediately

    # ── Engine options ─────────────────────────────────────────────────────────
    # SSL and pool settings only apply to PostgreSQL (Supabase).
    # SQLAlchemy ignores connect_args that don't apply to SQLite.
    _is_postgres = _db_url.startswith('postgresql')

    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        **({'pool_size': 5, 'max_overflow': 10, 'pool_recycle': 300,
            'connect_args': {'sslmode': 'require'}} if _is_postgres else {})
    }

    # ── Handy flag for runtime checks ─────────────────────────────────────────
    IS_LOCAL = not _is_postgres   # True locally (SQLite), False on Render (Postgres)
