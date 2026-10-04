import json
import hashlib
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from pypdf.errors import PdfReadError

try:
    from .adaptive import (choose_next_target, confidence_insight, priority_for_score, revision_queue,
                           status_for_score, summarize_session)
    from .database import ProgressRepository
    from .model_utils import StructuredOutputError, ask_structured
    from .ollama_client import (MODEL, OllamaModelError, OllamaTimeoutError, OllamaUnavailableError, ask_model,
                                model_status)
    from .pdf_utils import MAX_PDF_BYTES, chunk_text, extract_text_from_bytes
    from .schemas import ConceptGraph, Evaluation, Explanation, PDFAnalysis, Quiz
except ImportError:
    from adaptive import (choose_next_target, confidence_insight, priority_for_score, revision_queue,
                          status_for_score, summarize_session)
    from database import ProgressRepository
    from model_utils import StructuredOutputError, ask_structured
    from ollama_client import (MODEL, OllamaModelError, OllamaTimeoutError, OllamaUnavailableError, ask_model,
                               model_status)
    from pdf_utils import MAX_PDF_BYTES, chunk_text, extract_text_from_bytes
    from schemas import ConceptGraph, Evaluation, Explanation, PDFAnalysis, Quiz


repository = ProgressRepository()
MAX_ANALYSIS_CHUNKS = 12
MAX_SESSION_QUESTIONS = 20
EXPLANATION_STYLES = {
    "simpler": "Explain it in simple, everyday language a younger student would follow. Short sentences.",
    "steps": "Explain it as 3 to 6 numbered steps, one idea per step, each on its own line.",
    "example": "Teach it through one concrete, worked example taken from or consistent with the material.",
    "analogy": ("Explain it with one intuitive analogy, then state plainly where the analogy stops "
                "matching the real science. Never sacrifice factual accuracy for the analogy."),
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    repository.initialize()
    yield


app = FastAPI(
    title="StudyShield API",
    description="Private, local, adaptive study coaching with Ollama and Qwen.",
    version="1.0.0",
    lifespan=lifespan,
)
# Packaged Tauri builds load the UI from tauri.localhost (Windows) or tauri://localhost (macOS/Linux).
origins = [origin.strip() for origin in os.getenv(
    "STUDYSHIELD_CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,"
    "http://tauri.localhost,https://tauri.localhost,tauri://localhost",
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)


class AnswerEvaluationRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=100)
    topic: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=10_000)
    expected_answer: str = Field(min_length=1, max_length=20_000)
    student_answer: str = Field(min_length=1, max_length=20_000)
    confidence: Literal["low", "medium", "high"] = "medium"
    difficulty: Literal["Easy", "Medium", "Hard"] = "Medium"
    # Client-generated per question; a retried submission with the same ID returns the saved attempt.
    request_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ExplainRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    question: str = Field(min_length=1, max_length=10_000)
    expected_answer: str = Field(min_length=1, max_length=20_000)
    student_answer: str = Field(min_length=1, max_length=20_000)
    style: Literal["simpler", "steps", "example", "analogy"]


class SessionSummaryRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=100)
    attempt_ids: list[int] = Field(min_length=1, max_length=MAX_SESSION_QUESTIONS)


class WeakAreaRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=100)


class ResolveMisconceptionRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=100)
    misconception_id: int = Field(gt=0)


class GeneratedWeakTopic(BaseModel):
    topic: str
    why_weak: str
    revision_plan: list[str]
    mini_explanation: str
    practice_question: str


class GeneratedWeakPlan(BaseModel):
    weak_topics: list[GeneratedWeakTopic]


def _model_call(prompt: str, json_mode: bool = False) -> str:
    try:
        return ask_model(prompt, json_mode=json_mode)
    except OllamaTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (OllamaModelError, OllamaUnavailableError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _structured(prompt: str, schema):
    try:
        return ask_structured(prompt, schema, lambda value: _model_call(value, json_mode=True))
    except StructuredOutputError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def _read_pdf(file: UploadFile) -> tuple[str, str]:
    filename = Path(file.filename or "upload.pdf").name
    content_type = (file.content_type or "").lower()
    if not filename.lower().endswith(".pdf") or content_type not in {
        "application/pdf", "application/octet-stream", "",
    }:
        raise HTTPException(status_code=415, detail="Only PDF files are supported.")
    contents = await file.read(MAX_PDF_BYTES + 1)
    if len(contents) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 20 MB upload limit.")
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if not contents.lstrip().startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The upload is not a valid PDF file.")
    try:
        text = extract_text_from_bytes(contents)
    except (PdfReadError, ValueError, OSError, EOFError) as exc:
        raise HTTPException(status_code=400, detail="The PDF is corrupted or unreadable.") from exc
    if not text.strip():
        raise HTTPException(status_code=422, detail="No readable text was found in this PDF.")
    return filename, text


def _analysis_prompt(material: str) -> str:
    return f'''You are StudyShield, a private local study coach. Analyze only the supplied
material. Return ONLY valid JSON with exactly this shape:
{{"title":"...","main_topics":[{{"topic":"...","important_concepts":["..."]}}],
"key_revision_points":["..."],"difficult_areas":[{{"concept":"...","reason":"..."}}]}}
Keep it concise, factual, and useful for revision.

STUDY MATERIAL:
{material}'''


def _concept_graph_prompt(material: str) -> str:
    return f'''You are StudyShield, a private local study coach. Build a compact concept graph
using ONLY concepts explicitly supported by the supplied study material. Include 4 to 12
meaningful concepts. IDs must be unique lowercase slugs. Importance is from 0 to 1.
Use prerequisite only when the source concept should be understood first; otherwise use
related, supports, or part_of. Do not invent outside knowledge. Return ONLY valid JSON:
{{"concepts":[{{"id":"concept-id","label":"Concept label","importance":0.8}}],
"edges":[{{"source":"concept-id","target":"other-id","relationship":"prerequisite|related|supports|part_of"}}]}}

STUDY MATERIAL:
{material}'''


FILLER_WORDS = {"the", "a", "an", "and", "of", "in", "to", "for", "on", "its"}


def _words(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.casefold()) if word not in FILLER_WORDS}


def _same_topic(concept: str, topic: str) -> bool:
    # Whole-word containment: "Calvin Cycle" matches "The Calvin cycle", but "Oxygen" never matches
    # "Deoxygenation" and "Ion" never matches "Respiration" (plain substring matching did).
    concept_words, topic_words = _words(concept), _words(topic)
    return bool(concept_words and topic_words) and (concept_words <= topic_words or topic_words <= concept_words)


def _concept_performance(label: str, statistics: list[dict]) -> dict:
    matches = [item for item in statistics if _same_topic(label, item["topic"])]
    if not matches:
        return {"average_score": None, "attempts": 0, "status": "unpracticed"}
    attempts = sum(item["attempts"] for item in matches)
    average = round(sum(item["average_score"] * item["attempts"] for item in matches) / attempts, 1)
    status = "strong" if average >= 85 else "needs_revision" if average >= 60 else "weak"
    return {"average_score": average, "attempts": attempts, "status": status}


def _specific_misconceptions(items: list[str]) -> list[str]:
    vague = ("does not understand", "needs more practice", "doesn't understand",
             "lacks understanding", "is confused")
    result = []
    for item in items:
        cleaned = " ".join(item.strip().split())
        if 4 <= len(cleaned.split()) <= 35 and not any(phrase in cleaned.casefold() for phrase in vague):
            result.append(cleaned)
    return result[:4]


def _quiz_prompt(material: str, topic: str | None = None, difficulty: str | None = None,
                 related: list[str] | None = None, avoid: list[str] | None = None) -> str:
    targeting = f"Test the topic '{topic}' at {difficulty or 'Medium'} difficulty." if topic else ""
    if topic and related:
        targeting += f" You may connect it to its prerequisite concepts: {', '.join(related)}."
    if not topic and avoid:
        targeting += f" Cover a different part of the material than: {', '.join(avoid)}."
    return f'''You are StudyShield, an adaptive local study coach. Using only the supplied
material, create one understanding-based, non-yes/no revision question. {targeting}
Return ONLY valid JSON:
{{"topic":"...","difficulty":"Easy|Medium|Hard","question":"...",
"expected_answer":"...","explanation":"..."}}

STUDY MATERIAL:
{material}'''


def _quiz_material(text: str, topic: str | None = None) -> str:
    chunks = chunk_text(text)
    if topic:
        topic_lower = topic.lower()
        matching = next((chunk for chunk in chunks if topic_lower in chunk.lower()), None)
        if matching:
            return matching
    return chunks[0]


def _unpracticed_concepts(graph: dict | None, statistics: list[dict]) -> list[dict]:
    if not graph:
        return []
    return [{"label": concept["label"], "importance": concept["importance"]}
            for concept in graph.get("concepts", [])
            if _concept_performance(concept["label"], statistics)["attempts"] == 0]


def _prerequisites(graph: dict | None, topic: str) -> list[str]:
    if not graph:
        return []
    by_id = {concept["id"]: concept["label"] for concept in graph.get("concepts", [])}
    target = next((concept["id"] for concept in graph.get("concepts", [])
                   if concept["label"].casefold() == topic.casefold()), None)
    return [by_id[edge["source"]] for edge in graph.get("edges", [])
            if edge["target"] == target and edge["relationship"] == "prerequisite" and edge["source"] in by_id][:3]


def _parse_avoid(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="avoid must be a JSON list of topics.") from exc
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise HTTPException(status_code=422, detail="avoid must be a JSON list of topics.")
    return [value.strip()[:200] for value in values if value.strip()][:MAX_SESSION_QUESTIONS]


def _material_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _graph_material(text: str, max_chunks: int = 3) -> str:
    chunks = chunk_text(text)
    if len(chunks) <= max_chunks:
        return "\n\n--- NEXT SOURCE CHUNK ---\n\n".join(chunks)
    last = len(chunks) - 1
    indexes = [round(index * last / (max_chunks - 1)) for index in range(max_chunks)]
    return "\n\n--- NEXT SOURCE CHUNK ---\n\n".join(chunks[index] for index in indexes)


def _analyze_chunks(text: str) -> PDFAnalysis:
    chunks = chunk_text(text)
    if len(chunks) > MAX_ANALYSIS_CHUNKS:
        last = len(chunks) - 1
        indexes = [round(index * last / (MAX_ANALYSIS_CHUNKS - 1))
                   for index in range(MAX_ANALYSIS_CHUNKS)]
        chunks = [chunks[index] for index in indexes]
    partials = [_structured(_analysis_prompt(chunk), PDFAnalysis) for chunk in chunks]
    if len(partials) == 1:
        return partials[0]
    summaries = json.dumps([item.model_dump() for item in partials], ensure_ascii=False)
    prompt = f'''Combine these chunk analyses into one concise document analysis.
Deduplicate overlapping topics and use only the supplied analyses. Return ONLY valid JSON:
{{"title":"...","main_topics":[{{"topic":"...","important_concepts":["..."]}}],
"key_revision_points":["..."],"difficult_areas":[{{"concept":"...","reason":"..."}}]}}
CHUNK ANALYSES:
{summaries}'''
    return _structured(prompt, PDFAnalysis)


@app.get("/health")
def health():
    return {"status": "ok", "service": "StudyShield API", "version": "1.0.0"}


@app.get("/model-status")
def get_model_status():
    """Startup readiness: is local Ollama up, is the model installed, is it already loaded (warm)?"""
    return {"model": MODEL, **model_status()}


@app.post("/ai")
def ai(request: PromptRequest):
    return {"response": _model_call(request.prompt)}


@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    filename, text = await _read_pdf(file)
    return {"filename": filename, "characters_extracted": len(text), "text": text}


@app.post("/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)):
    filename, text = await _read_pdf(file)
    # Model calls block, so keep them off the event loop; /health must stay responsive meanwhile.
    analysis = await run_in_threadpool(_analyze_chunks, text)
    return {"filename": filename, "characters_extracted": len(text), "model": MODEL,
            "analysis": analysis.model_dump()}


@app.post("/generate-quiz")
async def generate_quiz(file: UploadFile = File(...)):
    filename, text = await _read_pdf(file)
    quiz = await run_in_threadpool(_structured, _quiz_prompt(_quiz_material(text)), Quiz)
    return {"filename": filename, "model": MODEL, "quiz": quiz.model_dump()}


@app.post("/concept-graph")
async def concept_graph(student_id: str = Form(...), file: UploadFile = File(...)):
    filename, text = await _read_pdf(file)
    material_hash = _material_hash(text)
    try:
        cached_graph = repository.get_concept_graph(material_hash)
        statistics = repository.topic_statistics(student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="The concept graph could not be loaded.") from exc

    cached = cached_graph is not None
    if cached_graph is None:
        graph = await run_in_threadpool(_structured, _concept_graph_prompt(_graph_material(text)), ConceptGraph)
        cached_graph = graph.model_dump()
        try:
            repository.save_concept_graph(material_hash, cached_graph)
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail="The concept graph could not be saved.") from exc
    else:
        try:
            graph = ConceptGraph.model_validate(cached_graph)
        except ValueError as exc:
            raise HTTPException(status_code=500, detail="The cached concept graph is invalid.") from exc

    concepts = [
        {**concept.model_dump(), **_concept_performance(concept.label, statistics)}
        for concept in graph.concepts
    ]
    return {"student_id": student_id, "filename": filename, "model": MODEL,
            "cached": cached, "concepts": concepts,
            "edges": [edge.model_dump() for edge in graph.edges]}


def _evaluation_response(request: AnswerEvaluationRequest, attempt: dict, evaluation: dict,
                         recorded: list[dict], duplicate: bool = False) -> dict:
    return {"model": MODEL, "student_id": request.student_id, "topic": request.topic,
            "evaluation": {**evaluation, "confidence": attempt["confidence"],
                           "confidence_insight": attempt["confidence_insight"]},
            "attempt_id": attempt["id"], "misconceptions_recorded": recorded, "duplicate": duplicate}


def _replay_attempt(request: AnswerEvaluationRequest, attempt: dict) -> dict:
    evaluation = {key: attempt[key] for key in ("score", "status", "correct_points", "missing_points", "feedback")}
    recorded = repository.misconceptions_for_attempts(request.student_id, [attempt["id"]])
    return _evaluation_response(request, attempt, {**evaluation, "misconceptions": [],
                                                   "resolved_misconceptions": []}, recorded, duplicate=True)


@app.post("/evaluate-answer")
def evaluate_answer(request: AnswerEvaluationRequest):
    if request.request_id:
        try:
            existing = repository.attempt_by_request(request.student_id, request.request_id)
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
        if existing:
            return _replay_attempt(request, existing)
    prompt = f'''Evaluate the student answer semantically against the expected answer.
Give fair partial credit for correct ideas and ignore minor grammar mistakes. Award no credit
for factually wrong statements; if the answer contradicts the expected answer's core idea or
covers almost none of it, the score must be below 60. Return ONLY valid JSON:
{{"score":75,"status":"Needs Revision","correct_points":["..."],
"missing_points":["..."],"feedback":"...",
"misconceptions":["Student specifically confuses X with Y"],
"resolved_misconceptions":["A previously mistaken idea now answered correctly"]}}
Misconceptions must be specific, evidence-based misunderstandings visible in the answer.
Use an empty list instead of vague statements. Only list a resolved misconception when the
answer clearly demonstrates the corrected idea.
The status will be normalized by deterministic application rules.
QUESTION: {request.question}
EXPECTED ANSWER: {request.expected_answer}
STUDENT ANSWER: {request.student_answer}'''
    evaluation = _structured(prompt, Evaluation)
    evaluation.status = status_for_score(evaluation.score)
    insight = confidence_insight(request.confidence, evaluation.score, evaluation.status)
    try:
        try:
            attempt = repository.add_attempt(
                **request.model_dump(), score=evaluation.score, status=evaluation.status,
                correct_points=evaluation.correct_points, missing_points=evaluation.missing_points,
                feedback=evaluation.feedback, confidence_insight=insight,
            )
        except sqlite3.IntegrityError:
            # A concurrent retry with the same request_id won the insert; return that attempt.
            existing = repository.attempt_by_request(request.student_id, request.request_id or "")
            if existing is None:
                raise
            return _replay_attempt(request, existing)
        recorded = []
        if evaluation.score < 85:
            for misconception in _specific_misconceptions(evaluation.misconceptions):
                recorded.append(repository.record_misconception(
                    student_id=request.student_id, topic=request.topic,
                    misconception=misconception, evidence=request.student_answer[:500],
                    attempt_id=attempt["id"],
                ))
        if evaluation.score >= 85 and evaluation.resolved_misconceptions:
            resolved_keys = [repository._misconception_key(item)
                             for item in evaluation.resolved_misconceptions]
            for item in repository.misconceptions(request.student_id):
                if item["topic"] != request.topic or item["resolved"]:
                    continue
                existing_key = repository._misconception_key(item["misconception"])
                if any(repository._similarity(existing_key, key) >= 0.6 for key in resolved_keys):
                    repository.resolve_misconception(request.student_id, item["id"])
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be saved.") from exc
    return _evaluation_response(request, attempt, evaluation.model_dump(), recorded)


@app.post("/explain")
def explain(request: ExplainRequest):
    prompt = f'''You are StudyShield, a private local study coach. A student answered a revision
question. Explain the correct idea to them. {EXPLANATION_STYLES[request.style]}
Stay faithful to the expected answer; do not add facts it does not support. Address the
student's answer directly where it went wrong. Keep it under 180 words.
Return ONLY valid JSON: {{"explanation":"..."}}
TOPIC: {request.topic}
QUESTION: {request.question}
EXPECTED ANSWER: {request.expected_answer}
STUDENT ANSWER: {request.student_answer}'''
    result = _structured(prompt, Explanation)
    return {"model": MODEL, "style": request.style, "explanation": result.explanation}


@app.post("/revision-queue")
async def get_revision_queue(student_id: str = Form(...), file: UploadFile | None = File(default=None)):
    text = None
    if file is not None:
        _, text = await _read_pdf(file)
    try:
        history = repository.history(student_id)
        misconceptions = repository.misconceptions(student_id)
        statistics = repository.topic_statistics(student_id)
        graph = repository.get_concept_graph(_material_hash(text)) if text else None
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="The revision queue could not be loaded.") from exc
    queue = revision_queue(history, misconceptions, _unpracticed_concepts(graph, statistics))
    return {"student_id": student_id, "uses_concept_graph": graph is not None, "queue": queue[:8]}


@app.post("/session-summary")
def session_summary(request: SessionSummaryRequest):
    ids = sorted(set(request.attempt_ids))
    try:
        attempts = repository.attempts_by_ids(request.student_id, ids)
        misconceptions = repository.misconceptions_for_attempts(request.student_id, ids)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="The session summary could not be loaded.") from exc
    if len(attempts) != len(ids):
        raise HTTPException(status_code=404, detail="Some session attempts were not found for this student.")
    return {"student_id": request.student_id, **summarize_session(attempts, misconceptions)}


@app.get("/progress/{student_id}")
def get_progress(student_id: str):
    try:
        history = repository.history(student_id)
        statistics = repository.topic_statistics(student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    return {"student_id": student_id, "attempts": len(history),
            "topic_statistics": statistics, "history": history}


@app.get("/misconceptions/{student_id}")
def get_misconceptions(student_id: str):
    try:
        items = repository.misconceptions(student_id)
        risks = {item["topic"]: item["high_confidence_wrong"]
                 for item in repository.topic_statistics(student_id)}
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Misconceptions could not be loaded.") from exc
    enriched = [{**item, "high_confidence_wrong_count": risks.get(item["topic"], 0),
                 "confidence_risk": (not item["resolved"] and risks.get(item["topic"], 0) > 0)}
                for item in items]
    return {"student_id": student_id, "active": sum(not item["resolved"] for item in enriched),
            "misconceptions": enriched}


@app.post("/resolve-misconception")
def resolve_misconception(request: ResolveMisconceptionRequest):
    try:
        item = repository.resolve_misconception(request.student_id, request.misconception_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="The misconception could not be resolved.") from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Misconception not found for this student.")
    if not item["resolved"]:
        raise HTTPException(
            status_code=409,
            detail="A later Strong answer on this topic is required before resolution.",
        )
    return {"student_id": request.student_id, "misconception": item}


@app.post("/weak-areas")
def weak_areas(request: WeakAreaRequest):
    try:
        statistics = repository.topic_statistics(request.student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    if not statistics:
        raise HTTPException(status_code=404, detail="No study history found for this student.")
    weak = [item for item in statistics
            if item["average_score"] < 85 or item["high_confidence_wrong"]]
    return {"student_id": request.student_id,
            "attempts_analyzed": sum(item["attempts"] for item in statistics),
            "weak_topics": [{**item, "priority": ("High" if item["high_confidence_wrong"]
                                                    else priority_for_score(item["average_score"]))}
                            for item in weak]}


@app.post("/adaptive-question")
async def adaptive_question(student_id: str = Form(...), file: UploadFile = File(...),
                            topic: str | None = Form(default=None), focus: bool = Form(default=False),
                            scope: Literal["adaptive", "weak", "all"] = Form(default="adaptive"),
                            avoid: str | None = Form(default=None)):
    filename, text = await _read_pdf(file)
    avoided = _parse_avoid(avoid)
    try:
        history = repository.history(student_id)
        misconceptions = repository.misconceptions(student_id)
        statistics = repository.topic_statistics(student_id)
        graph = repository.get_concept_graph(_material_hash(text))
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    selected_topic, difficulty, reason = choose_next_target(
        history, topic, focus, misconceptions, _unpracticed_concepts(graph, statistics), scope, avoided)
    related = _prerequisites(graph, selected_topic) if focus and selected_topic else []
    prompt = _quiz_prompt(_quiz_material(text, selected_topic), selected_topic, difficulty, related, avoided)
    quiz = await run_in_threadpool(_structured, prompt, Quiz)
    quiz.difficulty = difficulty
    if selected_topic:
        quiz.topic = selected_topic
    return {"student_id": student_id, "filename": filename, "selection_reason": reason,
            "quiz": quiz.model_dump()}


@app.post("/fix-weak-areas")
def fix_weak_areas(request: WeakAreaRequest):
    try:
        history = repository.history(request.student_id)
        statistics = repository.topic_statistics(request.student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    weak_stats = [item for item in statistics
                  if item["average_score"] < 85 or item["high_confidence_wrong"]][:3]
    if not weak_stats:
        if not statistics:
            raise HTTPException(status_code=404, detail="No study history found for this student.")
        return {"student_id": request.student_id, "weak_topics": []}
    weak_names = {item["topic"] for item in weak_stats}
    relevant = [item for item in history if item["topic"] in weak_names]
    compact = [{key: item[key] for key in
                ("topic", "question", "student_answer", "score", "missing_points",
                 "confidence", "confidence_insight")}
               for item in relevant[-12:]]
    prompt = f'''Create a concise revision plan using only this attempt history.
Return ONLY JSON: {{"weak_topics":[{{"topic":"...","why_weak":"...",
"revision_plan":["..."],"mini_explanation":"...","practice_question":"..."}}]}}
Include exactly these topics: {', '.join(item['topic'] for item in weak_stats)}.
HISTORY: {json.dumps(compact, ensure_ascii=False)}'''
    generated = _structured(prompt, GeneratedWeakPlan)
    generated_by_topic = {item.topic: item for item in generated.weak_topics}
    result = []
    for stats in weak_stats:
        detail = generated_by_topic.get(stats["topic"])
        if detail is None:
            raise HTTPException(status_code=502, detail="The local model omitted a required weak topic.")
        result.append({"topic": stats["topic"], "average_score": stats["average_score"],
                       "attempts": stats["attempts"], "why_weak": detail.why_weak,
                       "priority": ("High" if stats["high_confidence_wrong"]
                                    else priority_for_score(stats["average_score"])),
                       "revision_plan": detail.revision_plan,
                       "mini_explanation": detail.mini_explanation,
                       "practice_question": detail.practice_question})
    return {"student_id": request.student_id, "weak_topics": result}
