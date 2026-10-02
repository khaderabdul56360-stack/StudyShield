import {
  AlertTriangle, ArrowRight, Cloud, Cpu, Gauge, HardDrive, LockKeyhole, Repeat2, ShieldCheck,
  Sparkles, Trophy, Upload, WifiOff,
} from 'lucide-react'
import { Badge, Stat } from '../components/ui'

const features = [
  { icon: LockKeyhole, tone: 'cyan', title: 'Private', copy: 'Your PDFs, answers and mistakes stay in a local SQLite file. Nothing is sent to a cloud AI.' },
  { icon: Repeat2, tone: 'violet', title: 'Adaptive', copy: 'Every answer reshapes the next question — difficulty, topic and misconceptions included.' },
  { icon: WifiOff, tone: 'success', title: 'Offline-ready', copy: 'Qwen3 14B runs through Ollama on this machine. Revise on a train, in a library, anywhere.' },
]

export default function Home({ ctx }) {
  const { summary, backendOnline, modelStatus, file, onPickFile, go } = ctx
  // /health proves the API is up; the model itself is only confirmed by a real inference call.
  const engine = backendOnline === false ? ['danger', 'offline', 'API offline']
    : backendOnline === null ? ['neutral', '', 'Checking']
      : modelStatus === 'down' ? ['warning', 'offline', 'Model unavailable']
        : modelStatus === 'ok' ? ['success', 'online', 'Ready'] : ['cyan', 'online', 'Standby']
  const hasHistory = summary.totalAttempts > 0
  return <div className="home">
    <section className="hero spot-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <Badge tone="cyan" className="hero-badge"><span className="live-dot" aria-hidden="true"/>Private AI · running on your device</Badge>
        <h1 id="hero-title">Your notes.<br/>Your AI.<br/><span className="gradient-text">Your device.</span></h1>
        <p className="lede">Private, adaptive revision powered entirely by local open-source AI.</p>
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
          <div><span className="eyebrow">Local engine</span><strong>Qwen3 14B</strong></div>
          <Badge tone={engine[0]} title={modelStatus === 'unknown' ? 'API is up; the model is confirmed on the first AI request' : undefined}>
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
      </aside>
    </section>

    <section aria-labelledby="pulse-title" className="home-section">
      <div className="mini-head"><h2 id="pulse-title">Learning pulse</h2>{hasHistory && <button className="text-link" onClick={() => go('Progress')}>Full progress<ArrowRight aria-hidden="true"/></button>}</div>
      <div className="stat-grid four">
        <Stat label="Average score" icon={Gauge} tone="cyan" value={summary.average != null ? `${summary.average}%` : '—'} hint={hasHistory ? `${summary.totalAttempts} attempts` : 'Answer a question to start'}/>
        <Stat label="Strongest topic" icon={Trophy} tone="success" value={summary.strongest?.topic || '—'} hint={summary.strongest ? `${summary.strongest.average_score}% average` : 'No data yet'}/>
        <Stat label="Weakest topic" icon={Sparkles} tone="warning" value={summary.weakest?.topic || '—'} hint={summary.weakest ? `${summary.weakest.average_score}% average` : 'No data yet'}/>
        <Stat label="Active misconceptions" icon={AlertTriangle} tone="danger" value={summary.activeMisconceptions ?? '—'} hint="Tracked in Misconception Memory"/>
      </div>
    </section>

    <section aria-label="Why StudyShield" className="feature-grid">
      {features.map(({ icon: Icon, tone, title, copy }) => <article className={`feature-card spot tone-${tone}`} key={title}>
        <div className="feature-icon" aria-hidden="true"><Icon/></div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </article>)}
    </section>
  </div>
}
