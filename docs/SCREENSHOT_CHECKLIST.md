# StudyShield Screenshot Checklist

Each screenshot must **prove** something, using **real application data**: no mocks, no edited numbers, no values typed into the database.

Save PNGs in `docs/screenshots/` with the file names below, then link them in the README's **Screenshots** section.

## Setup

- [ ] Fresh demo database and real, non-sensitive notes
- [ ] 1440×900 (or 1280×800) window at 100% zoom; the **Connected** pill is green
- [ ] A neutral student ID; no test IDs (`accept-test`, `judge-test`) and no personal data visible
- [ ] Complete one real Quick Revision first (3+ questions)

## Shots, in priority order

| # | File | Proves | Must show |
| --- | --- | --- | --- |
| 1 | `01-home.png` | It's local, open-weight AI | Hero + Local AI card: **Qwen3 14B · Ollama · Local · Cloud AI calls 0**, and the "what the model does here" list |
| 2 | `02-concept-graph.png` | It understands the material's structure | Populated graph with mixed status colours and a selected node's prerequisites |
| 3 | `03-revision-queue.png` | It decides what to study, and why | "What should I study next?" with priorities and reasons |
| 4 | `04-quick-revision.png` | Questions are chosen, not random | "Quick Revision · Question 2 of 3" and the adaptive reason line |
| 5 | `05-high-risk.png` | Confidence matters | A **genuine** wrong answer given with High confidence → **High-Risk Misconception** |
| 6 | `06-explain-my-way.png` | Help adapts to the learner | Analogy (or Simpler) output + "Explained locally by Qwen3 14B" |
| 7 | `07-session-summary.png` | It closes the loop | Average, Strong / Needs Revision / Weak, confidence summary, misconception found, Revise Next |
| 8 | `08-progress.png` | It's a persistent learning profile | Mastery and confidence calibration |
| 9 | `09-misconceptions.png` | It remembers specific mistakes | A misconception card with its evidence, still there after navigating away |
| 10 | `10-desktop.png` | It ships as a real app | The Tauri window titled "StudyShield" |

## Rules

- [ ] If a high-risk mistake or misconception didn't happen naturally, answer honestly wrong yourself, but never fabricate data.
- [ ] All shots come from the same demo database.
- [ ] Optional: a narrow (~400 px) **browser** window, labelled as responsive web, **not** a mobile app.
