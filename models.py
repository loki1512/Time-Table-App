from datetime import datetime
from extensions import db, bcrypt, login_manager


# ─── User ─────────────────────────────────────────────────────────────────────

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Flask-Login requires these; UserMixin provides them
    @property
    def is_active(self):
        return True

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def get_id(self):
        return str(self.id)

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    @property
    def is_super_admin(self):
        """Super-admin is identified purely by username 'admin'. No DB column needed."""
        return self.username == 'admin'

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_admin': self.is_admin,
            'is_super_admin': self.is_super_admin,
            'created_at': self.created_at.isoformat(),
        }


# ─── Course ───────────────────────────────────────────────────────────────────

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(200), nullable=False)
    credits = db.Column(db.Float, default=3.0)
    area = db.Column(db.String(50))
    faculty = db.Column(db.String(300))
    short_name = db.Column(db.String(20))   # e.g., "FRA", "MM", "DS-I"
    color = db.Column(db.String(7), default='#2952CC')  # IIM Royal Blue
    course_link = db.Column(db.String(500), nullable=True)  # optional URL

    def to_dict(self):
        return {
            'id': self.id,
            'code': self.code,
            'name': self.name,
            'credits': self.credits,
            'area': self.area,
            'faculty': self.faculty,
            'short_name': self.short_name,
            'color': self.color,
            'course_link': self.course_link or '',
        }


# ─── ClassSession ─────────────────────────────────────────────────────────────

class ClassSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    day_name = db.Column(db.String(20))
    slot = db.Column(db.Integer, nullable=False)    # 1=9:30AM, 2=11:30AM, 3=2:00PM, 4=4:00PM
    subject_raw = db.Column(db.String(300))         # raw text from Excel / edited
    course_id = db.Column(db.Integer, db.ForeignKey('course.id'), nullable=True)
    course = db.relationship('Course', backref='sessions')
    is_special = db.Column(db.Boolean, default=False)   # holiday / exam
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        slot_obj = TimeSlot.query.filter_by(slot_number=self.slot).first()
        slot_time = slot_obj.start_time if slot_obj else ''
        return {
            'id': self.id,
            'date': self.date.isoformat(),
            'day_name': self.day_name,
            'slot': self.slot,
            'slot_time': slot_time,
            'subject_raw': self.subject_raw,
            'course': self.course.to_dict() if self.course else None,
            'is_special': self.is_special,
            'notes': self.notes,
        }


# ─── Notification ─────────────────────────────────────────────────────────────

class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user = db.relationship('User', backref='notifications')
    push_subscription = db.Column(db.Text)          # JSON Web Push subscription
    notify_before_class = db.Column(db.Boolean, default=True)
    notify_minutes_before = db.Column(db.Integer, default=15)
    notify_morning = db.Column(db.Boolean, default=True)
    morning_time = db.Column(db.String(5), default='07:00')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# ─── TimeSlot ─────────────────────────────────────────────────────────────────

class TimeSlot(db.Model):
    """Configurable time slot definitions."""
    id = db.Column(db.Integer, primary_key=True)
    slot_number = db.Column(db.Integer, nullable=False, unique=True)    # 1, 2, 3, 4…
    label = db.Column(db.String(50), nullable=False)        # e.g. '09:30 AM – 11:00 AM'
    start_time = db.Column(db.String(5), nullable=False)    # 'HH:MM' 24h
    end_time = db.Column(db.String(5), nullable=False)      # 'HH:MM' 24h
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'slot_number': self.slot_number,
            'label': self.label,
            'start_time': self.start_time,
            'end_time': self.end_time,
        }


# ─── User Loader ──────────────────────────────────────────────────────────────

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))
