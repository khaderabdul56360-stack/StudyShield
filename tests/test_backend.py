import asyncio
import io
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import requests

from fastapi import HTTPException
from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

from backend.adaptive import (
    confidence_insight, choose_next_target, next_difficulty, revision_queue, status_for_score, summarize_session,
)
from backend.database import ProgressRepository
from backend.main import (
    AnswerEvaluationRequest, GeneratedWeakPlan, SessionSummaryRequest, _concept_performance, _graph_material,
    _model_call, _quiz_material, _read_pdf, _specific_misconceptions, evaluate_answer, health, origins,
    session_summary,
)
from backend.model_utils import StructuredOutputError, ask_structured, parse_structured
from backend.ollama_client import OllamaTimeoutError, OllamaUnavailableError, model_status
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

    def test_concept_graph_rejects_unlabelled_or_empty_graphs(self):
        for graph in ({"concepts": [{"id": "cells", "importance": 0.9}], "edges": []},
                      {"concepts": [], "edges": []}):
            with self.subTest(graph=graph), self.assertRaises(ValidationError):
                ConceptGraph.model_validate(graph)

    def test_concept_graph_repairs_harmless_model_slips(self):
        concepts = [{"id": f"Concept {n}", "label": f"Concept {n}", "importance": n / 20} for n in range(20)]
        concepts.append({"id": "concept-19", "label": "Duplicate", "importance": 1})
        graph = ConceptGraph.model_validate({"concepts": concepts, "edges": [
            {"source": "Concept 19", "target": "Concept 18", "relationship": "Part Of"},
            {"source": "concept-19", "target": "concept-18", "relationship": "related"},  # duplicate pair
            {"source": "concept-19", "target": "ghost", "relationship": "related"},      # dangling
            {"source": "concept-18", "target": "concept-18", "relationship": "related"},  # self edge
            {"source": "concept-17", "target": "concept-19", "relationship": "causes"},   # unknown type
        ]})
        self.assertEqual(len(graph.concepts), 16)
        self.assertEqual(graph.concepts[0].id, "concept-19")  # most important kept, duplicate ID dropped
        self.assertEqual([(e.source, e.target, e.relationship) for e in graph.edges],
                         [("concept-19", "concept-18", "part_of"), ("concept-17", "concept-19", "related")])

    def test_model_label_casing_is_canonicalised(self):
        evaluation = parse_structured(VALID_EVALUATION.replace('"Needs Revision"', '"needs revision"'), Evaluation)
        self.assertEqual(evaluation.status, "Needs Revision")
        quiz = Quiz.model_validate({"topic": "Cells", "difficulty": "hard", "question": "Why?",
                                    "expected_answer": "Because.", "explanation": "A reason."})
        self.assertEqual(quiz.difficulty, "Hard")

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

    def test_explicit_practice_choice_overrides_weakest_topic(self):
        history = [{"topic": "Cells", "score": 30, "difficulty": "Medium", "confidence": "high"},
                   {"topic": "Atoms", "score": 90, "difficulty": "Medium", "confidence": "medium"}]
        self.assertEqual(choose_next_target(history, "Atoms")[0], "Cells")
        topic, difficulty, reason = choose_next_target(history, "Atoms", focus=True)
        self.assertEqual((topic, difficulty), ("Atoms", "Hard"))
        self.assertIn("topic you chose", reason)
        topic, difficulty, _ = choose_next_target(history, "Enzymes", focus=True)
        self.assertEqual((topic, difficulty), ("Enzymes", "Medium"))

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

    def test_topic_matching_uses_whole_words(self):
        statistics = [{"topic": "Deoxygenation", "average_score": 40.0, "attempts": 1},
                      {"topic": "The Calvin cycle", "average_score": 90.0, "attempts": 2}]
        self.assertEqual(_concept_performance("Oxygen", statistics)["status"], "unpracticed")
        self.assertEqual(_concept_performance("Calvin Cycle", statistics)["status"], "strong")

    def test_model_status_reports_local_readiness_without_inference(self):
        class Reply:
            def __init__(self, models): self.models = models
            def raise_for_status(self): pass
            def json(self): return {"models": self.models}
        replies = {"/api/tags": Reply([{"name": "qwen3:14b"}]), "/api/ps": Reply([])}
        with patch("backend.ollama_client.requests.get", side_effect=lambda url, timeout: replies[url[url.index("/api/"):]]):
            self.assertEqual(model_status(), {"ollama": True, "installed": True, "loaded": False})
        with patch("backend.ollama_client.requests.get", side_effect=requests.ConnectionError()):
            self.assertEqual(model_status(), {"ollama": False, "installed": False, "loaded": False})

    def test_concept_graph_samples_across_long_material(self):
        text = "START-TOPIC\n" + ("middle material " * 3000) + "\nEND-TOPIC"
        material = _graph_material(text, max_chunks=3)
        self.assertIn("START-TOPIC", material)
        self.assertIn("END-TOPIC", material)


def _attempt(topic, score, confidence="medium", difficulty="Medium", **extra):
    return {"topic": topic, "score": score, "confidence": confidence, "difficulty": difficulty, **extra}


class StudentModelTests(unittest.TestCase):
    def test_revision_queue_orders_every_signal(self):
        history = [
            _attempt("Reinforce", 95), _attempt("Uncertain", 92, "low"), _attempt("Revise", 70),
            _attempt("Weak", 40), _attempt("Risk", 50, "high"),
        ]
        queue = revision_queue(history, concepts=[{"label": "Fresh", "importance": .9}])
        self.assertEqual([item["topic"] for item in queue],
                         ["Risk", "Weak", "Revise", "Uncertain", "Fresh", "Reinforce"])
        self.assertEqual([item["signal"] for item in queue],
                         ["high_risk_misconception", "weak", "needs_revision", "uncertain_correct",
                          "unpracticed", "reinforcement"])
        # Priority labels reuse the Weak Areas rule, so the two views can never disagree.
        self.assertEqual([item["priority"] for item in queue], ["High", "High", "Low", "Low", "Low", "Low"])
        self.assertEqual(queue[0]["position"], 1)

    def test_high_risk_stays_open_until_a_later_strong_answer(self):
        open_risk = [_attempt("Cells", 95), _attempt("Cells", 40, "high"), _attempt("Cells", 70)]
        self.assertEqual(revision_queue(open_risk)[0]["signal"], "high_risk_misconception")
        corrected = open_risk + [_attempt("Cells", 95)]
        active = [{"topic": "Cells", "resolved": False}]
        item = revision_queue(corrected, active)[0]
        # Evidence of a later Strong answer drops it to its score signal; the active misconception stays visible.
        self.assertEqual((item["signal"], item["priority"]), ("needs_revision", "High"))
        self.assertIn("1 active misconception", item["reason"])

    def test_repeated_and_past_confident_mistakes_rank_after_low_scores(self):
        history = [_attempt("Repeat", 30), _attempt("Repeat", 40)] + [_attempt("Repeat", 100)] * 8
        history += [_attempt("Once", 50, "high")] + [_attempt("Once", 100)] * 6 + [_attempt("Low", 70)]
        signals = [(item["topic"], item["signal"]) for item in revision_queue(history)]
        self.assertEqual(signals, [("Low", "needs_revision"), ("Repeat", "repeated_incorrect"),
                                   ("Once", "high_confidence_incorrect")])

    def test_quick_revision_target_changes_as_answers_are_saved(self):
        concepts = [{"label": "Osmosis", "importance": .9}, {"label": "Diffusion", "importance": .5}]
        history = []
        self.assertEqual(choose_next_target(history, concepts=concepts)[0], "Osmosis")
        history.append(_attempt("Osmosis", 95))
        topic, difficulty, reason = choose_next_target(history, concepts=concepts[1:])
        self.assertEqual((topic, difficulty), ("Diffusion", "Medium"))
        self.assertIn("haven't practised", reason)
        history.append(_attempt("Diffusion", 30, "high"))
        topic, difficulty, reason = choose_next_target(history)
        self.assertEqual((topic, difficulty), ("Diffusion", "Easy"))
        self.assertIn("Highest priority", reason)

    def test_stored_difficulty_keeps_progressing(self):
        history = [_attempt("Cells", 95, difficulty="Hard"), _attempt("Atoms", 55, difficulty="Easy")]
        self.assertEqual(choose_next_target(history, "Cells", focus=True)[1], "Hard")
        self.assertEqual(choose_next_target(history)[:2], ("Atoms", "Easy"))

    def test_weak_scope_and_exam_avoidance(self):
        history = [_attempt("Strong", 95), _attempt("Shaky", 70)]
        concepts = [{"label": "New", "importance": 1}]
        self.assertEqual(choose_next_target(history, concepts=concepts, scope="weak")[0], "Shaky")
        self.assertEqual(choose_next_target(history, concepts=concepts, avoid=["Shaky"])[0], "New")
        topic, _, reason = choose_next_target(history, scope="all", avoid=["shaky", "STRONG"])
        self.assertIsNone(topic)
        self.assertIn("new part", reason)
        # With nothing below mastery, the weak scope falls back to the normal queue instead of failing.
        self.assertEqual(choose_next_target([_attempt("Strong", 95)], scope="weak")[0], "Strong")

    def test_focus_session_stays_on_chosen_topic(self):
        history = [_attempt("Cells", 20, "high"), _attempt("Atoms", 60)]
        for _ in range(3):
            topic, _, reason = choose_next_target(history, "Atoms", focus=True, scope="weak")
            self.assertEqual(topic, "Atoms")
            history.append(_attempt("Atoms", 90))
        self.assertIn("topic you chose", reason)

    def test_no_history_behaviour(self):
        self.assertEqual(revision_queue([]), [])
        self.assertEqual(choose_next_target([]),
                         (None, "Medium", "No previous attempts; begin with a balanced question."))
        concepts = [{"label": "Minor", "importance": .2}, {"label": "Major", "importance": .8}]
        self.assertEqual(choose_next_target([], concepts=concepts)[0], "Major")
        self.assertEqual(revision_queue([], concepts=concepts)[0]["reason"], "Important concept, not practised yet")

    def test_session_summary_calculations(self):
        attempts = [
            {"id": 1, "topic": "Cells", "question": "Q1", "score": 95, "confidence": "high",
             "confidence_insight": "Confident & Correct"},
            {"id": 2, "topic": "Cells", "question": "Q2", "score": 40, "confidence": "high",
             "confidence_insight": "High-Risk Misconception"},
            {"id": 3, "topic": "Atoms", "question": "Q3", "score": 90, "confidence": "low",
             "confidence_insight": "Correct but Uncertain"},
            {"id": 4, "topic": "Atoms", "question": "Q4", "score": 70, "confidence": "medium",
             "confidence_insight": "Medium confidence · Needs Revision"},
        ]
        found = [{"id": 7, "topic": "Cells", "misconception": "Confuses cells with atoms", "resolved": False}]
        summary = summarize_session(attempts, found)
        self.assertEqual(summary["questions_completed"], 4)
        self.assertEqual(summary["average_score"], 73.8)
        self.assertEqual(summary["status_counts"], {"Strong": 2, "Needs Revision": 1, "Weak": 1})
        self.assertEqual(summary["confidence_counts"], [
            {"label": "Confident & Correct", "count": 1}, {"label": "High-Risk Misconception", "count": 1},
            {"label": "Correct but Uncertain", "count": 1}, {"label": "Medium confidence", "count": 1}])
        self.assertEqual(summary["calibration"],
                         {"aligned": 2, "overconfident": 1, "underconfident": 1, "total": 4})
        self.assertEqual([(row["topic"], row["average_score"], row["status"]) for row in summary["topics"]],
                         [("Atoms", 80.0, "Needs Revision"), ("Cells", 67.5, "Needs Revision")])
        self.assertEqual((summary["strong_topics"], summary["weak_topics"]), ([], ["Atoms", "Cells"]))
        self.assertEqual(summary["misconceptions"][0]["misconception"], "Confuses cells with atoms")
        self.assertEqual(summarize_session([])["average_score"], None)

    def test_exam_results_use_saved_attempts_for_one_student(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = ProgressRepository(Path(directory) / "exam.db")
            repo.initialize()
            ids = []
            for student, score in (("friend01", 90), ("friend01", 50), ("other", 10)):
                ids.append(repo.add_attempt(
                    student_id=student, topic="Cells", question="Q", expected_answer="A",
                    student_answer="B", score=score, status=status_for_score(score), correct_points=[],
                    missing_points=[], feedback="F", difficulty="Hard")["id"])
            with patch("backend.main.repository", repo):
                result = session_summary(SessionSummaryRequest(student_id="friend01", attempt_ids=ids[:2]))
                self.assertEqual((result["questions_completed"], result["average_score"]), (2, 70.0))
                self.assertEqual(result["questions"][0]["difficulty"], "Hard")
                with self.assertRaises(HTTPException) as caught:
                    session_summary(SessionSummaryRequest(student_id="friend01", attempt_ids=ids))
            self.assertEqual(caught.exception.status_code, 404)

    def test_retried_evaluation_never_duplicates_an_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = ProgressRepository(Path(directory) / "dedupe.db")
            repo.initialize()
            request = AnswerEvaluationRequest(
                student_id="friend01", topic="Cells", question="Why?", expected_answer="Because",
                student_answer="Wrong idea", confidence="high", request_id="question-0001")
            evaluation = Evaluation.model_validate_json(VALID_EVALUATION.replace("74", "40"))
            with patch("backend.main.repository", repo), patch(
                "backend.main._structured", return_value=evaluation
            ) as model:
                first = evaluate_answer(request)
                second = evaluate_answer(request)
            self.assertEqual(model.call_count, 1)
            self.assertEqual(first["attempt_id"], second["attempt_id"])
            self.assertTrue(second["duplicate"])
            self.assertEqual(second["evaluation"]["confidence_insight"], "High-Risk Misconception")
            self.assertEqual(len(repo.history("friend01")), 1)
            with self.assertRaises(sqlite3.IntegrityError):
                repo.add_attempt(**request.model_dump(), score=40, status="Weak", correct_points=[],
                                 missing_points=[], feedback="F")

    def test_existing_databases_gain_new_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old.db"
            with closing(sqlite3.connect(path)) as connection, connection:
                connection.execute(
                    "CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, "
                    "topic TEXT NOT NULL, question TEXT NOT NULL, expected_answer TEXT NOT NULL, "
                    "student_answer TEXT NOT NULL, score INTEGER NOT NULL, status TEXT NOT NULL, "
                    "correct_points TEXT NOT NULL, missing_points TEXT NOT NULL, feedback TEXT NOT NULL, "
                    "created_at TEXT NOT NULL DEFAULT '2026-01-01')")
                connection.execute(
                    "INSERT INTO attempts (student_id, topic, question, expected_answer, student_answer, score, "
                    "status, correct_points, missing_points, feedback) "
                    "VALUES ('friend01', 'Cells', 'Q', 'A', 'B', 70, 'Needs Revision', '[]', '[]', 'F')")
            repo = ProgressRepository(path)
            repo.initialize()
            old = repo.history("friend01")[0]
            self.assertEqual((old["difficulty"], old["request_id"], old["confidence"]), ("Medium", None, "medium"))


if __name__ == "__main__":
    unittest.main()
