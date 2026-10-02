import {
  AlertTriangle, BarChart3, CalendarClock, Gauge, RefreshCw, Target, Trophy, Upload, Zap,
} from 'lucide-react'
import { Badge, Empty, Meter, PickFile, SectionHead, Skeleton, Stat } from '../components/ui'
import { confidenceLabel, formatDate, relativeTime, statusFor } from '../lib/metrics'

const TONE = { strong: 'success', needs_revision: 'warning', weak: 'danger', unpracticed: 'neutral' }
const ATTEMPT_TONE = { Strong: 'success', 'Needs Revision': 'warning', Weak: 'danger' }

function Calibration({ calibration }) {
  const { aligned, overconfident, underconfident, total } = calibration
  const pct = value => (total ? (value / total) * 100 : 0)
  return <article className="card">
    <span className="eyebrow">Confidence calibration</span>
    <h2 className="card-title">{total ? `${Math.round(pct(aligned))}% of answers matched your confidence` : 'No answers yet'}</h2>
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
  </article>
}

export default function Progress({ ctx }) {
  const { summary, refreshLearning, task, go, file, onPickFile, learningLoaded } = ctx
  const busy = Boolean(task)
  const loading = task?.kind === 'learning' && !learningLoaded

  return <section className="screen">
    <SectionHead eyebrow="Progress" title="Your real learning record."
      copy="Every number here comes from your local SQLite history — nothing estimated."
      actions={<button className="button secondary" onClick={refreshLearning} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button>}/>

    {loading ? <div className="stat-grid six">{Array.from({ length: 6 }, (_, i) => <Skeleton lines={1} key={i}/>)}</div>
      : !summary.totalAttempts ? <div className="card"><Empty icon={BarChart3} title="No quiz history yet"
        copy="Complete a revision question to begin your private progress record.">
        {file ? <button className="button primary shine" onClick={() => go('Revision Arena')}><Zap aria-hidden="true"/>Go to Revision Arena</button>
          : <PickFile className="button primary shine" onPick={f => onPickFile(f, true)}><Upload aria-hidden="true"/>Choose PDF</PickFile>}
      </Empty></div> : <>
        <div className="stat-grid six">
          <Stat label="Average score" icon={Gauge} tone="cyan" value={`${summary.average}%`} hint={`${summary.totalAttempts} attempts`}/>
          <Stat label="Mastery" icon={BarChart3} tone="violet" value={`${summary.mastery}%`} hint={`${summary.mastered}/${summary.stats.length} topics at 85%+`}/>
          <Stat label="Strongest topic" icon={Trophy} tone="success" value={summary.strongest?.topic} hint={`${summary.strongest?.average_score}% average`}/>
          <Stat label="Weakest topic" icon={Target} tone="warning" value={summary.weakest?.topic} hint={`${summary.weakest?.average_score}% average`}/>
          <Stat label="Active misconceptions" icon={AlertTriangle} tone="danger" value={summary.activeMisconceptions ?? 0} hint="Unresolved mistakes"/>
          <Stat label="Reviews due" icon={CalendarClock} tone="neutral" value={summary.reviewsDue} hint="Topics below mastery"/>
        </div>

        <div className="progress-grid">
          <article className="card span-2">
            <span className="eyebrow">Topic mastery</span>
            <ul className="mastery-list">{[...summary.stats].sort((a, b) => b.average_score - a.average_score).map(item => {
              const tone = TONE[statusFor(item.average_score)]
              return <li key={item.topic}>
                <div className="mastery-label"><strong>{item.topic}</strong><span>{item.attempts} attempt{item.attempts === 1 ? '' : 's'} · last {relativeTime(item.last_attempt_at)}</span></div>
                <Meter value={item.average_score} tone={tone} label={`${item.topic} mastery`}/>
                <b className={`tone-text-${tone}`}>{item.average_score}%</b>
              </li>
            })}</ul>
            <div className="threshold-note"><span aria-hidden="true"/>Mastery threshold · 85%</div>
          </article>
          <Calibration calibration={summary.calibration}/>
        </div>

        <div className="progress-grid">
          <article className="card span-2">
            <span className="eyebrow">Recent attempts</span>
            <ol className="timeline">{summary.history.slice(-8).reverse().map(item => <li key={item.id} className={`tone-${ATTEMPT_TONE[item.status] || 'neutral'}`}>
              <span className="timeline-dot" aria-hidden="true"/>
              <div className="timeline-body">
                <div className="timeline-top"><strong>{item.topic}</strong><time dateTime={item.created_at}>{formatDate(item.created_at)}</time></div>
                <p title={item.question}>{item.question}</p>
                <div className="chips">
                  <Badge tone={ATTEMPT_TONE[item.status] || 'neutral'}>{item.score}% · {item.status}</Badge>
                  <Badge tone="neutral">{confidenceLabel(item.confidence)}</Badge>
                  {item.confidence_insight && <Badge tone={item.confidence_insight === 'High-Risk Misconception' ? 'danger' : 'violet'}>{item.confidence_insight}</Badge>}
                </div>
              </div>
            </li>)}</ol>
          </article>
          <article className="card">
            <span className="eyebrow">Topic performance</span>
            <div className="topic-cards">{summary.stats.map(item => {
              const tone = TONE[statusFor(item.average_score)]
              return <div className={`topic-perf tone-${tone}`} key={item.topic}>
                <div><strong>{item.topic}</strong><b className={`tone-text-${tone}`}>{item.average_score}%</b></div>
                <small>{item.attempts} attempts{item.high_confidence_wrong ? ` · ${item.high_confidence_wrong} high-confidence miss` : ''}{item.low_confidence_correct ? ` · ${item.low_confidence_correct} underconfident` : ''}</small>
              </div>
            })}</div>
          </article>
        </div>
      </>}
  </section>
}
