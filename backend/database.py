import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "studyshield.db"


class ProgressRepository:
    def __init__(self, db_path: str | Path | None = None):
        configured = db_path or os.getenv("STUDYSHIELD_DB_PATH") or DEFAULT_DB_PATH
        self.db_path = Path(configured)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    question TEXT NOT NULL,
                    expected_answer TEXT NOT NULL,
                    student_answer TEXT NOT NULL,
                    score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
                    status TEXT NOT NULL CHECK(status IN ('Strong', 'Needs Revision', 'Weak')),
                    correct_points TEXT NOT NULL,
                    missing_points TEXT NOT NULL,
                    feedback TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id, created_at)"
            )

    def add_attempt(self, *, student_id: str, topic: str, question: str,
                    expected_answer: str, student_answer: str, score: int,
                    status: str, correct_points: list[str],
                    missing_points: list[str], feedback: str) -> dict:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO attempts (
                    student_id, topic, question, expected_answer, student_answer,
                    score, status, correct_points, missing_points, feedback
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (student_id, topic, question, expected_answer, student_answer,
                 score, status, json.dumps(correct_points),
                 json.dumps(missing_points), feedback),
            )
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        return self._deserialize(row)

    def history(self, student_id: str) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM attempts WHERE student_id = ? ORDER BY id", (student_id,)
            ).fetchall()
        return [self._deserialize(row) for row in rows]

    def topic_statistics(self, student_id: str) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT topic, ROUND(AVG(score), 1) AS average_score,
                       COUNT(*) AS attempts, MAX(created_at) AS last_attempt_at
                FROM attempts WHERE student_id = ?
                GROUP BY topic
                ORDER BY average_score ASC, attempts DESC, topic ASC
                """,
                (student_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _deserialize(row: sqlite3.Row) -> dict:
        result = dict(row)
        result["correct_points"] = json.loads(result["correct_points"])
        result["missing_points"] = json.loads(result["missing_points"])
        return result

