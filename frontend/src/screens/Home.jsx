import {
  AlertTriangle, ArrowRight, Cloud, Cpu, Gauge, HardDrive, LockKeyhole, ShieldCheck, Sparkles, Trophy, Upload,
} from 'lucide-react'
import { Badge, Stat } from '../components/ui'
import RevisionQueue from '../components/RevisionQueue'
import SessionLauncher from '../components/SessionLauncher'

// Everything the local model is responsible for. The ranking and scoring rules are deterministic code.
const QWEN_ROLES = ['Reads your notes', 'Maps concepts', 'Writes questions', 'Grades answers', 'Spots misconceptions', 'Explains your way']

function engineState(backendOnline, modelStatus, modelInfo) {
  if (backendOnline === false) return ['danger', 'offline', 'API offline']
  if (backendOnline === null) return ['neutral', '', 'Checking']
  if (modelInfo?.ollama === false) return ['warning', 'offline', 'Ollama offline']
  if (modelInfo?.installed === false) return ['warning', 'offline', 'Model not installed']
  if (modelStatus === 'down') return ['warning', 'offline', 'Model unavailable']
  if (modelStatus === 'ok') return ['success', 'online', modelInfo?.loaded ? 'Ready · warm' : 'Ready']
  return ['cyan', 'online', 'Standby']
}

export default function Home({ ctx }) {
  const {
    summary, backendOnline, modelStatus, modelInfo, file, onPickFile, go, queue, task, practiceTopic, startFocus, startSession,
  } = ctx
  const busy = Boolean(task)
  const engine = engineState(backendOnline, modelStatus, modelInfo)
  const hasHistory = summary.totalAttempts > 0
  return <div className="home">
    <section className="hero spot-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <Badge tone="cyan" className="hero-badge"><span className="live-dot" aria-hidden="true"/>Private AI · running on your device</Badge>
        <h1 id="hero-title">Your notes.<br/>Your AI.<br/><span className="gradient-text">Your device.</span></h1>
        <p className="lede">Private adaptive learning, powered locally by Qwen3 14B. It works out what you understand, what you misunderstand, and what to revise next.</p>
        <div className="hero-actions">
          <label className="button primary shine">
            <Upload aria-hidden="true"/>Upload Study Material
            <input type="file" accept="application/pdf,.pdf" onChange={e => { onPickFile(e.target.files[0], true); e.target.value = '' }}/>
          </label>
          <button className="button ghost" onClick={() => go('Revision Arena')}>
            Continue Revision<ArrowRight aria-hidden="true"/>
          </button>
        </div>
        {file && <p className="hero-file"><ShieldCheck aria-hidden="true"/><span><b>{file.name}</b> is loaded and stays on this device.</span></p>}
      </div>

      <aside className="ai-module" aria-label="Local AI status">
        <div className="ai-module-glow" aria-hidden="true"/>
        <div className="ai-module-head">
          <div className="ai-chip" aria-hidden="true"><Cpu/></div>
          <div><span className="eyebrow">Local AI</span><strong>Qwen3 14B</strong></div>
          <Badge tone={engine[0]} title={modelInfo && !modelInfo.loaded ? 'Installed locally; loads into memory on first use' : undefined}>
            <span className={`status-dot ${engine[1]}`} aria-hidden="true"/>{engine[2]}
          </Badge>
        </div>
        <div className="ai-wave" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ '--i': i }}/>)}</div>
        <dl className="ai-specs">
          <div><dt><Cpu aria-hidden="true"/>Runtime</dt><dd>Ollama</dd></div>
          <div><dt><HardDrive aria-hidden="true"/>Processing</dt><dd>Local</dd></div>
          <div><dt><Cloud aria-hidden="true"/>Cloud AI calls</dt><dd className="zero">0</dd></div>
          <div><dt><LockKeyhole aria-hidden="true"/>Storage</dt><dd>SQLite · on-device</dd></div>
        </dl>
        <div className="ai-roles">
          <span>What the open-weight model does here</span>
          <ul>{QWEN_ROLES.map(role => <li key={role}>{role}</li>)}</ul>
        </div>
      </aside>
    </section>

    <RevisionQueue items={queue} limit={4} onPractice={practiceTopic} onFocus={startFocus} busy={busy}/>

    <SessionLauncher file={file} busy={busy} onStart={startSession} onLoadMaterial={() => go('Study Material')}/>

    <section aria-labelledby="pulse-title" className="home-section">
      <div className="mini-head"><h2 id="pulse-title">Learning pulse</h2>{hasHistory && <button className="text-link" onClick={() => go('Progress')}>Full progress<ArrowRight aria-hidden="true"/></button>}</div>
      <div className="stat-grid four">
        <Stat label="Average score" icon={Gauge} tone="cyan" value={summary.average != null ? `${summary.average}%` : '—'} hint={hasHistory ? `${summary.totalAttempts} attempts` : 'Answer a question to start'}/>
        <Stat label="Strongest topic" icon={Trophy} tone="success" value={summary.strongest?.topic || '—'} hint={summary.strongest ? `${summary.strongest.average_score}% average` : 'No data yet'}/>
        <Stat label="Weakest topic" icon={Sparkles} tone="warning" value={summary.weakest?.topic || '—'} hint={summary.weakest ? `${summary.weakest.average_score}% average` : 'No data yet'}/>
        <Stat label="Active misconceptions" icon={AlertTriangle} tone="danger" value={summary.activeMisconceptions ?? '—'} hint="Tracked in Misconception Memory"/>
      </div>
    </section>
  </div>
}
