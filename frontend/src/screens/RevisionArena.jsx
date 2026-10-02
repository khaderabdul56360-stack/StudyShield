import { useEffect, useState } from 'react'
import {
  ArrowRight, BookOpen, Check, CircleHelp, Compass, Lightbulb, Target, Upload, Zap,
} from 'lucide-react'
import { Badge, Empty, PickFile, ScoreRing, SectionHead, Skeleton } from '../components/ui'
import { confidenceLabel } from '../lib/metrics'

const LEVELS = [
  { id: 'low', label: 'Low', hint: 'Guessing' },
  { id: 'medium', label: 'Medium', hint: 'Fairly sure' },
  { id: 'high', label: 'High', hint: 'Certain' },
]

const STATUS_TONE = { Strong: 'success', 'Needs Revision': 'warning', Weak: 'danger' }
const DIFFICULTY_TONE = { Easy: 'success', Medium: 'cyan', Hard: 'violet' }

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

function Result({ evaluation, quiz, recorded, onNext, onWeak, busy }) {
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
    <div className="result-actions">
      <button className="button primary shine" onClick={onNext} disabled={busy}>Next Question<ArrowRight aria-hidden="true"/></button>
      <button className="button secondary" onClick={() => setExplained(v => !v)} aria-expanded={explained}><CircleHelp aria-hidden="true"/>{explained ? 'Hide Explanation' : 'Explain This'}</button>
      <button className="button ghost" onClick={onWeak}><Target aria-hidden="true"/>Practice Weak Area</button>
    </div>
  </article>
}

export default function RevisionArena({ ctx }) {
  const {
    file, quiz, selectionReason, answer, setAnswer, confidence, setConfidence, evaluation, recorded,
    submitAnswer, nextQuestion, startQuiz, testMe, onPickFile, go, task, sessionCount,
  } = ctx
  const busy = Boolean(task)
  const generating = ['quiz', 'next'].includes(task?.kind)
  const checking = task?.kind === 'evaluate'

  useEffect(() => {
    if (evaluation) document.getElementById('result-title')?.focus?.()
  }, [evaluation])

  if (!quiz) {
    return <section className="screen narrow">
      <SectionHead eyebrow="Revision arena" title="Explain it in your own words." copy="Understanding-based questions, graded semantically by your local model."/>
      {generating ? <Skeleton lines={5} className="question-skeleton"/> : <div className="card"><Empty icon={BookOpen} title={file ? 'Ready when you are' : 'Load material to begin'}
        copy={file ? `Questions will come from ${file.name}. Start with a fresh question or let StudyShield target your gaps.` : 'Choose a study PDF and StudyShield will generate your first understanding-based question.'}>
        {!file && <PickFile className="button primary shine" onPick={onPickFile}><Upload aria-hidden="true"/>Choose PDF</PickFile>}
        {file && <button className="button primary shine" onClick={startQuiz} disabled={busy}><Zap aria-hidden="true"/>Start Revision</button>}
        {file && <button className="button secondary" onClick={testMe} disabled={busy}><Target aria-hidden="true"/>Test Me</button>}
      </Empty></div>}
    </section>
  }

  return <section className="screen narrow arena">
    <div className="arena-top">
      <div className="arena-progress">
        <span>Question {sessionCount + (evaluation ? 0 : 1)}</span>
        <div className="steps" aria-hidden="true">{[0, 1, 2].map(i => <i key={i} className={i === 0 || (i === 1 && answer.trim()) || (i === 2 && evaluation) ? 'done' : ''}/>)}</div>
        <small>{evaluation ? 'Reviewed' : answer.trim() ? 'Answering' : 'Read & think'}</small>
      </div>
      {file && <span className="arena-file" title={file.name}>{file.name}</span>}
    </div>

    <article className={`card question-card ${generating ? 'is-loading' : ''}`} aria-busy={generating}>
      <div className="question-meta">
        <Badge tone="cyan">{quiz.topic}</Badge>
        <Badge tone={DIFFICULTY_TONE[quiz.difficulty] || 'neutral'}><span className={`difficulty-bars d-${quiz.difficulty.toLowerCase()}`} aria-hidden="true"><i/><i/><i/></span>{quiz.difficulty}</Badge>
      </div>
      {selectionReason && <p className="selection-reason"><Compass aria-hidden="true"/>{selectionReason}</p>}
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
          <button className="button primary shine submit" type="submit" disabled={busy}>
            {checking ? 'Checking understanding…' : 'Check my understanding'}<ArrowRight aria-hidden="true"/>
          </button>
        </>}
      </form>
    </article>

    {checking && <Skeleton lines={4}/>}
    {evaluation && <Result key={quiz.question} evaluation={evaluation} quiz={quiz} recorded={recorded} busy={busy}
      onNext={nextQuestion} onWeak={() => go('Weak Areas')}/>}
  </section>
}
