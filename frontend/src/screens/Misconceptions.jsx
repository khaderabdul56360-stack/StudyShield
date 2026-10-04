import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Quote, RefreshCw, Repeat, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Badge, Empty, SectionHead, Skeleton, Stat } from '../components/ui'
import { relativeTime } from '../lib/metrics'

function Recurrence({ count }) {
  const shown = Math.min(count, 5)
  return <span className="recurrence" aria-label={`Seen ${count} time${count === 1 ? '' : 's'}`}>
    <span aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < shown ? 'on' : ''}/>)}</span>
    ×{count}
  </span>
}

export default function Misconceptions({ ctx }) {
  const { misconceptions, practiceTopic, refreshLearning, task, learningLoaded, go } = ctx
  const busy = Boolean(task)
  const items = misconceptions?.misconceptions || []
  const active = items.filter(item => !item.resolved)
  const highRisk = active.filter(item => item.confidence_risk)

  return <section className="screen">
    <SectionHead eyebrow="Misconception memory" title="Turn wrong ideas into durable learning."
      copy="Specific misunderstandings found in your answers. Each resolves when a later strong answer shows the corrected idea."
      actions={<button className="button secondary" onClick={refreshLearning} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button>}/>

    {task?.kind === 'learning' && !learningLoaded ? <div className="myth-grid"><Skeleton/><Skeleton/></div>
      : !items.length ? <div className="card"><Empty icon={ShieldCheck} tone="success" title="No misconceptions detected"
        copy="StudyShield records only specific misunderstandings supported by your answers. Keep revising — this stays honest.">
        <button className="button secondary" onClick={() => go('Revision Arena')}>Go to Revision Arena<ArrowRight aria-hidden="true"/></button>
      </Empty></div> : <>
        <div className="stat-grid three">
          <Stat label="Active" icon={AlertTriangle} tone="danger" value={active.length} hint="Still showing up"/>
          <Stat label="High-risk" icon={ShieldAlert} tone="warning" value={highRisk.length} hint="Held with high confidence"/>
          <Stat label="Resolved" icon={CheckCircle2} tone="success" value={items.length - active.length} hint="Corrected by a strong answer"/>
        </div>
        <ul className="myth-grid">{items.map(item => <li key={item.id} className={`myth-card card ${item.resolved ? 'resolved' : ''} ${item.confidence_risk ? 'high-risk' : ''}`}>
          {item.confidence_risk && <div className="risk-ribbon"><ShieldAlert aria-hidden="true"/>High-Risk Misconception</div>}
          <div className="myth-top">
            <Badge tone={item.resolved ? 'success' : 'danger'} icon={item.resolved ? CheckCircle2 : AlertTriangle}>{item.resolved ? 'Resolved' : 'Active'}</Badge>
            <span className="myth-topic">{item.topic}</span>
          </div>
          <p className="myth-text">{item.misconception}</p>
          {item.evidence && <blockquote className="evidence"><Quote aria-hidden="true"/><span>{item.evidence}</span></blockquote>}
          <dl className="myth-meta">
            <div><dt><Repeat aria-hidden="true"/>Recurrence</dt><dd><Recurrence count={item.occurrence_count}/></dd></div>
            <div><dt><ShieldAlert aria-hidden="true"/>Confidence risk</dt><dd>{item.confidence_risk ? `${item.high_confidence_wrong_count} confident miss${item.high_confidence_wrong_count === 1 ? '' : 'es'}` : 'Low'}</dd></div>
            <div><dt><Clock aria-hidden="true"/>Last seen</dt><dd><time dateTime={item.last_seen}>{relativeTime(item.last_seen)}</time></dd></div>
          </dl>
          {!item.resolved && <button className="button secondary full" onClick={() => practiceTopic(item.topic)} disabled={busy}>Practice This<ArrowRight aria-hidden="true"/></button>}
        </li>)}</ul>
      </>}
  </section>
}
