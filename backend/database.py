import sqlite3
from contextlib import contextmanager

from .config import Settings


@contextmanager
def connect(settings: Settings):
    db = sqlite3.connect(settings.database_path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(settings: Settings):
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(settings) as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                full_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('student', 'business', 'admin')),
                email_verified INTEGER NOT NULL DEFAULT 0,
                newsletter_opt_in INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS action_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL CHECK(purpose IN ('reset', 'verify', 'unsubscribe')),
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY,
                subject TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS outbox (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                campaign_id INTEGER REFERENCES campaigns(id),
                recipient TEXT NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                html_body TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rate_limits (
                key TEXT PRIMARY KEY,
                hits INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS tokens_user ON action_tokens(user_id, purpose);
            CREATE INDEX IF NOT EXISTS mail_pending ON outbox(status, next_attempt);
        """)
        # Small, additive upgrade for databases created before HTML email support.
        if "html_body" not in {row["name"] for row in db.execute("PRAGMA table_info(outbox)")}:
            db.execute("ALTER TABLE outbox ADD COLUMN html_body TEXT NOT NULL DEFAULT ''")
