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
                    confidence TEXT NOT NULL DEFAULT 'medium' CHECK(confidence IN ('low', 'medium', 'high')),
                    confidence_insight TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(attempts)")}
            if "confidence" not in columns:
                connection.execute("ALTER TABLE attempts ADD COLUMN confidence TEXT NOT NULL DEFAULT 'medium'")
            if "confidence_insight" not in columns:
                connection.execute("ALTER TABLE attempts ADD COLUMN confidence_insight TEXT NOT NULL DEFAULT ''")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS misconceptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    misconception TEXT NOT NULL,
                    normalized_key TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    occurrence_count INTEGER NOT NULL DEFAULT 1,
                    first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                    last_attempt_id INTEGER NOT NULL,
                    resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1)),
                    FOREIGN KEY(last_attempt_id) REFERENCES attempts(id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_misconceptions_student ON misconceptions(student_id, resolved, last_seen)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id, created_at)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS concept_graphs (
                    material_hash TEXT PRIMARY KEY,
                    graph_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )
                """
            )

    def add_attempt(self, *, student_id: str, topic: str, question: str,
                    expected_answer: str, student_answer: str, score: int,
                    status: str, correct_points: list[str],
                    missing_points: list[str], feedback: str, confidence: str = "medium",
                    confidence_insight: str = "") -> dict:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO attempts (
                    student_id, topic, question, expected_answer, student_answer,
                    score, status, correct_points, missing_points, feedback,
                    confidence, confidence_insight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (student_id, topic, question, expected_answer, student_answer,
                 score, status, json.dumps(correct_points),
                 json.dumps(missing_points), feedback, confidence, confidence_insight),
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
                       COUNT(*) AS attempts, MAX(created_at) AS last_attempt_at,
                       SUM(CASE WHEN confidence = 'high' AND score < 60 THEN 1 ELSE 0 END)
                           AS high_confidence_wrong,
                       SUM(CASE WHEN confidence = 'low' AND score >= 85 THEN 1 ELSE 0 END)
                           AS low_confidence_correct
                FROM attempts WHERE student_id = ?
                GROUP BY topic
                ORDER BY average_score ASC, attempts DESC, topic ASC
                """,
                (student_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_concept_graph(self, material_hash: str) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT graph_json FROM concept_graphs WHERE material_hash = ?", (material_hash,)
            ).fetchone()
        return json.loads(row["graph_json"]) if row else None

    def save_concept_graph(self, material_hash: str, graph: dict) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO concept_graphs (material_hash, graph_json)
                VALUES (?, ?)
                ON CONFLICT(material_hash) DO UPDATE SET graph_json = excluded.graph_json
                """,
                (material_hash, json.dumps(graph, ensure_ascii=False)),
            )

    @staticmethod
    def _misconception_key(text: str) -> str:
        cleaned = "".join(character for character in text.casefold()
                          if character.isalnum() or character.isspace())
        stop_words = {"student", "specifically", "believes", "believing", "regarding",
                      "thinking", "being", "instead", "of", "with", "the", "a", "an",
                      "that", "as", "are", "is"}
        words = []
        for word in cleaned.split():
            if word in stop_words:
                continue
            if word in {"mutable", "mutability", "immutable", "immutability"}:
                word = "mutability"
            elif word.endswith("s") and len(word) > 4:
                word = word[:-1]
            words.append(word)
        return " ".join(sorted(set(words)))

    @staticmethod
    def _similarity(left: str, right: str) -> float:
        left_words, right_words = set(left.split()), set(right.split())
        union = left_words | right_words
        return len(left_words & right_words) / len(union) if union else 0

    def record_misconception(self, *, student_id: str, topic: str, misconception: str,
                             evidence: str, attempt_id: int) -> dict:
        key = self._misconception_key(misconception)
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM misconceptions WHERE student_id = ? AND topic = ? AND resolved = 0",
                (student_id, topic),
            ).fetchall()
            match = next((row for row in rows
                          if self._misconception_key(row["misconception"]) == key or
                          self._similarity(self._misconception_key(row["misconception"]), key) >= 0.6),
                         None)
            if match:
                connection.execute(
                    """
                    UPDATE misconceptions SET occurrence_count = occurrence_count + 1,
                        misconception = ?, normalized_key = ?, evidence = ?,
                        last_attempt_id = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    WHERE id = ?
                    """,
                    (misconception, key, evidence, attempt_id, match["id"]),
                )
                misconception_id = match["id"]
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO misconceptions
                        (student_id, topic, misconception, normalized_key, evidence, last_attempt_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (student_id, topic, misconception, key, evidence, attempt_id),
                )
                misconception_id = cursor.lastrowid
            row = connection.execute(
                "SELECT * FROM misconceptions WHERE id = ?", (misconception_id,)
            ).fetchone()
        return self._misconception_row(row)

    def misconceptions(self, student_id: str) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM misconceptions WHERE student_id = ?
                ORDER BY resolved ASC, occurrence_count DESC, last_seen DESC
                """,
                (student_id,),
            ).fetchall()
        return [self._misconception_row(row) for row in rows]

    def resolve_misconception(self, student_id: str, misconception_id: int) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM misconceptions WHERE id = ? AND student_id = ?",
                (misconception_id, student_id),
            ).fetchone()
            if row is None:
                return None
            proof = connection.execute(
                """
                SELECT id FROM attempts
                WHERE student_id = ? AND topic = ? AND score >= 85 AND id > ?
                ORDER BY id DESC LIMIT 1
                """,
                (student_id, row["topic"], row["last_attempt_id"]),
            ).fetchone()
            if proof is None:
                return self._misconception_row(row)
            connection.execute("UPDATE misconceptions SET resolved = 1 WHERE id = ?", (row["id"],))
            updated = connection.execute(
                "SELECT * FROM misconceptions WHERE id = ?", (row["id"],)
            ).fetchone()
        return self._misconception_row(updated)

    @staticmethod
    def _misconception_row(row: sqlite3.Row) -> dict:
        result = dict(row)
        result["resolved"] = bool(result["resolved"])
        result.pop("normalized_key", None)
        result.pop("last_attempt_id", None)
        return result

    @staticmethod
    def _deserialize(row: sqlite3.Row) -> dict:
        result = dict(row)
        result["correct_points"] = json.loads(result["correct_points"])
        result["missing_points"] = json.loads(result["missing_points"])
        return result
