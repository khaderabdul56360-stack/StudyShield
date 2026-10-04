import { Crosshair, ListOrdered, Target } from 'lucide-react'
import { Badge, Meter } from './ui'

const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'cyan' }
const STATUS_TONE = { Strong: 'success', 'Needs Revision': 'warning', Weak: 'danger', Unpractised: 'neutral' }

// Ranked by backend/adaptive.py revision_queue: the same student model that picks adaptive questions.
export default function RevisionQueue({ items, limit = 5, onPractice, onFocus, busy, loading, title = 'What should I study next?' }) {
  const shown = (items || []).slice(0, limit)
  return <section className="card queue-card" aria-labelledby="queue-title">
    <div className="queue-head">
      <div>
        <span className="eyebrow"><ListOrdered aria-hidden="true"/>Smart revision queue</span>
        <h2 id="queue-title">{title}</h2>
      </div>
      <small>Ranked from your saved answers · no AI call</small>
    </div>
    {loading && !items ? <p className="muted">Loading your queue…</p>
      : !shown.length ? <p className="muted">Answer a question or build the concept graph and StudyShield will rank what to revise next.</p>
        : <ol className="queue-list">{shown.map(item => {
          const tone = STATUS_TONE[item.status] || 'neutral'
          return <li key={item.topic} className={`queue-item tone-${PRIORITY_TONE[item.priority]}`}>
            <span className="queue-rank" aria-hidden="true">{item.position}</span>
            <div className="queue-body">
              <div className="queue-title">
                <strong>{item.topic}</strong>
                <Badge tone={PRIORITY_TONE[item.priority]}>{item.priority}<span className="sr-only"> priority</span></Badge>
              </div>
              <p>{item.reason}</p>
              <div className="queue-score">
                {item.average_score == null
                  ? <span className="muted">Unpractised{item.importance != null ? ` · importance ${Math.round(item.importance * 100)}%` : ''}</span>
                  : <><Meter value={item.average_score} tone={tone} label={`${item.topic} average`}/>
                    <span className={`tone-text-${tone}`}>{item.average_score}% · {item.status}</span></>}
              </div>
            </div>
            <div className="queue-actions">
              <button className="button small secondary" onClick={() => onPractice(item.topic)} disabled={busy}
                aria-label={`Practice ${item.topic}`}><Target aria-hidden="true"/>Practice</button>
              {onFocus && <button className="button small ghost" onClick={() => onFocus(item.topic)} disabled={busy}
                aria-label={`Start a focus session on ${item.topic}`}><Crosshair aria-hidden="true"/>Focus</button>}
            </div>
          </li>
        })}</ol>}
  </section>
}
