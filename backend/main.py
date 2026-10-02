import json
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf.errors import PdfReadError

try:
    from .adaptive import choose_next_target, priority_for_score, status_for_score
    from .database import ProgressRepository
    from .model_utils import StructuredOutputError, ask_structured
    from .ollama_client import MODEL, OllamaModelError, OllamaTimeoutError, OllamaUnavailableError, ask_model
    from .pdf_utils import MAX_PDF_BYTES, chunk_text, extract_text_from_bytes
    from .schemas import Evaluation, PDFAnalysis, Quiz
except ImportError:
    from adaptive import choose_next_target, priority_for_score, status_for_score
    from database import ProgressRepository
    from model_utils import StructuredOutputError, ask_structured
    from ollama_client import MODEL, OllamaModelError, OllamaTimeoutError, OllamaUnavailableError, ask_model
    from pdf_utils import MAX_PDF_BYTES, chunk_text, extract_text_from_bytes
    from schemas import Evaluation, PDFAnalysis, Quiz


repository = ProgressRepository()
MAX_ANALYSIS_CHUNKS = 12


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
origins = [origin.strip() for origin in os.getenv(
    "STUDYSHIELD_CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
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


class WeakAreaRequest(BaseModel):
    student_id: str = Field(min_length=1, max_length=100)


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


def _quiz_prompt(material: str, topic: str | None = None, difficulty: str | None = None) -> str:
    targeting = f"Test the topic '{topic}' at {difficulty or 'Medium'} difficulty." if topic else ""
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
    analysis = _analyze_chunks(text)
    return {"filename": filename, "characters_extracted": len(text), "model": MODEL,
            "analysis": analysis.model_dump()}


@app.post("/generate-quiz")
async def generate_quiz(file: UploadFile = File(...)):
    filename, text = await _read_pdf(file)
    quiz = _structured(_quiz_prompt(_quiz_material(text)), Quiz)
    return {"filename": filename, "model": MODEL, "quiz": quiz.model_dump()}


@app.post("/evaluate-answer")
def evaluate_answer(request: AnswerEvaluationRequest):
    prompt = f'''Evaluate the student answer semantically against the expected answer.
Give fair partial credit and ignore minor grammar mistakes. Return ONLY valid JSON:
{{"score":75,"status":"Needs Revision","correct_points":["..."],
"missing_points":["..."],"feedback":"..."}}
The status will be normalized by deterministic application rules.
QUESTION: {request.question}
EXPECTED ANSWER: {request.expected_answer}
STUDENT ANSWER: {request.student_answer}'''
    evaluation = _structured(prompt, Evaluation)
    evaluation.status = status_for_score(evaluation.score)
    try:
        attempt = repository.add_attempt(**request.model_dump(), **evaluation.model_dump())
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be saved.") from exc
    return {"model": MODEL, "student_id": request.student_id, "topic": request.topic,
            "evaluation": evaluation.model_dump(), "attempt_id": attempt["id"]}


@app.get("/progress/{student_id}")
def get_progress(student_id: str):
    try:
        history = repository.history(student_id)
        statistics = repository.topic_statistics(student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    return {"student_id": student_id, "attempts": len(history),
            "topic_statistics": statistics, "history": history}


@app.post("/weak-areas")
def weak_areas(request: WeakAreaRequest):
    try:
        statistics = repository.topic_statistics(request.student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    if not statistics:
        raise HTTPException(status_code=404, detail="No study history found for this student.")
    weak = [item for item in statistics if item["average_score"] < 85]
    return {"student_id": request.student_id,
            "attempts_analyzed": sum(item["attempts"] for item in statistics),
            "weak_topics": [{**item, "priority": priority_for_score(item["average_score"])}
                            for item in weak]}


@app.post("/adaptive-question")
async def adaptive_question(student_id: str = Form(...), file: UploadFile = File(...),
                            topic: str | None = Form(default=None)):
    filename, text = await _read_pdf(file)
    try:
        history = repository.history(student_id)
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Progress could not be loaded.") from exc
    selected_topic, difficulty, reason = choose_next_target(history, topic)
    quiz = _structured(_quiz_prompt(_quiz_material(text, selected_topic), selected_topic, difficulty), Quiz)
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
    weak_stats = [item for item in statistics if item["average_score"] < 85][:3]
    if not weak_stats:
        if not statistics:
            raise HTTPException(status_code=404, detail="No study history found for this student.")
        return {"student_id": request.student_id, "weak_topics": []}
    weak_names = {item["topic"] for item in weak_stats}
    relevant = [item for item in history if item["topic"] in weak_names]
    compact = [{key: item[key] for key in
                ("topic", "question", "student_answer", "score", "missing_points")}
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
                       "priority": priority_for_score(stats["average_score"]),
                       "revision_plan": detail.revision_plan,
                       "mini_explanation": detail.mini_explanation,
                       "practice_question": detail.practice_question})
    return {"student_id": request.student_id, "weak_topics": result}
