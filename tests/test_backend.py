import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

from backend.adaptive import confidence_insight, choose_next_target, next_difficulty, status_for_score
from backend.database import ProgressRepository
from backend.main import (
    AnswerEvaluationRequest, GeneratedWeakPlan, _concept_performance, _graph_material, _model_call,
    _quiz_material, _read_pdf,
    _specific_misconceptions, evaluate_answer, health, origins,
)
from backend.model_utils import StructuredOutputError, ask_structured, parse_structured
from backend.ollama_client import OllamaTimeoutError, OllamaUnavailableError
from backend.schemas import ConceptGraph, Evaluation, PDFAnalysis, Quiz


VALID_EVALUATION = (
    '{"score": 74, "status": "Needs Revision", "correct_points": ["core idea"], '
    '"missing_points": ["detail"], "feedback": "Review the detail."}'
)


class HealthTests(unittest.TestCase):
    def test_health_endpoint(self):
        result = health()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["service"], "StudyShield API")

    def test_default_cors_allows_browser_and_packaged_desktop_origins(self):
        for origin in ("http://localhost:5173", "http://tauri.localhost", "tauri://localhost"):
            self.assertIn(origin, origins)


class PDFValidationTests(unittest.TestCase):
    def test_non_pdf_is_rejected(self):
        upload = UploadFile(
            file=io.BytesIO(b"not a pdf"),
            filename="notes.txt",
            headers=Headers({"content-type": "text/plain"}),
        )
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(_read_pdf(upload))
        self.assertEqual(caught.exception.status_code, 415)

    def test_fake_pdf_is_rejected(self):
        upload = UploadFile(
            file=io.BytesIO(b"not a pdf"),
            filename="notes.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(_read_pdf(upload))
        self.assertEqual(caught.exception.status_code, 400)


class OllamaErrorTests(unittest.TestCase):
    def test_unavailable_ollama_maps_to_503(self):
        with patch("backend.main.ask_model", side_effect=OllamaUnavailableError("Ollama unavailable")):
            with self.assertRaises(HTTPException) as caught:
                _model_call("hello")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, "Ollama unavailable")

    def test_model_timeout_maps_to_504(self):
        with patch("backend.main.ask_model", side_effect=OllamaTimeoutError("The local model timed out.")):
            with self.assertRaises(HTTPException) as caught:
                _model_call("hello")
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(caught.exception.detail, "The local model timed out.")


class StructuredOutputTests(unittest.TestCase):
    def test_evaluation_json_is_validated(self):
        evaluation = ask_structured("prompt", Evaluation, lambda _: VALID_EVALUATION)
        self.assertEqual(evaluation.score, 74)
        self.assertEqual(evaluation.correct_points, ["core idea"])

    def test_malformed_response_is_repaired_once(self):
        replies = iter(["not json", VALID_EVALUATION])
        calls = []

        def ask(prompt):
            calls.append(prompt)
            return next(replies)

        evaluation = ask_structured("prompt", Evaluation, ask)
        self.assertEqual(evaluation.score, 74)
        self.assertEqual(len(calls), 2)
        self.assertIn("failed JSON validation", calls[1])

    def test_two_malformed_responses_fail_safely(self):
        calls = []

        def ask(prompt):
            calls.append(prompt)
            return "still not json"

        with self.assertRaises(StructuredOutputError):
            ask_structured("prompt", Evaluation, ask)
        self.assertEqual(len(calls), 2)

    def test_missing_required_field_is_rejected(self):
        with self.assertRaises(StructuredOutputError):
            parse_structured('{"score": 80}', Evaluation)

    def test_invalid_status_and_score_are_rejected(self):
        for raw in (
            VALID_EVALUATION.replace('"Needs Revision"', '"Almost"'),
            VALID_EVALUATION.replace('74', '101'),
        ):
            with self.subTest(raw=raw), self.assertRaises(StructuredOutputError):
                parse_structured(raw, Evaluation)

    def test_extra_non_json_text_is_rejected(self):
        with self.assertRaises(StructuredOutputError):
            parse_structured(f"Here is the result: {VALID_EVALUATION}", Evaluation)

    def test_all_structured_contracts_accept_valid_json(self):
        analysis = PDFAnalysis.model_validate({
            "title": "Biology", "main_topics": [{"topic": "Cells", "important_concepts": ["DNA"]}],
            "key_revision_points": ["Cells contain DNA"],
            "difficult_areas": [{"concept": "DNA", "reason": "It is abstract"}],
        })
        quiz = Quiz.model_validate({"topic": "Cells", "difficulty": "Medium", "question": "Why?",
                                    "expected_answer": "Because.", "explanation": "A reason."})
        plan = GeneratedWeakPlan.model_validate({"weak_topics": [{"topic": "Cells",
            "why_weak": "A detail was missed", "revision_plan": ["Review"],
            "mini_explanation": "Cells are units of life", "practice_question": "Explain a cell."}]})
        self.assertEqual(analysis.title, "Biology")
        self.assertEqual(quiz.difficulty, "Medium")
        self.assertEqual(plan.weak_topics[0].topic, "Cells")

    def test_concept_graph_validates_nodes_and_edges(self):
        graph = ConceptGraph.model_validate({
            "concepts": [
                {"id": "cells", "label": "Cells", "importance": 0.9},
                {"id": "dna", "label": "DNA", "importance": 0.8},
            ],
            "edges": [{"source": "cells", "target": "dna", "relationship": "related"}],
        })
        self.assertEqual(len(graph.concepts), 2)
        self.assertEqual(graph.edges[0].target, "dna")

    def test_concept_graph_rejects_missing_or_unknown_nodes(self):
        invalid_graphs = (
            {"concepts": [{"id": "cells", "importance": 0.9}], "edges": []},
            {"concepts": [{"id": "cells", "label": "Cells", "importance": 0.9}],
             "edges": [{"source": "cells", "target": "dna", "relationship": "related"}]},
        )
        for graph in invalid_graphs:
            with self.subTest(graph=graph), self.assertRaises(ValidationError):
                ConceptGraph.model_validate(graph)

    def test_invalid_model_output_is_not_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            isolated = ProgressRepository(Path(directory) / "safe.db")
            isolated.initialize()
            request = AnswerEvaluationRequest(student_id="friend01", topic="Cells", question="Why?",
                                               expected_answer="Because", student_answer="Unsure")
            with patch("backend.main.repository", isolated), patch(
                "backend.main._structured", side_effect=HTTPException(status_code=502, detail="invalid")
            ):
                with self.assertRaises(HTTPException):
                    evaluate_answer(request)
            self.assertEqual(isolated.history("friend01"), [])

    def test_vague_misconceptions_are_not_persistable(self):
        items = _specific_misconceptions([
            "Student does not understand the topic.",
            "Student confuses mutability with the ordering of tuple elements.",
        ])
        self.assertEqual(items, ["Student confuses mutability with the ordering of tuple elements."])


class PersistenceTests(unittest.TestCase):
    def test_progress_survives_repository_recreation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.db"
            first = ProgressRepository(path)
            first.initialize()
            first.add_attempt(
                student_id="friend01",
                topic="Photosynthesis",
                question="Why do plants need light?",
                expected_answer="Light supplies energy.",
                student_answer="It gives energy.",
                score=90,
                status="Strong",
                correct_points=["energy"],
                missing_points=[],
                feedback="Well done.",
            )

            restarted = ProgressRepository(path)
            restarted.initialize()
            history = restarted.history("friend01")

            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]["topic"], "Photosynthesis")
            self.assertEqual(history[0]["correct_points"], ["energy"])

    def test_confidence_survives_repository_recreation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "confidence.db"
            repo = ProgressRepository(path)
            repo.initialize()
            repo.add_attempt(
                student_id="friend01", topic="Cells", question="Q", expected_answer="A",
                student_answer="B", score=42, status="Weak", correct_points=[],
                missing_points=["A"], feedback="Review", confidence="high",
                confidence_insight="High-Risk Misconception",
            )
            restarted = ProgressRepository(path)
            restarted.initialize()
            attempt = restarted.history("friend01")[0]
            self.assertEqual(attempt["confidence"], "high")
            self.assertEqual(attempt["confidence_insight"], "High-Risk Misconception")
            self.assertEqual(restarted.topic_statistics("friend01")[0]["high_confidence_wrong"], 1)

    def test_students_are_separated_and_statistics_use_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = ProgressRepository(Path(directory) / "students.db")
            repo.initialize()
            common = dict(question="Q", expected_answer="A", student_answer="A",
                          status="Strong", correct_points=["A"], missing_points=[], feedback="Good")
            repo.add_attempt(student_id="friend01", topic="Biology", score=90, **common)
            repo.add_attempt(student_id="friend02", topic="Physics", score=70,
                             **{**common, "status": "Needs Revision"})
            self.assertEqual([item["topic"] for item in repo.history("friend01")], ["Biology"])
            self.assertEqual([item["topic"] for item in repo.history("friend02")], ["Physics"])
            self.assertEqual(repo.topic_statistics("friend01")[0]["average_score"], 90.0)

    def test_concept_graph_cache_persists_repository_recreation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "graphs.db"
            first = ProgressRepository(path)
            first.initialize()
            graph = {"concepts": [{"id": "cells", "label": "Cells", "importance": 0.9}],
                     "edges": []}
            first.save_concept_graph("material-hash", graph)
            restarted = ProgressRepository(path)
            restarted.initialize()
            self.assertEqual(restarted.get_concept_graph("material-hash"), graph)

    def test_misconception_increments_persists_and_requires_mastery_to_resolve(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "misconceptions.db"
            repo = ProgressRepository(path)
            repo.initialize()
            common = dict(student_id="friend01", topic="Tuples", question="Q",
                          expected_answer="Tuples are immutable", student_answer="They are faster lists",
                          score=40, status="Weak", correct_points=[], missing_points=["immutability"],
                          feedback="Review immutability")
            first_attempt = repo.add_attempt(**common)
            first = repo.record_misconception(
                student_id="friend01", topic="Tuples",
                misconception="Student specifically confuses tuples with lists, thinking tuples are mutable.",
                evidence="They are faster lists", attempt_id=first_attempt["id"],
            )
            second_attempt = repo.add_attempt(**common)
            repeated = repo.record_misconception(
                student_id="friend01", topic="Tuples",
                misconception="Student specifically confuses tuples with being mutable instead of immutable.",
                evidence="They are faster lists", attempt_id=second_attempt["id"],
            )
            self.assertEqual((first["id"], repeated["occurrence_count"]), (repeated["id"], 2))

            restarted = ProgressRepository(path)
            restarted.initialize()
            self.assertEqual(restarted.misconceptions("friend01")[0]["occurrence_count"], 2)
            self.assertFalse(restarted.resolve_misconception("friend01", first["id"])["resolved"])

            restarted.add_attempt(**{**common, "student_answer": "Tuples cannot be changed after creation.",
                                     "score": 95, "status": "Strong", "correct_points": ["immutability"],
                                     "missing_points": [], "feedback": "Correct"})
            self.assertTrue(restarted.resolve_misconception("friend01", first["id"])["resolved"])


class AdaptiveRuleTests(unittest.TestCase):
    def test_confidence_interpretation_rules(self):
        cases = (
            ("high", 40, "High-Risk Misconception"),
            ("high", 90, "Confident & Correct"),
            ("low", 90, "Correct but Uncertain"),
            ("low", 40, "Needs Guided Practice"),
            ("medium", 74, "Medium confidence · Needs Revision"),
        )
        for confidence, score, expected in cases:
            with self.subTest(confidence=confidence, score=score):
                self.assertEqual(confidence_insight(confidence, score), expected)

    def test_high_confidence_wrong_has_highest_adaptive_priority(self):
        history = [
            {"topic": "Cells", "score": 20, "difficulty": "Medium", "confidence": "low"},
            {"topic": "Atoms", "score": 55, "difficulty": "Medium", "confidence": "high"},
        ]
        topic, difficulty, reason = choose_next_target(history)
        self.assertEqual((topic, difficulty), ("Atoms", "Easy"))
        self.assertIn("Highest priority", reason)

    def test_low_confidence_correct_gets_light_reinforcement(self):
        history = [{"topic": "Cells", "score": 92, "difficulty": "Medium", "confidence": "low"}]
        topic, difficulty, reason = choose_next_target(history, "Cells")
        self.assertEqual((topic, difficulty), ("Cells", "Medium"))
        self.assertIn("Light reinforcement", reason)

    def test_status_thresholds(self):
        expected = {95: "Strong", 85: "Strong", 84: "Needs Revision", 75: "Needs Revision",
                    60: "Needs Revision", 59: "Weak", 30: "Weak"}
        self.assertEqual({score: status_for_score(score) for score in expected}, expected)

    def test_difficulty_changes_are_bounded(self):
        self.assertEqual(next_difficulty("Medium", 90), "Hard")
        self.assertEqual(next_difficulty("Hard", 90), "Hard")
        self.assertEqual(next_difficulty("Medium", 50), "Easy")
        self.assertEqual(next_difficulty("Easy", 50), "Easy")

    def test_targeting_uses_history_deterministically(self):
        weak_history = [{"topic": "Cells", "score": 30, "difficulty": "Medium"}]
        topic, difficulty, reason = choose_next_target(weak_history, "Atoms")
        self.assertEqual((topic, difficulty), ("Cells", "Easy"))
        self.assertIn("30.0% average", reason)

        strong_history = [{"topic": "Cells", "score": 95, "difficulty": "Medium"}]
        topic, difficulty, _ = choose_next_target(strong_history, "Cells")
        self.assertEqual((topic, difficulty), ("Cells", "Hard"))

    def test_targeted_quiz_uses_chunk_containing_topic(self):
        first = "Introductory material. " * 800
        text = first + "\nMitochondria release usable energy through cellular respiration."
        selected = _quiz_material(text, "Mitochondria")
        self.assertIn("Mitochondria", selected)

    def test_concept_performance_overlay(self):
        statistics = [{"topic": "Cell Biology", "average_score": 58.0, "attempts": 2}]
        self.assertEqual(_concept_performance("Cells", statistics)["status"], "unpracticed")
        weak = _concept_performance("Cell Biology", statistics)
        self.assertEqual((weak["average_score"], weak["attempts"], weak["status"]),
                         (58.0, 2, "weak"))

    def test_concept_graph_samples_across_long_material(self):
        text = "START-TOPIC\n" + ("middle material " * 3000) + "\nEND-TOPIC"
        material = _graph_material(text, max_chunks=3)
        self.assertIn("START-TOPIC", material)
        self.assertIn("END-TOPIC", material)


if __name__ == "__main__":
    unittest.main()
