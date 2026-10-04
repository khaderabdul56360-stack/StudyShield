import { useEffect, useState } from 'react'
import {
  AlertTriangle, BrainCircuit, Cpu, FileWarning, Hourglass, PlugZap, RefreshCw, ServerOff, X,
} from 'lucide-react'

export function Badge({ tone = 'neutral', icon: Icon, children, className = '', title }) {
  return <span className={`badge tone-${tone} ${className}`} title={title}>{Icon && <Icon aria-hidden="true"/>}{children}</span>
}

export function SectionHead({ eyebrow, title, copy, actions }) {
  return <div className="section-head">
    <div>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {copy && <p>{copy}</p>}
    </div>
    {actions && <div className="section-actions">{actions}</div>}
  </div>
}

export function Empty({ icon: Icon, title, copy, tone = 'cyan', children }) {
  return <div className={`empty tone-${tone}`}>
    <div className="empty-icon" aria-hidden="true"><span/><Icon/></div>
    <h2>{title}</h2>
    <p>{copy}</p>
    {children && <div className="empty-actions">{children}</div>}
  </div>
}

export function PickFile({ className = 'button secondary', onPick, children }) {
  return <label className={className}>
    {children}
    <input type="file" accept="application/pdf,.pdf" onChange={e => { onPick(e.target.files[0]); e.target.value = '' }}/>
  </label>
}

export function Stat({ label, value, hint, tone = 'neutral', icon: Icon }) {
  return <div className={`stat spot tone-${tone}`}>
    <div className="stat-top"><span>{label}</span>{Icon && <Icon aria-hidden="true"/>}</div>
    <strong title={typeof value === 'string' ? value : undefined}>{value}</strong>
    {hint && <small>{hint}</small>}
  </div>
}

export function ScoreRing({ score, size = 132, tone = 'cyan', label = 'Score' }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(score ?? 0))
    return () => cancelAnimationFrame(frame)
  }, [score])
  return <div className={`score-ring tone-${tone}`} style={{ width: size, height: size, '--ring-font': `${Math.round(size * 0.26)}px` }} role="img"
    aria-label={`${label}: ${score ?? 'none'} out of 100`}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle className="ring-track" cx="60" cy="60" r={radius}/>
      <circle className="ring-value" cx="60" cy="60" r={radius}
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shown / 100)}/>
    </svg>
    <div><strong>{score ?? '—'}</strong><small>/100</small></div>
  </div>
}

export function Meter({ value, tone = 'cyan', label }) {
  return <div className={`meter tone-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={Math.round(value)} aria-label={label}>
    <span style={{ width: `${Math.max(2, Math.min(100, value))}%` }}/>
  </div>
}

export function Skeleton({ lines = 3, className = '' }) {
  return <div className={`skeleton-card ${className}`} aria-hidden="true">
    <i className="sk sk-title"/>
    {Array.from({ length: lines }, (_, i) => <i className="sk" style={{ width: `${92 - i * 14}%` }} key={i}/>)}
  </div>
}

// Real elapsed time only; the backend does not stream progress so we never fake a percentage.
export function Thinking({ task }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    setElapsed(0)
    const timer = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [task?.label])
  if (!task) return null
  return <div className="thinking" role="status" aria-live="polite">
    <div className="thinking-orb" aria-hidden="true"><BrainCircuit/></div>
    <div className="thinking-copy">
      <strong>{task.label}</strong>
      <span>Thinking locally with Qwen3 14B · {elapsed}s{task.previous ? ` · last time ${task.previous}s` : ''}</span>
      {task.steps && <ol className="thinking-steps">{task.steps.map(step => <li key={step}>{step}</li>)}</ol>}
    </div>
    <div className="thinking-bar" aria-hidden="true"><span/></div>
  </div>
}

const ERROR_KINDS = [
  { test: /could not reach the local backend/i, icon: ServerOff, title: 'Backend disconnected',
    action: 'Start the local API with uvicorn backend.main:app, then retry.', retry: true },
  // Patterns cover both api.js's friendly rewrites and the raw FastAPI details it passes through.
  { test: /ollama (is not running|is not reachable|could not complete)/i, icon: PlugZap, title: 'Ollama is not running',
    action: 'Open Ollama (or run ollama serve), then retry.', retry: true },
  { test: /not installed|ollama pull|local model .* is unavailable|unexpected response/i, icon: Cpu, title: 'Model unavailable',
    action: 'Install the model with ollama pull qwen3:14b, then retry.', retry: true },
  { test: /20 mb|too large|exceeds/i, icon: FileWarning, title: 'PDF too large',
    action: 'StudyShield accepts PDFs up to 20 MB. Split the file or export fewer pages.', retry: false },
  { test: /readable text|unreadable|corrupted|not a valid pdf|pdf is empty|only pdf|choose a pdf|choose the original/i,
    icon: FileWarning, title: 'Study material needed',
    action: 'Pick a text-based PDF (scanned images cannot be read).', retry: false },
  { test: /too long|timed out|timeout/i, icon: Hourglass, title: 'The local model timed out',
    action: 'Large PDFs take longer on-device. Retry, or try a shorter document.', retry: true },
  { test: /invalid structured output|omitted a required/i, icon: Cpu, title: 'The local model returned an unusable answer',
    action: 'This happens occasionally with local models. Retry usually fixes it.', retry: true },
  { test: /write an answer/i, icon: AlertTriangle, title: 'Answer needed',
    action: 'Write a short explanation in your own words first.', retry: false },
]

export function ErrorCard({ message, onRetry, onDismiss }) {
  if (!message) return null
  const kind = ERROR_KINDS.find(item => item.test.test(message))
    || { icon: AlertTriangle, title: 'Something went wrong', action: 'Your data is safe on this device. Try again.', retry: true }
  const Icon = kind.icon
  return <div className="error-card" role="alert">
    <div className="error-icon" aria-hidden="true"><Icon/></div>
    <div className="error-copy"><strong>{kind.title}</strong><p>{message}</p><small>{kind.action}</small></div>
    <div className="error-actions">
      {kind.retry && onRetry && <button className="button small secondary" onClick={onRetry}><RefreshCw aria-hidden="true"/>Retry</button>}
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss error"><X/></button>
    </div>
  </div>
}
