# StudyShield Demo Checklist

Goal: prove the core idea in **about 3 minutes**: StudyShield models what the learner understands and decides what they should revise next. Don't demo every feature.

## Before recording

- [ ] **Fresh demo database**, so no test data appears:
  ```powershell
  $env:STUDYSHIELD_DB_PATH = "$PWD\backend\data\demo.db"
  uvicorn backend.main:app
  ```
- [ ] Ollama running. The Home badge should read **Ready**; it reads **Ready · warm** once the model is loaded.
- [ ] **Warm the model:** answer one throwaway question under a different student ID, then switch back.
- [ ] Use real, non-sensitive notes as a text-based PDF (1–5 pages).
- [ ] **Prepare, don't fake:**
  - Upload and **Analyze** the PDF before recording. It resumes after a restart ("Resumed from this device"), so you never wait for analysis on camera.
  - Build the **Concept Graph** once; it's cached and loads instantly.
  - Answer 1–2 genuine questions so the queue has real signals to rank.
- [ ] Close notifications. Use a 1440×900 or 1280×800 window.

### About wait times

Measured on the development laptop with the model warm: about **7–34 s** per question, grade or explanation. Cut the waits in editing with a small caption such as **"⏩ sped up: local AI on a laptop"**. Keep about one second of *"Thinking locally with Qwen3 14B · 18s"* on screen, because it *proves* the inference is local.

## Script

| Time | Show | Do | Say (suggested) |
| --- | --- | --- | --- |
| 0:00–0:15 | Home hero | — | "My friend has plenty of notes, but before an exam the hard question is: *what do I actually need to revise?*" |
| 0:15–0:30 | Home → Local AI card | Point at **Qwen3 14B · Ollama · Local · Cloud AI calls 0** and the list of what the model does | "Everything runs on this laptop, with an open-weight model. No cloud AI." |
| 0:30–0:45 | Study Material | Show the already-analysed notes and difficult areas | "It reads the notes locally." |
| 0:45–1:00 | Concept Graph | Click one node; show its prerequisites | "StudyShield maps how the ideas connect." |
| 1:00–1:15 | Home → **What should I study next?** | Point at item #1 and its reason | "It doesn't pick a random question. It decides what needs attention, and says why." |
| 1:15–1:40 | Revision Arena | **Start Quick Revision** (3 questions). Point at "Question 1 of 3" and the adaptive reason. Type a **deliberately wrong** answer, choose **High** confidence, submit | "I'll answer like a student who's sure, but wrong." |
| 1:40–1:55 | Evaluation | **High-Risk Misconception** | "Being wrong is one thing. Being *confidently* wrong is more important, because you'd never think to revise it." **← key moment; slow down here.** |
| 1:55–2:10 | Explain It My Way | **Analogy** | "It re-explains the idea the way I ask, locally." |
| 2:10–2:25 | Next question | Point at the reason: *"Highest priority: 1 high-confidence incorrect attempt"* | "The next question goes straight back to my mistake, a little easier." |
| 2:25–2:40 | Session Summary | Average, confidence summary, misconception found, **Revise Next** | "It tells me what I misunderstood and what to revise next." |
| 2:40–2:52 | Progress or Weak Areas | Calibration and mastery | "And it all builds into a learning profile on my own device." |
| 2:52–3:00 | Home hero | — | "Your notes. Your AI. Your device." |

## Must be visible at least once

- [ ] Qwen3 14B + Ollama + Cloud AI calls: 0
- [ ] The real elapsed-time "Thinking locally" indicator
- [ ] A queue reason, and a question's adaptive reason
- [ ] **High** confidence selected, then **High-Risk Misconception**
- [ ] A next question that targets the same weakness
- [ ] Session Summary with the misconception that was found

## Don't

- Don't script or paraphrase your friend. If they appear or are quoted, use only their real words, with permission.
- Don't show or claim mobile/Android support.
- Don't edit the database or mock any response.
- Don't run a full exam or analysis on camera.
