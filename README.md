# StudyShield

> **Your notes. Your AI. Your device.**

A private study coach that works out what you understand, what you misunderstand, and what you should revise next. It runs entirely on your own computer with the open-weight **Qwen3 14B** model.

*Built for the Hacktoberfest 2026 DEV Weekend Challenge: Build for a Friend.*

---

## The Friend I Built This For

My friend has a lot of lecture notes before exams. The hard part was never finding information; it's all in the notes. The hard part is knowing what they actually understand.

Before every exam, the same question comes up:

> **"What should I revise next?"**

Rereading everything takes too long. Guessing feels risky. And the topics they *feel* confident about are not always the ones they've actually got right.

StudyShield is my answer to that one question.

## The Problem

Notes tell you what to know. They don't tell you what *you* know.

A typical AI quiz generator doesn't fix this either. It takes a PDF and produces questions, but every session starts from zero. It doesn't remember that you got a topic wrong last week, that you were sure you were right, or that the topic you're struggling with depends on another one you never really learned.

What my friend needed wasn't more questions. It was something that keeps track of their understanding over time and decides what deserves their attention next.

## What StudyShield Does Differently

**StudyShield doesn't just generate questions. It builds and continuously updates a model of what the learner understands, misunderstands, and should study next.**

That model is built from six things:

- **Notes:** the topics and concepts in the student's own material.
- **Concept relationships:** which ideas depend on which (the *Concept Graph*).
- **Answers:** graded for meaning, not keywords.
- **Confidence:** how sure the student was before submitting.
- **Misconceptions:** specific wrong ideas, remembered with the answer that revealed them.
- **Weak areas:** topics below mastery, ranked by risk.

From that model, StudyShield answers "what should I revise next?" with a ranked list and a reason for every item. When the student starts revising, every new question is chosen *after* the previous answer has been saved.

## The Adaptive Loop

```text
   Study material (PDF, read locally)
              ↓
   Concept Graph (how the ideas connect)
              ↓
   Question (chosen for a reason, shown to the student)
              ↓
   Answer + confidence (Low / Medium / High)
              ↓
   Evaluation by Qwen3 14B, on this computer
              ↓
   Misconception and mastery update (SQLite)
              ↓
   Smart Revision Queue ("What should I study next?")
              ↓
   Next question  ──────────────►  back to Question
```

## A Real Example

This sequence comes from a test run on sample biology notes (not my friend's data). Every value below came from the running app.

1. **Question:** *"Explain the role of ATP in both the light-dependent reactions of photosynthesis and aerobic respiration…"*
2. The student answers that photosynthesis happens in the mitochondria and that plants only respire at night, and marks **High confidence**.
3. Qwen3 grades it **40/100**. Because the student was *sure*, StudyShield labels it a **High-Risk Misconception** and saves the specific mistakes, such as *"incorrectly claims photosynthesis occurs in mitochondria."*
4. ATP jumps to **#1** in the revision queue. The reason given is *"High-confidence misconception."*
5. The next question targets ATP again, one step easier (*Easy*), and says why: *"Highest priority: 1 high-confidence incorrect attempt(s); 40.0% topic average."*
6. This time the student answers correctly but marks **Low confidence**. The result is **100, Correct but Uncertain**: they knew more than they thought. That strong answer closes the high-risk flag, so ATP drops to *Needs Revision*. Its saved misconceptions stay visible until an answer shows the corrected idea.

Being wrong is one thing. **Being confidently wrong** is the mistake a student won't think to revise, so StudyShield treats it differently.

| Confidence | Result | What StudyShield concludes |
| --- | --- | --- |
| High | Correct (85+) | **Confident & Correct**: strong mastery; the next question gets harder |
| High | Wrong (under 60) | **High-Risk Misconception**: top revision priority |
| Low | Correct (85+) | **Correct but Uncertain**: light reinforcement instead of jumping ahead |
| Low | Wrong | **Needs Guided Practice** |

## Why Open-Source AI Matters Here

Every AI step in StudyShield runs on **Qwen3 14B**, an open-weight model, through **Ollama** on the student's own computer:

- reading the notes
- building the Concept Graph
- writing questions
- grading answers
- detecting misconceptions
- re-explaining ideas

There's no cloud AI anywhere in that list.

That choice shapes the product:

- **Private by design.** Notes, and more sensitively, a record of *every mistake a student makes*, never leave their computer. No closed AI provider sees them.
- **No per-question cost.** An adaptive loop makes many model calls per session. Locally, each one costs nothing, so StudyShield can grade every answer properly instead of rationing calls.
- **Works without cloud inference.** Once the model is downloaded, there is no API key, no account, no rate limit and no outage to wait on.
- **Replaceable and inspectable.** One setting (`OLLAMA_MODEL`) swaps the model. Every model response is validated against a strict schema, so a different model can't silently corrupt the learning history. The prompts and rules are all in this repository.

**The trade-off, honestly:** a 14B model on a laptop is slower than a cloud API. On my development laptop, with the model warm, a question, grade or explanation took about 7–34 seconds, and analysing a PDF took about 40–100 seconds. The app shows the real elapsed time while it works, never a fake progress bar.

## Features

- **Smart Revision Queue:** "What should I study next?", ranked from saved answers with a reason for each item and no AI call.
- **Concept Graph:** an interactive map of how ideas connect, coloured by the student's real scores, with *Practice This* and *Focus on this topic*.
- **Confidence-aware evaluation:** score, status, what landed, what's missing, and a confidence insight.
- **Misconception Memory:** specific wrong ideas, how often they recur, and whether they're resolved.
- **Quick Revision (Learn):** 3, 5 or 7 adaptive questions, each chosen after the previous answer is saved, ending in a **Session Summary** with the score, confidence breakdown, misconceptions found and *Revise Next*.
- **Explain It My Way:** *Simpler*, *Step-by-Step*, *Example* or *Analogy*, generated locally and only when asked.
- **Focus Sessions:** pick one concept and aim for Strong mastery in up to three questions.
- **Exam Mode (Test):** no scores or hints until the end, then a full results breakdown.
- **Progress and Weak Areas:** mastery, confidence calibration, recent attempts, and a *Fix My Weak Areas* plan.
- **Resume where you left off:** the last PDF, its analysis and the current session survive a restart, stored only on this device. *Forget* removes them.
- **Desktop app:** the same experience in a native Windows window (Tauri).

## Architecture

```text
┌──────────────────────────────┐
│  React + Vite UI             │  browser, or the Tauri v2 desktop window
└──────────────┬───────────────┘
               │ HTTP (localhost:8000)
┌──────────────▼───────────────┐
│  FastAPI                     │
│  ├─ adaptive.py              │  the student model: scoring, confidence, queue, targeting, summaries
│  ├─ model_utils.py           │  strict JSON validation + one repair attempt
│  ├─ database.py ─────────────┼──► SQLite: attempts, misconceptions, concept-graph cache
│  └─ ollama_client.py         │  the only AI boundary
└──────────────┬───────────────┘
               │ HTTP (localhost:11434)
┌──────────────▼───────────────┐
│  Ollama → Qwen3 14B          │  local inference, open weights
└──────────────────────────────┘
```

**The model handles language; Python owns the decisions.** Qwen3 reads, writes and judges meaning. Everything that shapes the learning record is deterministic, unit-tested code in [`backend/adaptive.py`](backend/adaptive.py):

- the score thresholds (`Strong ≥ 85`, `Needs Revision ≥ 60`)
- the confidence labels
- the revision-queue ranking
- difficulty changes
- when a misconception counts as resolved

So a local model having a bad day can't quietly corrupt anyone's progress.

Reliability details that matter on real hardware:

- Every model response is parsed as JSON and validated with Pydantic. It gets exactly one repair attempt; a second failure saves nothing.
- Harmless model slips are repaired safely rather than failing a whole feature. Examples: a concept-graph edge pointing at a concept that doesn't exist, or a status written as "needs revision".
- **Concept Graph density without invented links.** The model is told exactly which way each relationship reads, and to reconsider unconnected concepts before finishing. If more than 25% of concepts are still isolated, one bounded extra pass may propose links. Those links must join existing concepts, involve at least one isolated concept, use a valid relationship type, and must not repeat a pair. New concepts are never accepted, and if the pass fails, the original graph is kept.
- Every submission carries a request ID. A retried or reloaded submission can never create a duplicate attempt.
- Concept graphs are cached by document fingerprint. Topics are matched to concepts by whole words, so *Oxygen* never matches *Deoxygenation*.
- On startup, the app checks that Ollama is running and Qwen3 14B is installed, without running inference. Errors such as "Ollama not running", "model not installed", "timed out" and "unreadable PDF" each have a specific, actionable message.

### Privacy details

- Runtime traffic is `UI → FastAPI (localhost) → Ollama (localhost)`. The shipped code contains no analytics, telemetry, external fonts or third-party AI SDKs.
- The API processes PDF bytes in memory and keeps only derived progress, in SQLite at `backend/data/studyshield.db`.
- To resume after a restart, the app keeps the last PDF and the current session in its own local browser storage on the same device. **Forget** on the Study Material screen removes them.

## Screenshots

> Real screenshots from the running app. See [`docs/SCREENSHOT_CHECKLIST.md`](docs/SCREENSHOT_CHECKLIST.md).

<!-- SCREENSHOTS: e.g. ![High-Risk Misconception](docs/screenshots/05-high-risk.png) -->

## Running Locally

Requirements: Python 3.11+, Node.js 20+, [Ollama](https://ollama.com/), and Qwen3 14B (about 9 GB). Roughly 16 GB+ RAM, or a GPU with enough VRAM, is recommended.

```powershell
git clone <GITHUB_URL>
cd StudyShield
ollama pull qwen3:14b

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app          # API on http://localhost:8000

cd frontend                       # in a second terminal
npm install
npm run dev                       # app on http://localhost:5173
```

Start Ollama first (the Ollama app, or `ollama serve`).

Optional settings:

| Variable | Purpose |
| --- | --- |
| `OLLAMA_MODEL` | Model to use; defaults to `qwen3:14b` |
| `OLLAMA_URL` | Ollama endpoint; defaults to `http://localhost:11434/api/generate` |
| `OLLAMA_TIMEOUT_SECONDS` | How long to wait for a model response |
| `STUDYSHIELD_DB_PATH` | Location of the SQLite database |
| `STUDYSHIELD_CORS_ORIGINS` | Allowed browser origins. Keep `http://tauri.localhost` for the desktop app. |
| `VITE_API_URL` | API address, read when the frontend is built |

## Desktop Application

The same UI ships as a lightweight **Tauri v2** desktop app. Start Ollama and the API first; the desktop shell doesn't manage them. You'll need the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): on Windows, that means WebView2, the MSVC C++ build tools and stable Rust.

```powershell
cd frontend
npm run desktop:build
```

The build produces:

- `frontend/src-tauri/target/release/studyshield.exe`
- `frontend/src-tauri/target/release/bundle/msi/StudyShield_1.0.0_x64_en-US.msi`
- `frontend/src-tauri/target/release/bundle/nsis/StudyShield_1.0.0_x64-setup.exe`

The desktop window disables WebView2's HTTP cache. All assets are local anyway, and this guarantees a rebuilt app never shows a stale interface.

## Testing

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
cd frontend
npm run build
npm audit
```

**57 backend tests** run without Ollama, because the model boundary is mocked. They cover:

- the student model: queue ranking for every signal, in-session adaptation, focus and exam targeting, and session and exam summary maths
- confidence rules
- strict validation and safe repair of model output
- duplicate-submission protection
- SQLite persistence and schema migration
- misconception resolution
- concept-graph caching, plus sparse-graph enrichment (duplicate, self-link and invalid-type rejection; no invented concepts)
- whole-word topic matching
- local model readiness
- PDF validation and Ollama error handling

### API

<details>
<summary>All routes</summary>

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health`, `/model-status` | API health; local Ollama/model readiness (no inference) |
| `POST` | `/analyze-pdf`, `/concept-graph` | Material analysis; cached concept graph with score overlay |
| `POST` | `/adaptive-question`, `/generate-quiz` | Next question from the student model (`topic`, `focus`, `scope`, `avoid`); a plain question |
| `POST` | `/evaluate-answer` | Grade and save an attempt (idempotent with `request_id`) |
| `POST` | `/explain` | Explain It My Way (`simpler`, `steps`, `example`, `analogy`) |
| `POST` | `/revision-queue`, `/session-summary` | Smart Revision Queue; session or exam results (both deterministic) |
| `GET` | `/progress/{id}`, `/misconceptions/{id}` | History, statistics, Misconception Memory |
| `POST` | `/weak-areas`, `/fix-weak-areas`, `/resolve-misconception` | Weak-topic ranking and plan; evidence-based resolution |

</details>

## Built for Hacktoberfest 2026

Built for the **DEV Weekend Challenge: Build for a Friend**, for one real student and the one question they kept asking before exams. Their feedback will appear here only after they've used it with their own notes. Nothing here is invented.

## License

MIT. See [LICENSE](LICENSE).
