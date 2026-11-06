"""Immutable comparison snapshots and optimistic, append-only local review events."""

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from hardwise.revision.models import ComparisonResult


class ReviewConflict(ValueError):
    """The reviewer is acting on an outdated disposition version."""


class Disposition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    item_id: str = Field(min_length=1, max_length=100)
    state: Literal["open", "acknowledged", "needs_info"]
    note: str = Field(min_length=1, max_length=4000)
    expected_version: int = Field(ge=0)


def now():
    return datetime.now(timezone.utc).isoformat()


def review_items(result: ComparisonResult):
    """Both changes and unresolved declarations are first-class review items."""
    items = [
        dict(id=c.id, category="change", data=c.model_dump(mode="json")) for c in result.changes
    ]
    for index, issue in enumerate(result.issues):
        data = issue.model_dump(mode="json")
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:24]
        items.append(dict(id=f"issue-{index}-{digest}", category="issue", data=data))
    return items


class ReviewStore:
    def __init__(self, workspace: Path):
        self.workspace = workspace.resolve(strict=True)
        directory = self.workspace / ".hardwise-dsh"
        if directory.is_symlink():
            raise ValueError("审查目录不能是符号链接。")
        directory.mkdir(mode=0o700, exist_ok=True)
        self.path = directory / "reviews.sqlite3"
        if self.path.is_symlink():
            raise ValueError("审查数据库不能是符号链接。")
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
                    label TEXT NOT NULL, result TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS review_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL REFERENCES runs(id), item_id TEXT NOT NULL,
                    version INTEGER NOT NULL, state TEXT NOT NULL, note TEXT NOT NULL,
                    origin TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(run_id, item_id, version)
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, result: ComparisonResult, label: str):
        run_id = uuid.uuid4().hex
        with self.connection() as db:
            db.execute(
                "INSERT INTO runs VALUES (?, ?, ?, ?)",
                (run_id, now(), label[:160], result.model_dump_json()),
            )
        return self.get(run_id)

    def _get(self, db, run_id):
        row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("未找到这次比较，请从工作区列表重新打开。")
        result = ComparisonResult.model_validate_json(row["result"])
        history = [
            dict(r)
            for r in db.execute(
                "SELECT * FROM review_events WHERE run_id=? ORDER BY sequence", (run_id,)
            )
        ]
        latest = {event["item_id"]: event for event in history}
        items = review_items(result)
        for item in items:
            item["review"] = latest.get(
                item["id"],
                {
                    "version": 0,
                    "state": "open",
                    "note": "",
                    "origin": None,
                },
            )
        return {
            "run_id": row["id"],
            "created_at": row["created_at"],
            "label": row["label"],
            "result": result.model_dump(mode="json"),
            "items": items,
            "history": history,
            "review_counts": {
                state: sum(i["review"]["state"] == state for i in items)
                for state in ("open", "acknowledged", "needs_info")
            },
        }

    def get(self, run_id):
        with self.connection() as db:
            return self._get(db, run_id)

    def list(self):
        with self.connection() as db:
            rows = db.execute("SELECT id FROM runs ORDER BY created_at DESC LIMIT 100").fetchall()
            return [self.summary(self._get(db, row["id"])) for row in rows]

    @staticmethod
    def summary(run):
        return {
            **{key: run[key] for key in ("run_id", "created_at", "label", "review_counts")},
            "comparison_id": run["result"]["comparison_id"],
            "summary": run["result"]["summary"],
            "source_status": run["result"]["status"],
            "review_event_count": len(run["history"]),
            "electrical_verdict": "not_evaluated",
        }

    def record(self, run_id: str, disposition: Disposition):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            run = self._get(db, run_id)
            item = next((item for item in run["items"] if item["id"] == disposition.item_id), None)
            if item is None:
                raise KeyError("该条目不属于本次比较。")
            if item["review"]["version"] != disposition.expected_version:
                raise ReviewConflict("记录已被更新。请刷新并复核最新状态，再保存。")
            db.execute(
                """INSERT INTO review_events
                (run_id,item_id,version,state,note,origin,created_at) VALUES (?,?,?,?,?,?,?)""",
                (
                    run_id,
                    disposition.item_id,
                    disposition.expected_version + 1,
                    disposition.state,
                    disposition.note,
                    "local_ui",
                    now(),
                ),
            )
            return self._get(db, run_id)
