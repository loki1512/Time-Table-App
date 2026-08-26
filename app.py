"""
app.py
~~~~~~
Application factory.  Everything else lives in the modules below:

    config.py       – Flask configuration
    extensions.py   – Extension instances (db, bcrypt, login_manager, migrate)
    models.py       – SQLAlchemy models
    helpers.py      – Utility functions & DB seeders
    routes.py       – main_bp  (auth, pages, read-only API)
    admin_routes.py – admin_bp (write / admin-only API)
"""

import os
from flask import Flask

from config import Config
from extensions import db, bcrypt, login_manager, migrate
from routes import main_bp
from admin_routes import admin_bp


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # ── Initialise extensions ─────────────────────────────────────────────────
    db.init_app(app)
    bcrypt.init_app(app)
    login_manager.init_app(app)
    migrate.init_app(app, db)

    # ── Register blueprints ───────────────────────────────────────────────────
    app.register_blueprint(main_bp)
    app.register_blueprint(admin_bp)

    # ── Start Daily Morning Auto-Sync Scheduler ──────────────────────────────
    from helpers import start_morning_scheduler
    start_morning_scheduler(app)

    return app


# ─── Entry point ──────────────────────────────────────────────────────────────

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'

    with app.app_context():
        # Import models so SQLAlchemy knows about all tables
        import models  # noqa: F401

        db.create_all()

        from helpers import create_default_admin, import_excel
        create_default_admin()

        # Auto-import Excel on first run
        excel_path = os.path.join(os.path.dirname(__file__), 'MBA BA 2026-28 Term I Schedule .xlsx')
        if os.path.exists(excel_path):
            from models import ClassSession
            if ClassSession.query.count() == 0:
                print('[INFO] Importing timetable from Excel...')
                import_excel(excel_path)
                print('[OK] Timetable imported successfully!')

    app.run(debug=debug, host='0.0.0.0', port=port)
