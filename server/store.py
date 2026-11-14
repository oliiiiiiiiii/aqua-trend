"""Durable, immutable result/plan snapshots and atomic job transitions."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs(
                    id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL,
                    completed INTEGER NOT NULL, total INTEGER NOT NULL,
                    created TEXT NOT NULL, request TEXT NOT NULL, result TEXT, error TEXT);
                CREATE TABLE IF NOT EXISTS snapshots(
                    kind TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(kind,key));
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def resume_after_restart(self):
        # A single API process owns the worker pool. Never present an interrupted search as complete.
        error = {"code": "service_restarted", "message": "The service restarted. Run this study again.", "retryable": True}
        with self.connection() as db:
            db.execute("UPDATE jobs SET status='failed',stage='failed',error=? WHERE status='running'", (encode(error),))

    def add_job(self, request):
        job_id = uuid.uuid4().hex
        with self.connection() as db:
            db.execute("INSERT INTO jobs VALUES(?, 'running','validating',0,1,?,?,NULL,NULL)",
                       (job_id, now(), encode(request)))
        return self.job(job_id)

    def job(self, job_id):
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            return None
        item = dict(row)
        for key in ("request", "result", "error"):
            if item[key] is not None:
                item[key] = json.loads(item[key])
        return item

    def advance(self, job_id, stage, completed=0, total=1):
        with self.connection() as db:
            return db.execute("UPDATE jobs SET stage=?, completed=?, total=? WHERE id=? AND status='running'",
                              (stage, completed, total, job_id)).rowcount == 1

    def finish(self, job_id, status, result=None, error=None, preset=None):
        with self.connection() as db:
            changed = db.execute("""UPDATE jobs SET stage=?,status=?,completed=total,result=?,error=?
                                    WHERE id=? AND status='running'""",
                                 (status, status, encode(result) if result is not None else None,
                                  encode(error) if error else None, job_id)).rowcount
            if changed and preset:
                key = preset["public"]["id"] + ":" + preset["public"]["version"]
                db.execute("INSERT OR IGNORE INTO snapshots VALUES('preset',?,?)", (key, encode(preset)))
                if preset.get("search_key"):
                    db.execute("INSERT OR IGNORE INTO snapshots VALUES('completed_search',?,?)",
                               (preset["search_key"], encode(key)))
            return bool(changed)

    def get(self, kind, key):
        with self.connection() as db:
            row = db.execute("SELECT body FROM snapshots WHERE kind=? AND key=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def remember(self, kind, key, value):
        with self.connection() as db:
            db.execute("INSERT OR IGNORE INTO snapshots VALUES(?,?,?)", (kind, key, encode(value)))
            body = db.execute("SELECT body FROM snapshots WHERE kind=? AND key=?", (kind, key)).fetchone()[0]
        return json.loads(body)

    def published(self):
        with self.connection() as db:
            rows = db.execute("SELECT json_extract(body,'$.public') FROM snapshots WHERE kind='preset' ORDER BY rowid DESC")
            return [json.loads(r[0]) for r in rows]
