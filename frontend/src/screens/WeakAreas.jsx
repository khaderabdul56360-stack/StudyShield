import {
  AlertTriangle, ArrowRight, CheckCircle2, Flag, Lightbulb, MessageCircleQuestion, RefreshCw, Sparkles,
  Target, Zap,
} from 'lucide-react'
import { Badge, Empty, Meter, SectionHead, Skeleton } from '../components/ui'
import { statusFor } from '../lib/metrics'

const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'cyan' }
const SCORE_TONE = { strong: 'success', needs_revision: 'warning', weak: 'danger' }

function Roadmap({ plan, onPractice, busy }) {
  if (!plan.weak_topics.length) {
    return <div className="card"><Empty icon={CheckCircle2} tone="success" title="No weak topics right now" copy="Every tracked topic is currently at 85% or above."/></div>
  }
  return <section className="roadmap enter" aria-labelledby="roadmap-title">
    <div className="mini-head"><h2 id="roadmap-title"><Sparkles aria-hidden="true"/>Your revision session</h2><span>{plan.weak_topics.length} stop{plan.weak_topics.length > 1 ? 's' : ''} · generated locally</span></div>
    <ol className="roadmap-list">{plan.weak_topics.map((item, index) => <li key={item.topic} className={`roadmap-stop tone-${PRIORITY_TONE[item.priority]}`}>
      <div className="roadmap-marker" aria-hidden="true"><span>{index + 1}</span></div>
      <article className="card">
        <div className="roadmap-head">
          <div><Badge tone={PRIORITY_TONE[item.priority]} icon={Flag}>{item.priority} priority</Badge><h3>{item.topic}</h3></div>
          <strong className={`tone-text-${SCORE_TONE[statusFor(item.average_score)]}`}>{item.average_score}%</strong>
        </div>
        <p className="muted">{item.why_weak}</p>
        <div className="explain-box"><Lightbulb aria-hidden="true"/><div><h4>Quick explanation</h4><p>{item.mini_explanation}</p></div></div>
        <h4>Session plan</h4>
        <ol className="plan-steps">{item.revision_plan.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="practice-q"><MessageCircleQuestion aria-hidden="true"/><span>{item.practice_question}</span></div>
        <button className="button secondary" onClick={() => onPractice(item.topic)} disabled={busy}><Target aria-hidden="true"/>Practice {item.topic}</button>
      </article>
    </li>)}</ol>
  </section>
}

export default function WeakAreas({ ctx }) {
  const { summary, misconceptions, weakPlan, fixWeakAreas, practiceTopic, refreshLearning, task, go, file, learningLoaded } = ctx
  const busy = Boolean(task)
  const planning = task?.kind === 'plan'
  const activeByTopic = {}
  ;(misconceptions?.misconceptions || []).filter(m => !m.resolved).forEach(m => { activeByTopic[m.topic] = (activeByTopic[m.topic] || 0) + 1 })

  return <section className="screen">
    <SectionHead eyebrow="Weak areas" title="Spend effort where it matters."
      copy="Topics under 85% or with confident wrong answers, ranked by priority."
      actions={<button className="button secondary" onClick={refreshLearning} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button>}/>

    {task?.kind === 'learning' && !learningLoaded ? <div className="weak-grid"><Skeleton/><Skeleton/></div>
      : !summary.totalAttempts ? <div className="card"><Empty icon={Target} tone="warning" title="No weak areas yet"
        copy="Complete a revision question and your recommended focus areas will appear here.">
        <button className="button primary shine" onClick={() => go(file ? 'Revision Arena' : 'Study Material')}><Zap aria-hidden="true"/>{file ? 'Start revising' : 'Load study material'}</button>
      </Empty></div>
      : <>
        <div className="fix-banner card">
          <div className="fix-copy">
            <span className="eyebrow">Focused session</span>
            <h2>{summary.weakTopics.length ? `${summary.weakTopics.length} topic${summary.weakTopics.length > 1 ? 's' : ''} need${summary.weakTopics.length > 1 ? '' : 's'} attention` : 'Everything is above mastery'}</h2>
            <p>Qwen3 14B reads your attempt history and builds a short plan for the top three gaps.</p>
          </div>
          <button className="button primary shine large" onClick={fixWeakAreas} disabled={busy}><Sparkles aria-hidden="true"/>{planning ? 'Building plan…' : 'Fix My Weak Areas'}</button>
        </div>

        {summary.weakTopics.length ? <div className="weak-grid">{summary.weakTopics.map(item => {
          const tone = SCORE_TONE[statusFor(item.average_score)]
          const linked = activeByTopic[item.topic] || 0
          return <article className={`card weak-card spot tone-card-${PRIORITY_TONE[item.priority]}`} key={item.topic}>
            <div className="weak-head"><Badge tone={PRIORITY_TONE[item.priority]} icon={Flag}>{item.priority} priority</Badge><small>{item.attempts} attempt{item.attempts === 1 ? '' : 's'}</small></div>
            <h3>{item.topic}</h3>
            <div className="weak-score"><b className={`tone-text-${tone}`}>{item.average_score}%</b><Meter value={item.average_score} tone={tone} label={`${item.topic} score`}/></div>
            <p className="muted">{item.high_confidence_wrong ? 'A high-confidence incorrect answer needs immediate correction.' : 'The current average is below the 85% mastery threshold.'}</p>
            {linked > 0 && <button className="link-chip" onClick={() => go('Misconceptions')}><AlertTriangle aria-hidden="true"/>{linked} active misconception{linked > 1 ? 's' : ''}<ArrowRight aria-hidden="true"/></button>}
            <div className="next-step"><span>Next step</span><button className="text-link" onClick={() => practiceTopic(item.topic)} disabled={busy}>Practice this topic<ArrowRight aria-hidden="true"/></button></div>
          </article>
        })}</div> : <div className="card"><Empty icon={CheckCircle2} tone="success" title="No weak topics" copy="Every topic you've practised is at 85% or above. Keep testing to stay sharp."/></div>}

        {planning && <Skeleton lines={6}/>}
        {weakPlan && !planning && <Roadmap plan={weakPlan} onPractice={practiceTopic} busy={busy}/>}
      </>}
  </section>
}
