import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Compass, Crosshair, GraduationCap, Home as HomeIcon,
  Lightbulb, RotateCcw, Target, Trophy,
} from 'lucide-react'
import { Badge, Meter, ScoreRing } from '../components/ui'
import { confidenceLabel, statusFor } from '../lib/metrics'

const STATUS_TONE = { Strong: 'success', 'Needs Revision': 'warning', Weak: 'danger' }
const SCORE_TONE = { strong: 'success', needs_revision: 'warning', weak: 'danger' }
const INSIGHT_TONE = {
  'Confident & Correct': 'success', 'Confident but Incomplete': 'warning', 'High-Risk Misconception': 'danger',
  'Correct but Uncertain': 'violet', 'Needs Guided Practice': 'warning', 'Needs More Practice': 'warning',
  'Medium confidence': 'neutral',
}
const MODE = {
  quick: { icon: GraduationCap, eyebrow: 'Quick Revision', title: 'Session complete' },
  exam: { icon: ClipboardCheck, eyebrow: 'Exam Mode', title: 'Exam complete' },
  focus: { icon: Crosshair, eyebrow: 'Focus Session' },
}

function insightTone(label) {
  return INSIGHT_TONE[label.startsWith('Medium confidence') ? 'Medium confidence' : label] || 'neutral'
}

function Calibration({ calibration }) {
  const { aligned, overconfident, underconfident, total } = calibration
  const pct = value => (total ? (value / total) * 100 : 0)
  return <div className="summary-block">
    <h3>Confidence calibration</h3>
    <div className="stacked-bar" role="img" aria-label={`${aligned} aligned, ${overconfident} overconfident, ${underconfident} underconfident`}>
      <span className="seg aligned" style={{ width: `${pct(aligned)}%` }}/>
      <span className="seg over" style={{ width: `${pct(overconfident)}%` }}/>
      <span className="seg under" style={{ width: `${pct(underconfident)}%` }}/>
    </div>
    <ul className="calibration-legend">
      <li><i className="aligned" aria-hidden="true"/><span>Aligned</span><b>{aligned}</b></li>
      <li><i className="over" aria-hidden="true"/><span>Overconfident <small>high confidence, under 60%</small></span><b>{overconfident}</b></li>
      <li><i className="under" aria-hidden="true"/><span>Underconfident <small>low confidence, 85%+</small></span><b>{underconfident}</b></li>
    </ul>
  </div>
}

export default function SessionSummary({ ctx }) {
  const { session, summary: learning, practiceTopic, startFocus, closeSession, restartSession, task } = ctx
  const busy = Boolean(task)
  const result = session.summary
  const exam = session.mode === 'exam'
  const focusStat = session.mode === 'focus' ? learning.stats.find(item => item.topic === session.topic) : null
  const goalReached = focusStat ? statusFor(focusStat.average_score) === 'strong' : false
  const mode = MODE[session.mode]
  const Icon = mode.icon
  const overallTone = SCORE_TONE[statusFor(result.average_score)]
  const title = session.mode === 'focus' ? (goalReached ? 'Goal reached' : 'Keep revising') : mode.title

  return <section className="screen summary-screen" aria-labelledby="summary-title">
    <article className={`card summary-hero tone-card-${overallTone}`}>
      <div className="summary-hero-copy">
        <span className="eyebrow"><Icon aria-hidden="true"/>{mode.eyebrow}{session.mode === 'focus' && ` · ${session.topic}`}</span>
        <h1 id="summary-title" tabIndex={-1}>{title}</h1>
        <p>{session.mode === 'focus'
          ? (goalReached ? `${session.topic} is now at Strong mastery.` : `Strong mastery means an 85% topic average. Here is where ${session.topic} stands.`)
          : exam ? 'Every answer was graded locally and saved to your learning profile.'
            : 'Each question was chosen from your answers so far. Here is what this session revealed.'}</p>
        {focusStat && <div className="focus-mastery">
          <span>Topic mastery</span>
          <Meter value={focusStat.average_score} tone={SCORE_TONE[statusFor(focusStat.average_score)]} label={`${session.topic} mastery`}/>
          <b>{focusStat.average_score}%</b>
        </div>}
      </div>
      <ScoreRing score={Math.round(result.average_score)} size={156} tone={overallTone} label={exam ? 'Overall score' : 'Average score'}/>
      <dl className="summary-stats">
        <div><dt>Questions</dt><dd>{result.questions_completed}</dd></div>
        <div><dt>Average</dt><dd>{result.average_score}%</dd></div>
        <div className="tone-success"><dt><i aria-hidden="true"/>Strong</dt><dd>{result.status_counts.Strong}</dd></div>
        <div className="tone-warning"><dt><i aria-hidden="true"/>Needs Revision</dt><dd>{result.status_counts['Needs Revision']}</dd></div>
        <div className="tone-danger"><dt><i aria-hidden="true"/>Weak</dt><dd>{result.status_counts.Weak}</dd></div>
      </dl>
    </article>

    <div className="summary-grid">
      <article className="card">
        <span className="eyebrow"><Compass aria-hidden="true"/>Confidence summary</span>
        <ul className="insight-counts">{result.confidence_counts.map(item => <li key={item.label} className={`tone-${insightTone(item.label)}`}>
          <b>{item.count}</b><span>{item.label}</span>
        </li>)}</ul>
        {exam && <Calibration calibration={result.calibration}/>}
      </article>

      <article className="card">
        <span className="eyebrow warning"><Lightbulb aria-hidden="true"/>Misconceptions found</span>
        {result.misconceptions.length
          ? <ul className="found-list">{result.misconceptions.map(item => <li key={item.id}>
            <AlertTriangle aria-hidden="true"/><div><strong>{item.misconception}</strong><small>{item.topic}{item.resolved ? ' · resolved' : ''}</small></div>
          </li>)}</ul>
          : <p className="muted">No new misconceptions detected.</p>}
      </article>

      {exam && <article className="card span-2">
        <span className="eyebrow"><BarChart3 aria-hidden="true"/>Topic breakdown</span>
        <ul className="mastery-list">{result.topics.map(item => {
          const tone = STATUS_TONE[item.status]
          return <li key={item.topic}>
            <div className="mastery-label"><strong title={item.topic}>{item.topic}</strong><span>{item.questions} question{item.questions === 1 ? '' : 's'} · {item.status}</span></div>
            <Meter value={item.average_score} tone={tone} label={`${item.topic} exam score`}/>
            <b className={`tone-text-${tone}`}>{item.average_score}%</b>
          </li>
        })}</ul>
        <div className="topic-split">
          <div><h3><Trophy aria-hidden="true"/>Strong topics</h3>{result.strong_topics.length ? <div className="chips">{result.strong_topics.map(t => <span className="chip" key={t}>{t}</span>)}</div> : <p className="muted">None yet</p>}</div>
          <div><h3><Target aria-hidden="true"/>Needs work</h3>{result.weak_topics.length ? <div className="chips">{result.weak_topics.map(t => <span className="chip" key={t}>{t}</span>)}</div> : <p className="muted">Nothing below mastery</p>}</div>
        </div>
      </article>}

      <article className="card span-2">
        <span className="eyebrow"><CheckCircle2 aria-hidden="true"/>Question breakdown</span>
        <ol className="breakdown">{result.questions.map((item, index) => {
          const tone = STATUS_TONE[item.status]
          const row = <>
            <span className={`breakdown-index tone-${tone}`} aria-hidden="true">{index + 1}</span>
            <div className="breakdown-main">
              <strong>{item.topic}</strong>
              <div className="chips">
                <Badge tone={tone}>{item.score}% · {item.status}</Badge>
                <Badge tone="neutral">{confidenceLabel(item.confidence)}</Badge>
                {item.confidence_insight && <Badge tone={insightTone(item.confidence_insight)}>{item.confidence_insight}</Badge>}
              </div>
            </div>
          </>
          return <li key={item.attempt_id} className={`tone-${tone}`}>
            {exam ? <details>
              <summary>{row}</summary>
              <div className="breakdown-detail">
                <p className="breakdown-question">{item.question}</p>
                <p>{item.feedback}</p>
                {item.missing_points.length > 0 && <ul>{item.missing_points.map(point => <li key={point}>{point}</li>)}</ul>}
              </div>
            </details> : <div className="breakdown-row">{row}</div>}
          </li>
        })}</ol>
      </article>

      <article className="card span-2 revise-next">
        <span className="eyebrow"><Target aria-hidden="true"/>{session.mode === 'focus' ? 'Recommended next action' : 'Revise next'}</span>
        {session.reviseNext?.length ? <ol>{session.reviseNext.map((item, index) => <li key={item.topic}>
          <span className="queue-rank" aria-hidden="true">{index + 1}</span>
          <div><strong>{item.topic}</strong><small>{item.reason}</small></div>
          <button className="button small secondary" onClick={() => practiceTopic(item.topic)} disabled={busy}
            aria-label={`Practice ${item.topic}`}>Practice<ArrowRight aria-hidden="true"/></button>
        </li>)}</ol> : <p className="muted">Nothing urgent. Every practised topic is at mastery.</p>}
      </article>
    </div>

    <div className="summary-actions" role="group" aria-label="What next">
      <button className="button primary shine" onClick={restartSession} disabled={busy}><RotateCcw aria-hidden="true"/>
        {session.mode === 'focus' ? (goalReached ? 'Practise again' : 'Keep revising this topic') : exam ? 'Start another exam' : 'Start another session'}</button>
      {session.mode === 'focus' && !goalReached && session.reviseNext?.[0] && session.reviseNext[0].topic !== session.topic &&
        <button className="button secondary" onClick={() => startFocus(session.reviseNext[0].topic)} disabled={busy}><Crosshair aria-hidden="true"/>Focus on {session.reviseNext[0].topic}</button>}
      <button className="button secondary" onClick={() => closeSession('Weak Areas')}><Target aria-hidden="true"/>Review Weak Areas</button>
      <button className="button secondary" onClick={() => closeSession('Progress')}><BarChart3 aria-hidden="true"/>View Progress</button>
      <button className="button ghost" onClick={() => closeSession('Home')}><HomeIcon aria-hidden="true"/>Return Home</button>
    </div>
  </section>
}
