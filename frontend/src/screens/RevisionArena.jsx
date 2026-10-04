import { useEffect, useState } from 'react'
import {
  ArrowRight, BookOpen, Check, CircleHelp, ClipboardCheck, Compass, Cpu, Crosshair, Footprints, GraduationCap,
  Lightbulb, ListChecks, Repeat2, Sparkles, Target, Trophy, Upload, Zap,
} from 'lucide-react'
import { Badge, Empty, Meter, PickFile, ScoreRing, SectionHead, Skeleton } from '../components/ui'
import SessionLauncher from '../components/SessionLauncher'
import { confidenceLabel, statusFor } from '../lib/metrics'
import SessionSummary from './SessionSummary'

const LEVELS = [
  { id: 'low', label: 'Low', hint: 'Guessing' },
  { id: 'medium', label: 'Medium', hint: 'Fairly sure' },
  { id: 'high', label: 'High', hint: 'Certain' },
]

const STATUS_TONE = { Strong: 'success', 'Needs Revision': 'warning', Weak: 'danger' }
const SCORE_TONE = { strong: 'success', needs_revision: 'warning', weak: 'danger' }
const DIFFICULTY_TONE = { Easy: 'success', Medium: 'cyan', Hard: 'violet' }
const MODES = {
  quick: { label: 'Quick Revision', icon: GraduationCap, tone: 'cyan' },
  focus: { label: 'Focus Session', icon: Crosshair, tone: 'violet' },
  exam: { label: 'Exam Mode', icon: ClipboardCheck, tone: 'violet' },
}
const STYLES = [
  ['simpler', 'Simpler', Sparkles], ['steps', 'Step-by-Step', ListChecks],
  ['example', 'Example', Footprints], ['analogy', 'Analogy', Repeat2],
]

// Plain-language reading of the deterministic confidence_insight label from the backend.
const INSIGHT_COPY = {
  'Confident & Correct': 'Your confidence matched your understanding. Locked in.',
  'High-Risk Misconception': 'You felt sure but the core idea was off — this is the most important kind of mistake to fix.',
  'Confident but Incomplete': 'You were sure, but parts were missing. Worth tightening up.',
  'Correct but Uncertain': 'You knew more than you thought. Trust this one a bit more.',
}

function ConfidencePicker({ value, onChange, disabled }) {
  const index = LEVELS.findIndex(level => level.id === value)
  return <fieldset className="confidence" disabled={disabled}>
    <legend>How confident are you?</legend>
    <div className="segmented" style={{ '--index': index, '--count': LEVELS.length }} data-level={value}>
      <span className="segmented-thumb" aria-hidden="true"/>
      {LEVELS.map(level => <label key={level.id} className={value === level.id ? 'selected' : ''}>
        <input type="radio" name="confidence" value={level.id} checked={value === level.id} onChange={() => onChange(level.id)}/>
        <strong>{level.label}</strong><small>{level.hint}</small>
      </label>)}
    </div>
  </fieldset>
}

function SessionBar({ session, answered, focusStat, onEnd, busy }) {
  const mode = MODES[session.mode]
  const Icon = mode.icon
  const current = Math.min(session.results.length + (answered ? 0 : 1), session.total)
  return <div className={`session-bar card mode-${session.mode}`}>
    <div className="session-bar-top">
      <Badge tone={mode.tone} icon={Icon}>{mode.label}</Badge>
      {session.mode === 'focus' && <span className="session-goal"><strong>{session.topic}</strong> · Goal: Strong mastery</span>}
      <span className="session-counter">Question {current} of {session.total}</span>
      <button className="button small ghost session-end" onClick={onEnd} disabled={busy}>
        {session.results.length ? (session.mode === 'exam' ? 'Finish exam' : 'End session') : 'Cancel'}
      </button>
    </div>
    <div className="session-steps" role="progressbar" aria-label={`${mode.label} progress`} aria-valuemin={0}
      aria-valuemax={session.total} aria-valuenow={session.results.length}
      aria-valuetext={`${session.results.length} of ${session.total} answered`}>
      {Array.from({ length: session.total }, (_, i) => <i key={i}
        className={i < session.results.length ? `done tone-${session.mode === 'exam' ? 'neutral' : STATUS_TONE[session.results[i].status]}` : i === session.results.length ? 'current' : ''}/>)}
    </div>
    {session.mode === 'focus' && <div className="focus-mastery">
      <span>Topic mastery</span>
      {focusStat ? <><Meter value={focusStat.average_score} tone={SCORE_TONE[statusFor(focusStat.average_score)]} label={`${session.topic} mastery`}/>
        <b>{focusStat.average_score}%</b></> : <small className="muted">Not practised yet</small>}
    </div>}
  </div>
}

// Step-by-step answers sometimes arrive as one paragraph ("1. … 2. …"); show them as a real list.
function numberedSteps(text) {
  const steps = text.split(/(?:^|\s+)(?=\d+[.)]\s)/).map(step => step.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean)
  return steps.length > 1 ? steps : null
}

function ExplainMyWay({ explanations, onExplain, busy }) {
  const [active, setActive] = useState(null)
  const text = active && explanations[active]
  const steps = active === 'steps' && text ? numberedSteps(text) : null
  return <div className="my-way">
    <h3><Lightbulb aria-hidden="true"/>Explain it my way</h3>
    <div className="my-way-options" role="group" aria-label="Explanation style">
      {STYLES.map(([id, label, Icon]) => <button key={id} className={`my-way-option ${active === id ? 'active' : ''}`}
        aria-pressed={active === id} disabled={busy && !explanations[id]}
        onClick={() => { setActive(id); if (!explanations[id]) onExplain(id) }}>
        <Icon aria-hidden="true"/>{label}
      </button>)}
    </div>
    {text && <div className="explain my-way-text enter" aria-live="polite">
      {steps ? <ol className="plan-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol> : <p>{text}</p>}
      <small><Cpu aria-hidden="true"/>Explained locally by Qwen3 14B</small>
    </div>}
  </div>
}

function Result({ evaluation, quiz, recorded, onNext, nextLabel, onWeak, busy, explanations, onExplain }) {
  const [explained, setExplained] = useState(false)
  const tone = STATUS_TONE[evaluation.status] || 'cyan'
  return <article className={`card result enter tone-card-${tone}`} aria-labelledby="result-title">
    <div className="result-head">
      <ScoreRing score={evaluation.score} tone={tone}/>
      <div className="result-summary">
        <span className="eyebrow">Evaluation</span>
        <h2 id="result-title" tabIndex={-1}>{evaluation.status}</h2>
        <div className="result-badges">
          <Badge tone={tone}>{evaluation.score}/100</Badge>
          <Badge tone="neutral">{confidenceLabel(evaluation.confidence)}</Badge>
        </div>
      </div>
    </div>
    {evaluation.confidence_insight && <div className={`insight ${evaluation.confidence_insight === 'High-Risk Misconception' ? 'risk' : ''}`}>
      <Compass aria-hidden="true"/>
      <div><strong>{evaluation.confidence_insight}</strong><p>{INSIGHT_COPY[evaluation.confidence_insight] || 'Confidence is tracked alongside your score to spot hidden gaps.'}</p></div>
    </div>}
    <p className="feedback">{evaluation.feedback}</p>
    <div className="points">
      <div className="point-list good"><h3><Check aria-hidden="true"/>What landed</h3>
        {evaluation.correct_points.length ? <ul>{evaluation.correct_points.map(p => <li key={p}>{p}</li>)}</ul> : <p className="muted">Nothing matched the key ideas yet.</p>}
      </div>
      <div className="point-list missing"><h3><Target aria-hidden="true"/>What to revisit</h3>
        {evaluation.missing_points.length ? <ul>{evaluation.missing_points.map(p => <li key={p}>{p}</li>)}</ul> : <p className="muted">Nothing missing — great answer.</p>}
      </div>
    </div>
    {recorded?.length > 0 && <p className="memory-note"><Lightbulb aria-hidden="true"/>{recorded.length} misconception{recorded.length > 1 ? 's' : ''} saved to Misconception Memory for follow-up.</p>}
    {explained && <div className="explain enter">
      <h3>Explanation</h3><p>{quiz.explanation}</p>
      <h3>Model answer</h3><p>{quiz.expected_answer}</p>
    </div>}
    <ExplainMyWay key={quiz.request_id} explanations={explanations} onExplain={onExplain} busy={busy}/>
    <div className="result-actions">
      <button className="button primary shine" onClick={onNext} disabled={busy}>{nextLabel}<ArrowRight aria-hidden="true"/></button>
      <button className="button secondary" onClick={() => setExplained(v => !v)} aria-expanded={explained}><CircleHelp aria-hidden="true"/>{explained ? 'Hide Explanation' : 'Explain This'}</button>
      {onWeak && <button className="button ghost" onClick={onWeak}><Target aria-hidden="true"/>Practice Weak Area</button>}
    </div>
  </article>
}

function GoalReached({ topic, score, onEnd, onKeep, busy }) {
  return <article className="card goal-card enter" role="status">
    <Trophy aria-hidden="true"/>
    <div><strong>Goal reached</strong><p>{topic} is at Strong mastery ({score}% topic average).</p></div>
    <div className="goal-actions">
      <button className="button small primary" onClick={onEnd} disabled={busy}>End Session</button>
      <button className="button small secondary" onClick={onKeep} disabled={busy}>Keep Practising</button>
    </div>
  </article>
}

export default function RevisionArena({ ctx }) {
  const {
    file, quiz, selectionReason, answer, setAnswer, confidence, setConfidence, evaluation, recorded,
    submitAnswer, nextQuestion, startQuiz, testMe, onPickFile, go, task, sessionCount, session, summary,
    explanations, explain, startSession, finishSession, keepPractising, closeSession,
  } = ctx
  const busy = Boolean(task)
  const generating = ['quiz', 'next'].includes(task?.kind)
  const checking = ['evaluate', 'exam'].includes(task?.kind)
  const exam = session?.mode === 'exam'

  useEffect(() => {
    if (evaluation) document.getElementById('result-title')?.focus?.()
  }, [evaluation])
  useEffect(() => {
    if (session?.status === 'complete') document.getElementById('summary-title')?.focus?.()
  }, [session?.status])

  if (session?.status === 'complete') return <SessionSummary ctx={ctx}/>

  const focusStat = session?.mode === 'focus' ? summary.stats.find(item => item.topic === session.topic) : null
  const endSession = () => (session.results.length ? finishSession() : closeSession())

  if (!quiz) {
    return <section className="screen narrow">
      {session ? <SessionBar session={session} answered={false} focusStat={focusStat} onEnd={endSession} busy={busy}/>
        : <SectionHead eyebrow="Revision arena" title="Explain it in your own words." copy="Understanding-based questions, graded semantically by your local model."/>}
      {generating || session ? <Skeleton lines={5} className="question-skeleton"/> : <>
        <div className="card"><Empty icon={BookOpen} title={file ? 'Ready when you are' : 'Load material to begin'}
          copy={file ? `Questions will come from ${file.name}. Practise one question at a time, or start a session below.` : 'Choose a study PDF and StudyShield will generate your first understanding-based question.'}>
          {!file && <PickFile className="button primary shine" onPick={onPickFile}><Upload aria-hidden="true"/>Choose PDF</PickFile>}
          {file && <button className="button primary shine" onClick={startQuiz} disabled={busy}><Zap aria-hidden="true"/>Start Revision</button>}
          {file && <button className="button secondary" onClick={testMe} disabled={busy}><Target aria-hidden="true"/>Test Me</button>}
        </Empty></div>
        <SessionLauncher file={file} busy={busy} onStart={startSession} onLoadMaterial={() => go('Study Material')} compact/>
      </>}
    </section>
  }

  const lastInSession = session && session.results.length >= session.total
  const goal = session?.mode === 'focus' && evaluation && focusStat && statusFor(focusStat.average_score) === 'strong' && !session.goalAcknowledged

  return <section className="screen narrow arena">
    {session ? <SessionBar session={session} answered={Boolean(evaluation)} focusStat={focusStat} onEnd={endSession} busy={busy}/>
      : <div className="arena-top">
        <div className="arena-progress">
          <span>Practice · Question {sessionCount + (evaluation ? 0 : 1)}</span>
          <div className="steps" aria-hidden="true">{[0, 1, 2].map(i => <i key={i} className={i === 0 || (i === 1 && answer.trim()) || (i === 2 && evaluation) ? 'done' : ''}/>)}</div>
          <small>{evaluation ? 'Reviewed' : answer.trim() ? 'Answering' : 'Read & think'}</small>
        </div>
        {file && <span className="arena-file" title={file.name}>{file.name}</span>}
      </div>}

    <article className={`card question-card ${generating ? 'is-loading' : ''}`} aria-busy={generating}>
      <div className="question-meta">
        <Badge tone="cyan">{quiz.topic}</Badge>
        <Badge tone={DIFFICULTY_TONE[quiz.difficulty] || 'neutral'}><span className={`difficulty-bars d-${quiz.difficulty.toLowerCase()}`} aria-hidden="true"><i/><i/><i/></span>{quiz.difficulty}</Badge>
      </div>
      {selectionReason && !exam && <p className="selection-reason"><Compass aria-hidden="true"/>{selectionReason}</p>}
      <h1 className="question-text">{quiz.question}</h1>

      <form onSubmit={e => { e.preventDefault(); submitAnswer() }}>
        <label className="answer-field">
          <span>Your answer</span>
          <textarea rows="7" value={answer} onChange={e => setAnswer(e.target.value)} disabled={!!evaluation || checking}
            placeholder="Focus on the idea, not perfect wording…"
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !evaluation) submitAnswer() }}/>
          <small aria-hidden="true">{answer.trim() ? `${answer.trim().split(/\s+/).length} words` : 'Ctrl + Enter to submit'}</small>
        </label>
        {!evaluation && <>
          <ConfidencePicker value={confidence} onChange={setConfidence} disabled={checking}/>
          {exam && <p className="exam-note"><ClipboardCheck aria-hidden="true"/>Exam Mode: your score and feedback are revealed when you finish.</p>}
          <button className="button primary shine submit" type="submit" disabled={busy}>
            {checking ? (exam ? 'Saving your answer…' : 'Checking understanding…') : exam ? (lastInSession || session.results.length + 1 >= session.total ? 'Submit & finish exam' : 'Submit answer') : 'Check my understanding'}<ArrowRight aria-hidden="true"/>
          </button>
        </>}
      </form>
    </article>

    {checking && !exam && <Skeleton lines={4}/>}
    {goal && <GoalReached topic={session.topic} score={focusStat.average_score} onEnd={finishSession} onKeep={keepPractising} busy={busy}/>}
    {evaluation && !exam && <Result key={quiz.request_id} evaluation={evaluation} quiz={quiz} recorded={recorded} busy={busy}
      explanations={explanations} onExplain={explain}
      onNext={nextQuestion} nextLabel={lastInSession ? 'See session summary' : 'Next Question'}
      onWeak={session ? null : () => go('Weak Areas')}/>}
  </section>
}
