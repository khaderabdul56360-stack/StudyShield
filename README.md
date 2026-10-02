# StudyShield

> Your notes. Your AI. Your device.

StudyShield is a private, offline-ready, adaptive AI study coach built for a real friend/classmate for the **Hacktoberfest 2026 Weekend Challenge — Build for a Friend**.

A student uploads their own study material. StudyShield analyzes it locally, asks understanding-based questions, evaluates answers, remembers progress, and focuses the next revision session on the topics that need it most.

No study material is sent to a closed cloud AI API. Runtime inference stays on the student's computer through [Ollama](https://ollama.com/) and the open-weight Qwen3 14B model.

## Why it exists

Generic revision tools tend to repeat the same material or require students to decide what to study next. StudyShield keeps a private history of actual answers and turns it into a simple feedback loop:

1. Upload class notes as a PDF.
2. Map the main topics, important concepts, and difficult areas.
3. Answer a question that tests understanding rather than recall.
4. Receive specific, encouraging feedback.
5. Revisit weak topics at an appropriate difficulty.

The adaptive decisions are deterministic and inspectable. Qwen handles language understanding and question generation; Python owns score thresholds, weak-topic ranking, difficulty changes, and progression.

## Product tour

- **Home** — upload study material, continue revising, and see a learning pulse built from your saved history.
- **Study Material** — view detected topics, key concepts, revision points, and difficult areas.
- **Revision Arena** — answer one focused question, rate your confidence, and get structured feedback with an optional explanation after submitting.
- **Concept Graph** — explore locally inferred prerequisites and see which concepts are strong, need revision, are weak, or are unpractised.
- **Progress** — average score, mastery, confidence calibration, topic performance, and recent attempts, all from SQLite.
- **Weak Areas** — ranked weak topics with a "Fix My Weak Areas" session plan.
- **Misconception Memory** — remember concrete misunderstandings, flag high-confidence risks, and launch targeted practice.
- **Confidence-aware learning** — combine low/medium/high self-assessment with deterministic risk, mastery, and reinforcement rules.
- **Responsive interface** — sidebar on desktop, icon rail on tablets, bottom navigation on phones; keyboard accessible and respects reduced-motion settings.
- **Local AI status** — shows the model, runtime, processing location, and zero cloud AI calls. The API connection is checked on load; the model itself is confirmed by the first AI request.

## Architecture

```text
React + Vite
      |
      v
   FastAPI
      |
      +-------------------+
      |                   |
      v                   v
Adaptive study engine   SQLite
      |
      v
    Ollama
      |
      v
 Qwen3 14B
```

## Reliability and privacy

- PDF bytes are processed in memory and discarded after each request.
- Uploads are limited to 20 MB and checked for extension, MIME type, and PDF signature.
- Long documents are chunked, analyzed independently, and merged instead of being blindly truncated.
- Model output is parsed as JSON and validated by Pydantic.
- Invalid model output receives one repair attempt; a second failure returns HTTP 502 and is never stored.
- Answer status is recalculated in code: `Strong >= 85`, `Needs Revision >= 60`, otherwise `Weak`.
- Progress is stored in a local SQLite database and survives API restarts.
- Concept graphs are validated, cached locally by material hash, and overlaid with per-student SQLite progress.
- Specific misconceptions are merged and stored locally; resolution requires evidence from a later Strong attempt.
- Browser access is limited to configured local origins by default.
- Ollama connection failures, missing models, timeouts, corrupt PDFs, and database errors return useful HTTP status codes without exposing local paths.

## Requirements

- Python 3.11+
- Node.js 20+
- Ollama
- Qwen3 14B (`qwen3:14b`)

The default model is designed for a machine with sufficient local RAM/VRAM. StudyShield itself does not depend on any secondary development machine.

## Local setup

### 1. Start Ollama

```powershell
ollama pull qwen3:14b
ollama serve
```

### 2. Start the API

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

The API runs at `http://localhost:8000`; interactive documentation is at `http://localhost:8000/docs`.

Optional environment settings:

```powershell
$env:OLLAMA_MODEL = "qwen3:14b"
$env:OLLAMA_URL = "http://localhost:11434/api/generate"
$env:OLLAMA_TIMEOUT_SECONDS = "180"
$env:STUDYSHIELD_DB_PATH = "C:\path\to\studyshield.db"
$env:STUDYSHIELD_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost,tauri://localhost"
```

`STUDYSHIELD_CORS_ORIGINS` replaces the default list. Keep the `tauri.localhost` entries if you use the packaged desktop app.

### 3. Start the web app

```powershell
cd frontend
npm install
npm run dev
```

Vite normally runs at `http://localhost:5173` and prints the exact local browser URL. Set `VITE_API_URL` if the backend is not at `http://localhost:8000`.

## Desktop app (Tauri)

StudyShield also includes a lightweight Tauri v2 desktop shell. The React interface runs inside the native window while FastAPI, SQLite, Ollama, and Qwen remain unchanged. For stability and transparency, the desktop shell does not silently manage Python or Ollama processes.

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) once. On Windows this means WebView2, the MSVC C++ build tools, and the stable Rust toolchain.

Start Ollama and FastAPI in separate terminals as described above, then launch the desktop app:

```powershell
cd frontend
npm install
npm run desktop:dev
```

Create a desktop build with:

```powershell
cd frontend
npm run desktop:build
```

The frontend expects the API at `http://localhost:8000` by default. Start the API and Ollama before opening a packaged build. `VITE_API_URL` can override the API address at frontend build time.

Packaged builds load the interface from `http://tauri.localhost` (Windows) or `tauri://localhost` (macOS/Linux). Both origins are in the API's default CORS list.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health |
| `POST` | `/ai` | Low-level local model prompt (development) |
| `POST` | `/upload-pdf` | Validate and extract PDF text |
| `POST` | `/analyze-pdf` | Chunked, structured study-material analysis |
| `POST` | `/generate-quiz` | Generate one validated revision question |
| `POST` | `/concept-graph` | Generate or load a validated, progress-aware concept graph |
| `POST` | `/evaluate-answer` | Evaluate and persist an attempt |
| `GET` | `/progress/{student_id}` | History and deterministic topic statistics |
| `GET` | `/misconceptions/{student_id}` | Persistent recurring misconceptions and resolution state |
| `POST` | `/resolve-misconception` | Resolve only after a later Strong attempt provides evidence |
| `POST` | `/weak-areas` | Ranked topic averages and priorities |
| `POST` | `/adaptive-question` | Generate the next history-aware question |
| `POST` | `/fix-weak-areas` | Build a focused weak-topic recovery plan |

`/adaptive-question` accepts multipart fields `student_id`, `file`, and optional `topic`.
`/concept-graph` accepts multipart fields `student_id` and `file`. Other PDF routes accept a multipart `file`.

## Tests

The automated suite is intentionally independent of Ollama:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

It covers health, default CORS origins (browser and packaged desktop), invalid PDF handling, SQLite persistence across repository recreation, Pydantic evaluation validation, single repair behavior, safe double-failure behavior, and adaptive score/difficulty boundaries.

Build the frontend with:

```powershell
cd frontend
npm run build
```

## Project structure

```text
StudyShield/
├── backend/
│   ├── adaptive.py       # deterministic progression rules
│   ├── database.py       # local SQLite repository
│   ├── main.py           # FastAPI routes and orchestration
│   ├── model_utils.py    # structured JSON validation + repair
│   ├── ollama_client.py  # local Ollama boundary
│   ├── pdf_utils.py      # extraction and safe chunking
│   └── schemas.py        # Pydantic response contracts
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # app shell, navigation, and API actions
│   │   ├── components/   # shared UI primitives and the SVG concept graph
│   │   ├── screens/      # one file per screen
│   │   ├── lib/          # metrics derived from saved progress
│   │   └── styles.css    # design tokens and styles
│   └── src-tauri/        # Tauri v2 desktop shell and app metadata
├── tests/
├── requirements.txt
└── README.md
```

## Open innovation

Open-source AI is not decorative here—it is what makes the privacy promise possible. A student can inspect the code, choose where progress is stored, run inference without uploading notes, and keep studying without a cloud AI account. That combination makes adaptive study support personal without making private learning data somebody else's dataset.

## Demo checklist

### Submission asset status

- Screenshots: **not yet added** — capture the verified app with real, non-sensitive material.
- Demo video: **not yet recorded**.
- Friend feedback: **not yet collected** — add only genuine feedback from the intended user.

For an honest, reproducible demo:

1. Show Ollama running with `qwen3:14b`.
2. Upload a real, non-sensitive class PDF.
3. Point out the structured material map.
4. Answer one question incompletely and show the saved weak status.
5. Restart FastAPI, reopen the weakness map, and show that progress remains.
6. Generate the next adaptive question and a focused weak-area plan.

Screenshots and real user feedback should be added only after running the completed product with the intended friend. This repository does not fabricate either.

## License

MIT — see [LICENSE](LICENSE).
