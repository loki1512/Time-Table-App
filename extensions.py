from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager
from flask_migrate import Migrate

db = SQLAlchemy()
bcrypt = Bcrypt()
login_manager = LoginManager()
migrate = Migrate()

# Login manager settings (applied once the app is bound via init_app)
login_manager.login_view = 'main.login'
login_manager.login_message = 'Please log in to access this page.'
