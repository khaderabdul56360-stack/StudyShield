---
title: "StudyShield: I built my friend a study coach that knows what they misunderstand, and it runs on their own laptop"
published: false
tags: hacktoberfest, opensource, ai, ollama
---

<!--
DRAFT. Before publishing:
- Replace every [[PLACEHOLDER]].
- Check the official challenge rules for required sections and the exact prize-category names.
- "What My Friend Thought" must contain only their real words, with permission. Delete the section if there are none.
- "What I Learned" is drafted from things that genuinely happened during the build. Rewrite it in your own voice.
-->

*This is a submission for the Hacktoberfest 2026 Weekend Challenge: Build for a Friend.*

## What I Built

My friend has a lot of lecture notes before exams. The hard part was never finding information; it's all in the notes. The hard part is knowing what they actually understand. Before every exam, it comes down to one question: **"What should I revise next?"**

So I built **StudyShield**, a private study coach that answers that question. It runs entirely on their own laptop, using the open-weight **Qwen3 14B** model through **Ollama**.

StudyShield doesn't just generate questions. **It builds and continuously updates a model of what the learner understands, misunderstands, and should study next.** It does this from their notes, their answers, how confident they were, the specific mistakes they make, and how the ideas in their notes connect.

## The Moment That Defines StudyShield

Here's the moment I designed the whole app around.

A question asks about the role of ATP in photosynthesis and respiration. The student writes that photosynthesis happens in the mitochondria, and before submitting, says they're **highly confident**.

The answer scores 40/100. A normal quiz app would show "40%" and move on.

StudyShield sees something more important: **the student was sure, and they were wrong.** That's a *High-Risk Misconception*, the kind of mistake you never think to revise, because you don't know you've made it. So StudyShield:

- saves the specific mistake, *"incorrectly claims photosynthesis occurs in mitochondria"*
- moves ATP to **#1** on the "What should I study next?" list
- makes the next question about ATP again, one step easier, and says why: *"Highest priority: 1 high-confidence incorrect attempt."*

When the student later gets ATP right, but says they're *unsure*, StudyShield notices that too: **Correct but Uncertain.** They knew more than they thought.

Being wrong is one thing. Being *confidently* wrong is what matters most before an exam.

*(The example above is from a test run on sample biology notes.)*

## How StudyShield Learns

Every answer goes around the same loop:

```text
Notes → Concept Graph → Question → Answer + Confidence → Local evaluation
      → Misconception / mastery update → Revision queue → Next question
```

In plain terms:

1. **It reads the notes** and maps how the concepts depend on each other. If you're stuck on a topic, a shaky prerequisite underneath it shows up on the **Concept Graph**.
2. **It asks one question at a time, for a reason.** Every question shows why it was chosen.
3. **It grades meaning, not keywords**, and asks how confident you were.
4. **It remembers specific misunderstandings**, not just scores, and only marks one resolved when a later answer proves it.
5. **It keeps a ranked revision list**: confident mistakes first, then weak topics, then topics below mastery, then important concepts you haven't tried yet.

A **Quick Revision** session is five turns of that loop, and question 2 is chosen *after* question 1 has been graded and saved. It ends with a **Session Summary**: your score, how well your confidence matched reality, the misconceptions found, and the top three things to revise next.

A few supporting tools sit around the loop:

- **Explain It My Way** re-explains an idea as *Simpler*, *Step-by-Step*, an *Example* or an *Analogy*.
- **Focus Sessions** aim one concept at Strong mastery.
- **Exam Mode** holds back all feedback until the end, so there's a *Learn* mode and a *Test* mode on the same student model.

## Why Local Open-Source AI Matters

Every AI step in StudyShield runs on **Qwen3 14B**, locally, through **Ollama**:

- reading notes
- building the concept graph
- writing questions
- grading answers
- spotting misconceptions
- re-explaining ideas

There is no closed AI API anywhere in the app. The home screen shows it plainly: *Qwen3 14B · Ollama · Local · Cloud AI calls: 0*.

That isn't decoration; it changes what the product can be:

- **Private study data stays private.** A study coach builds a detailed record of every mistake a person makes. With a local open-weight model, that record never leaves their laptop.
- **No per-question cost.** A learning loop makes many model calls, because every answer gets graded properly. Locally, each one is free, so the app never has to ration.
- **It works without cloud inference.** No API key, no account, no rate limit, no outage.
- **It's replaceable and inspectable.** One setting swaps the model, and strict schema validation keeps the learning history safe when you do. Every prompt and rule is in the repository.

**The honest trade-off is speed.** On my laptop, with the model warm, a question, grade or explanation takes about 7–34 seconds, and analysing a PDF takes around a minute. So StudyShield generates one question at a time and shows the real elapsed time while it thinks, instead of a fake progress bar.

## Technical Build

**Stack:** React + Vite · FastAPI · SQLite · Ollama + Qwen3 14B · Tauri v2 (Windows desktop app)

The key design decision was **what the language model should *not* decide.** Qwen3 handles language: reading, writing, judging meaning. Everything that shapes the learning record is plain, deterministic Python with unit tests:

- score thresholds
- the confidence labels
- the revision-queue ranking
- difficulty changes
- when a misconception counts as resolved

A local model having a bad day can't quietly corrupt anyone's progress.

Making a local model dependable took a few layers:

- **Strict, validated output.** Every model response must be valid JSON matching a Pydantic schema. It gets one repair attempt, and if it still fails, nothing is saved.
- **Safe repair of harmless slips.** A concept-graph edge pointing at a concept that doesn't exist is dropped, rather than throwing away the whole graph.
- **Idempotent answers.** Every submission carries a request ID, so retrying, or even reloading the page while an answer is being graded, can never record it twice.
- **Resume anywhere.** The last PDF, its analysis and the current session survive a restart, stored only on the device.
- **Honest readiness.** On launch, the app checks that Ollama is running and Qwen3 14B is installed, without running inference, and shows a specific fix for every failure it can detect.
- **57 backend tests** cover the student model, validation, persistence and duplicate protection. They run without Ollama by mocking the model boundary.

## What My Friend Thought

> [[REAL FRIEND QUOTE: their exact words, with permission. If there's no feedback, delete this section.]]

[[Optional: one or two sentences, in your own words, on what you changed after watching them use it.]]

## Demo

▶️ [[DEMO URL]]

[[SCREENSHOTS: Home with local AI status · Concept Graph · "What should I study next?" queue · High-Risk Misconception result · Session Summary]]

## Code

🔗 [[GITHUB URL]] (MIT licensed)

## What I Learned

[[Rewrite in your own voice. These notes are drawn from things that actually happened during the build:]]

- A local model can be a generous grader. Early on, an answer with two factual errors scored 75. One clear sentence in the grading instructions fixed it, and that sentence is what makes the "confidently wrong" moment work at all.
- My own first ranking rule kept a topic flagged as "high risk" even after the student had answered it correctly. The fix was to use the same evidence rule the app already used for resolving misconceptions: a later strong answer.
- Local inference speed changed the design for the better. Generating one question at a time, after each answer, is both faster to start and genuinely adaptive.

## My Agent Session

[[AGENT SESSION / DevRelay link, if available and required.]]

To be clear about the boundary: I used an AI coding agent while *building* StudyShield. At *runtime*, the app makes no calls to any closed AI API. Its only network traffic is between the UI, FastAPI and Ollama, all on `localhost`.

## Prize Categories

[[List only categories that genuinely apply after checking the official rules. Don't add partner technology just to qualify.]]
