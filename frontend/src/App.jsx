import { useState } from 'react'
import {
  ArrowRight, BookOpen, BrainCircuit, Check, ChevronRight, FileText, HardDrive,
  LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Target, Upload, WifiOff, X,
} from 'lucide-react'
import { api } from './api'

const tabs = ['Home', 'Analyzer', 'Revision', 'Weakness map']

function Badge({ children }) { return <span className="badge">{children}</span> }

function Empty({ icon: Icon, title, copy }) {
  return <div className="empty"><Icon size={34}/><h3>{title}</h3><p>{copy}</p></div>
}

function App() {
  const [view, setView] = useState('Home')
  const [studentId, setStudentId] = useState('friend01')
  const [file, setFile] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [progress, setProgress] = useState(null)
  const [weakPlan, setWeakPlan] = useState(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  async function run(label, work) {
    setLoading(label); setError('')
    try { return await work() } catch (err) { setError(err.message) }
    finally { setLoading('') }
  }

  async function analyze() {
    if (!file) return setError('Choose a PDF first.')
    const data = await run('Analyzing locally', () => api.analyze(file))
    if (data) { setAnalysis(data); setView('Analyzer') }
  }

  async function startQuiz() {
    if (!file) return setError('Choose a PDF first.')
    const data = await run('Building your question', () => api.quiz(file))
    if (data) { setQuiz(data.quiz); setEvaluation(null); setAnswer(''); setView('Revision') }
  }

  async function submitAnswer() {
    if (!answer.trim()) return setError('Write an answer before submitting.')
    const data = await run('Checking understanding', () => api.evaluate({
      student_id: studentId, topic: quiz.topic, question: quiz.question,
      expected_answer: quiz.expected_answer, student_answer: answer,
    }))
    if (data) setEvaluation(data.evaluation)
  }

  async function nextQuestion() {
    const data = await run('Adapting the next question', () => api.adaptiveQuiz(file, studentId, quiz?.topic))
    if (data) { setQuiz(data.quiz); setEvaluation(null); setAnswer('') }
  }

  async function loadProgress() {
    const data = await run('Loading your learning map', () => api.progress(studentId))
    if (data) { setProgress(data); setWeakPlan(null); setView('Weakness map') }
  }

  async function fixWeakAreas() {
    const data = await run('Creating a focused plan', () => api.fixWeakAreas(studentId))
    if (data) setWeakPlan(data)
  }

  return <div className="app-shell">
    <header>
      <button className="brand" onClick={() => setView('Home')}><ShieldCheck/><span>StudyShield</span></button>
      <nav>{tabs.map(tab => <button className={view === tab ? 'active' : ''} onClick={() => tab === 'Weakness map' ? loadProgress() : setView(tab)} key={tab}>{tab}</button>)}</nav>
      <div className="student"><span>STUDENT</span><input value={studentId} onChange={e => setStudentId(e.target.value)} aria-label="Student ID"/></div>
    </header>

    {error && <div className="error"><X size={18}/><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    {loading && <div className="loading"><RefreshCw size={16}/>{loading}…</div>}

    <main>
      {view === 'Home' && <section className="home">
        <div className="hero-copy">
          <Badge><span className="pulse"/> PRIVATE AI · RUNNING ON YOUR DEVICE</Badge>
          <h1>Your notes.<br/>Your AI. <em>Your device.</em></h1>
          <p className="lede">A thoughtful study coach built for one friend—and private enough for everyone. Upload your material, find the gaps, and revise what actually needs work.</p>
          <div className="actions">
            <label className="button primary"><Upload size={18}/>Choose study material<input type="file" accept="application/pdf" onChange={e => setFile(e.target.files[0])}/></label>
            <button className="button secondary" onClick={loadProgress}>Continue revision<ArrowRight size={18}/></button>
          </div>
          {file && <div className="selected"><FileText/><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · stays on this device</span></div><button onClick={analyze}>Analyze <ChevronRight/></button></div>}
        </div>
        <div className="hero-card">
          <div className="orb"><BrainCircuit size={86}/></div>
          <div className="signal signal-a"/><div className="signal signal-b"/>
          <div className="privacy-card"><LockKeyhole/><div><span>Cloud AI calls</span><strong>0</strong></div><Check/></div>
          <div className="model-card"><span>LOCAL MODEL</span><strong>Qwen3 14B</strong><small>via Ollama</small></div>
        </div>
        <div className="trust-row">
          <div><HardDrive/><strong>Local AI</strong><span>Inference happens on your hardware</span></div>
          <div><LockKeyhole/><strong>Private by design</strong><span>Your notes never leave your device</span></div>
          <div><WifiOff/><strong>Offline-ready</strong><span>Study without a cloud connection</span></div>
        </div>
      </section>}

      {view === 'Analyzer' && <section className="workspace">
        <div className="section-head"><div><Badge>MATERIAL ANALYZER</Badge><h2>Turn pages into a study map.</h2></div><label className="button secondary"><Upload size={17}/>Change PDF<input type="file" accept="application/pdf" onChange={e => setFile(e.target.files[0])}/></label></div>
        {!analysis ? <div className="panel"><Empty icon={FileText} title="No material analyzed yet" copy="Choose a PDF, then let the local model map its topics and difficult areas."/><button className="button primary centered" onClick={analyze}>Analyze locally</button></div> : <>
          <div className="file-strip"><FileText/><div><strong>{analysis.filename}</strong><span>{analysis.characters_extracted.toLocaleString()} characters analyzed locally</span></div><ShieldCheck/></div>
          <div className="analysis-grid">
            <article className="panel wide"><span className="eyebrow">DETECTED TOPICS</span><h2>{analysis.analysis.title}</h2><div className="topic-list">{analysis.analysis.main_topics.map((item, i) => <div className="topic" key={item.topic}><b>{String(i + 1).padStart(2, '0')}</b><div><h3>{item.topic}</h3><p>{item.important_concepts.join(' · ')}</p></div></div>)}</div></article>
            <article className="panel"><span className="eyebrow">REVISION ESSENTIALS</span><ul className="check-list">{analysis.analysis.key_revision_points.map(point => <li key={point}><Check/>{point}</li>)}</ul></article>
            <article className="panel danger"><span className="eyebrow">WATCH THESE AREAS</span>{analysis.analysis.difficult_areas.map(item => <div className="difficult" key={item.concept}><strong>{item.concept}</strong><p>{item.reason}</p></div>)}</article>
          </div>
          <button className="button primary" onClick={startQuiz}>Start revision <ArrowRight/></button>
        </>}
      </section>}

      {view === 'Revision' && <section className="workspace narrow">
        <div className="section-head"><div><Badge>REVISION ARENA</Badge><h2>Explain it in your own words.</h2></div></div>
        {!quiz ? <div className="panel"><Empty icon={BookOpen} title="Ready when you are" copy="Select study material to generate your first understanding-based question."/><label className="button secondary centered"><Upload/>Choose PDF<input type="file" accept="application/pdf" onChange={e => setFile(e.target.files[0])}/></label><button className="button primary centered" onClick={startQuiz}>Test me</button></div> : <div className="quiz-layout">
          <article className="panel question-card"><div className="quiz-meta"><Badge>{quiz.topic}</Badge><span className={`difficulty ${quiz.difficulty.toLowerCase()}`}>{quiz.difficulty}</span></div><h2>{quiz.question}</h2><label>Your answer<textarea rows="7" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Focus on the idea, not perfect wording…" disabled={!!evaluation}/></label>{!evaluation && <button className="button primary" onClick={submitAnswer}>Check my understanding <ArrowRight/></button>}</article>
          {evaluation && <article className={`panel result ${evaluation.status.toLowerCase().replace(' ', '-')}`}><div className="score"><span>{evaluation.score}</span><small>/100</small></div><Badge>{evaluation.status}</Badge><p>{evaluation.feedback}</p><div className="feedback-list good"><strong>What landed</strong>{evaluation.correct_points.map(p => <span key={p}><Check/>{p}</span>)}</div><div className="feedback-list missing"><strong>What to revisit</strong>{evaluation.missing_points.map(p => <span key={p}><Target/>{p}</span>)}</div><button className="button primary" onClick={nextQuestion}>Next adaptive question <ArrowRight/></button></article>}
        </div>}
      </section>}

      {view === 'Weakness map' && <section className="workspace">
        <div className="section-head"><div><Badge>WEAKNESS MAP</Badge><h2>Spend effort where it matters.</h2></div><button className="button secondary" onClick={loadProgress}><RefreshCw/>Refresh</button></div>
        {!progress?.attempts ? <div className="panel"><Empty icon={Target} title="Your map is still blank" copy="Complete a revision question and your topic performance will appear here."/></div> : <>
          <div className="stats"><div><span>ATTEMPTS</span><strong>{progress.attempts}</strong></div><div><span>TOPICS PRACTISED</span><strong>{progress.topic_statistics.length}</strong></div><div><span>LOCAL RECORDS</span><strong>100%</strong></div></div>
          <article className="panel"><span className="eyebrow">TOPIC PERFORMANCE</span><div className="bars">{progress.topic_statistics.map(item => <div className="bar-row" key={item.topic}><div><strong>{item.topic}</strong><span>{item.attempts} attempt{item.attempts > 1 ? 's' : ''}</span></div><div className="track"><span style={{width: `${item.average_score}%`}}/></div><b>{item.average_score}%</b></div>)}</div></article>
          <button className="button primary fix" onClick={fixWeakAreas}><Sparkles/>Fix my weak areas</button>
          {weakPlan && <div className="plan-grid">{weakPlan.weak_topics.length ? weakPlan.weak_topics.map(item => <article className="panel plan" key={item.topic}><div><Badge>{item.priority} priority</Badge><strong>{item.average_score}%</strong></div><h3>{item.topic}</h3><p>{item.why_weak}</p><h4>Quick explanation</h4><p>{item.mini_explanation}</p><h4>Revision plan</h4><ol>{item.revision_plan.map(step => <li key={step}>{step}</li>)}</ol><div className="practice"><Target/><span>{item.practice_question}</span></div></article>) : <div className="panel"><Empty icon={ShieldCheck} title="No weak topics right now" copy="Every tracked topic is currently at 85% or above."/></div>}</div>}
        </>}
      </section>}
    </main>
    <footer><span><ShieldCheck/>StudyShield</span><p>Built for a friend · Powered by open models · Private by design</p><small>Qwen3 14B / Ollama</small></footer>
  </div>
}

export default App
