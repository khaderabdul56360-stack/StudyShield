import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, BookOpen, FileText, GitFork, Home as HomeIcon, LockKeyhole, MoreHorizontal,
  RefreshCw, ShieldCheck, Target, X,
} from 'lucide-react'
import { api } from './api'
import { ErrorCard, Thinking } from './components/ui'
import { summarize } from './lib/metrics'
import Home from './screens/Home'
import StudyMaterial from './screens/StudyMaterial'
import RevisionArena from './screens/RevisionArena'
import ConceptGraph from './screens/ConceptGraph'
import Progress from './screens/Progress'
import WeakAreas from './screens/WeakAreas'
import Misconceptions from './screens/Misconceptions'

const tabs = [
  ['Home', HomeIcon, 'Home'], ['Study Material', FileText, 'Material'], ['Revision Arena', BookOpen, 'Arena'],
  ['Concept Graph', GitFork, 'Graph'], ['Progress', BarChart3, 'Progress'], ['Weak Areas', Target, 'Weak'],
  ['Misconceptions', AlertTriangle, 'Myths'],
]
const MOBILE_PRIMARY = ['Home', 'Study Material', 'Revision Arena', 'Progress']
const LEARNING_VIEWS = ['Progress', 'Weak Areas', 'Misconceptions']

const HEALTH_TIMEOUT_MS = 6000
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MODEL_DOWN = /ollama|local model .* is unavailable|not installed|ollama pull/i

const STEPS = {
  analyze: ['Extracting notes', 'Analyzing concepts', 'Finding difficult areas'],
  quiz: ['Reading your material', 'Writing an understanding question'],
  next: ['Reviewing your history', 'Choosing a target topic', 'Writing a question'],
  evaluate: ['Comparing key ideas', 'Checking for misconceptions', 'Saving progress locally'],
  graph: ['Extracting notes', 'Mapping concepts', 'Linking prerequisites'],
  plan: ['Reading attempt history', 'Building revision plan'],
}

const screens = {
  Home, 'Study Material': StudyMaterial, 'Revision Arena': RevisionArena, 'Concept Graph': ConceptGraph,
  Progress, 'Weak Areas': WeakAreas, Misconceptions,
}

function App() {
  const [view, setView] = useState('Home')
  const [studentId, setStudentId] = useState('friend01')
  const [file, setFile] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [selectionReason, setSelectionReason] = useState('')
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [recorded, setRecorded] = useState([])
  const [confidence, setConfidence] = useState('medium')
  const [progress, setProgress] = useState(null)
  const [weakPlan, setWeakPlan] = useState(null)
  const [misconceptions, setMisconceptions] = useState(null)
  const [conceptGraph, setConceptGraph] = useState(null)
  const [selectedConcept, setSelectedConcept] = useState(null)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [backendOnline, setBackendOnline] = useState(null)
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  // 'unknown' until a real model call succeeds or fails; /health only proves FastAPI is up.
  const [modelStatus, setModelStatus] = useState('unknown')
  const retryRef = useRef(null)
  const loadedStudent = useRef(studentId)
  const studentRef = useRef(studentId)
  const busyRef = useRef(false)
  const fileRef = useRef(null)
  const healthSeq = useRef(0)

  function checkHealth() {
    const seq = ++healthSeq.current
    setBackendOnline(null)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS))
    // Only the latest check may update the pill, so overlapping checks (StrictMode, rapid clicks) can't race.
    return Promise.race([api.health(), timeout])
      .then(() => { if (seq === healthSeq.current) setBackendOnline(true) })
      .catch(() => { if (seq === healthSeq.current) setBackendOnline(false) })
  }

  useEffect(() => {
    checkHealth()
    Promise.all([api.progress(studentId), api.misconceptions(studentId)]).then(([p, m]) => {
      setProgress(p); setMisconceptions(m); setLearningLoaded(true)
    }).catch(() => {})
  }, [])

  // One delegated listener powers every spotlight card instead of a handler per component.
  useEffect(() => {
    let frame = 0
    function move(event) {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const target = event.target.closest?.('.spot, .spot-hero')
        if (!target) return
        const rect = target.getBoundingClientRect()
        target.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        target.style.setProperty('--my', `${event.clientY - rect.top}px`)
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => { window.removeEventListener('pointermove', move); cancelAnimationFrame(frame) }
  }, [])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); setMoreOpen(false) }, [view])

  // `onDone` lives inside run so that Retry replays the request *and* applies its result.
  async function run(kind, label, work, onDone) {
    // Synchronous lock: state updates are async, so a fast double-click or Ctrl+Enter could slip past `task`.
    if (busyRef.current) return undefined
    busyRef.current = true
    retryRef.current = () => run(kind, label, work, onDone)
    setTask({ kind, label, steps: STEPS[kind] }); setError('')
    try {
      const result = await work()
      healthSeq.current += 1
      setBackendOnline(true)
      if (kind !== 'learning') setModelStatus('ok')
      onDone?.(result)
      return result
    } catch (err) {
      if (/could not reach the local backend/i.test(err.message)) { healthSeq.current += 1; setBackendOnline(false) }
      if (MODEL_DOWN.test(err.message)) setModelStatus('down')
      setError(err.message)
    } finally { busyRef.current = false; setTask(null) }
  }

  function fail(message) { retryRef.current = null; setError(message) }

  function acceptFile(nextFile, openMaterial = false) {
    if (!nextFile) return
    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) {
      fail('Choose a PDF file to study.')
      return
    }
    if (nextFile.size > MAX_PDF_BYTES) {
      fail('PDF exceeds the 20 MB upload limit.')
      return
    }
    if (nextFile !== file) { setAnalysis(null); setConceptGraph(null); setSelectedConcept(null) }
    fileRef.current = nextFile
    setFile(nextFile); setError('')
    if (openMaterial) setView('Study Material')
  }

  function refreshLearning(quiet = false) {
    const target = studentRef.current
    const load = async () => {
      const [progressData, misconceptionData] = await Promise.all([
        api.progress(target), api.misconceptions(target),
      ])
      return { progressData, misconceptionData }
    }
    const apply = data => {
      // Ignore a response for a student ID that was replaced while the request was in flight.
      if (target !== studentRef.current) return
      setProgress(data.progressData)
      setMisconceptions(data.misconceptionData)
      setLearningLoaded(true)
      loadedStudent.current = target
    }
    return quiet ? load().then(apply).catch(() => {}) : run('learning', 'Loading your learning map', load, apply)
  }

  function analyze() {
    if (!file) return fail('Choose a PDF first.')
    const target = file
    return run('analyze', 'Analyzing your material', () => api.analyze(target), data => {
      if (fileRef.current === target) { setAnalysis(data); setView('Study Material') }
    })
  }

  function showQuiz(data) {
    setQuiz(data.quiz); setSelectionReason(data.selection_reason || '')
    setEvaluation(null); setRecorded([]); setAnswer(''); setConfidence('medium')
    setView('Revision Arena')
  }

  function startQuiz() {
    if (!file) return fail('Choose a PDF first.')
    return run('quiz', 'Building your question', () => api.quiz(file), showQuiz)
  }

  function testMe() {
    if (!file) return fail('Choose a PDF first.')
    return run('next', 'Targeting your gaps', () => api.adaptiveQuiz(file, studentId), showQuiz)
  }

  function submitAnswer() {
    if (!answer.trim()) return fail('Write an answer before submitting.')
    const payload = {
      student_id: studentId, topic: quiz.topic, question: quiz.question,
      expected_answer: quiz.expected_answer, student_answer: answer, confidence,
    }
    return run('evaluate', 'Checking understanding', () => api.evaluate(payload), data => {
      setEvaluation(data.evaluation)
      setRecorded(data.misconceptions_recorded || [])
      setSessionCount(count => count + 1)
      refreshLearning(true)
    })
  }

  function nextQuestion() {
    if (!file) return fail('Choose a PDF first.')
    return run('next', 'Adapting the next question', () => api.adaptiveQuiz(file, studentId, quiz?.topic), showQuiz)
  }

  function fixWeakAreas() {
    return run('plan', 'Creating a focused plan', () => api.fixWeakAreas(studentId), setWeakPlan)
  }

  function buildConceptGraph() {
    if (!file) return fail('Choose a PDF first.')
    const target = file
    const student = studentRef.current
    return run('graph', 'Mapping concept relationships', () => api.conceptGraph(target, student), data => {
      if (fileRef.current !== target || studentRef.current !== student) return
      setConceptGraph(data)
      setSelectedConcept(data.concepts[0] || null)
      setView('Concept Graph')
    })
  }

  function practiceTopic(topic) {
    if (!file) return fail('Choose the original study PDF before practising this topic.')
    return run('next', `Building practice for ${topic}`, () => api.adaptiveQuiz(file, studentId, topic), showQuiz)
  }

  function go(tab) {
    setView(tab)
    if (LEARNING_VIEWS.includes(tab) && !busyRef.current) refreshLearning()
  }

  function commitStudent() {
    const trimmed = studentId.trim()
    if (!trimmed) { setStudentId(loadedStudent.current); return }
    if (trimmed !== studentId) setStudentId(trimmed)
    studentRef.current = trimmed
    if (trimmed !== loadedStudent.current) {
      // Score overlays and plans belong to the previous student, so drop them rather than mislabel them.
      setWeakPlan(null); setConceptGraph(null); setSelectedConcept(null); setLearningLoaded(false)
      refreshLearning()
    }
  }

  const summary = useMemo(() => summarize(progress, misconceptions), [progress, misconceptions])
  const activeIndex = tabs.findIndex(([tab]) => tab === view)
  const Screen = screens[view]
  const ctx = {
    view, go, studentId, file, analysis, quiz, selectionReason, answer, setAnswer, evaluation, recorded,
    confidence, setConfidence, progress, misconceptions, weakPlan, conceptGraph, selectedConcept,
    setSelectedConcept, task, backendOnline, modelStatus, summary, learningLoaded, sessionCount,
    onPickFile: acceptFile, analyze, startQuiz, testMe, submitAnswer, nextQuestion, fixWeakAreas,
    buildConceptGraph, practiceTopic, refreshLearning: () => refreshLearning(),
  }
  const statusLabel = backendOnline ? 'Connected' : backendOnline === false ? 'Disconnected' : 'Checking…'
  const statusClass = backendOnline ? 'online' : backendOnline === false ? 'offline' : ''

  return <div className="app-shell">
    <div className="backdrop" aria-hidden="true"><div className="grid"/><div className="orb orb-a"/><div className="orb orb-b"/><div className="orb orb-c"/><div className="noise"/></div>
    <a className="skip-link" href="#main">Skip to content</a>

    <aside className="sidebar">
      <button className="brand" onClick={() => go('Home')} aria-label="StudyShield home">
        <span className="brand-mark" aria-hidden="true"><ShieldCheck/></span>
        <span className="brand-text">StudyShield<small>Local learning OS</small></span>
      </button>
      <nav aria-label="Main navigation" className="side-nav" style={{ '--active': activeIndex }}>
        <span className="nav-pill" aria-hidden="true"/>
        {tabs.map(([tab, Icon]) => <button className={view === tab ? 'active' : ''} aria-current={view === tab ? 'page' : undefined} onClick={() => go(tab)} key={tab} title={tab}>
          <Icon aria-hidden="true"/><span>{tab}</span>
          {tab === 'Misconceptions' && misconceptions?.active > 0 && <b className="nav-count" aria-label={`${misconceptions.active} active`}>{misconceptions.active}</b>}
        </button>)}
      </nav>
      <div className="ai-dock">
        <div className="ai-dock-head"><span className={`status-dot ${statusClass}`} aria-hidden="true"/><strong>Local AI</strong><span className="ai-dock-state">{task && task.kind !== 'learning' ? 'Busy' : backendOnline === false ? 'Offline' : modelStatus === 'down' ? 'No model' : backendOnline ? 'Ready' : '…'}</span></div>
        <div className="ai-dock-bars" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <i key={i} style={{ '--i': i }} className={task && task.kind !== 'learning' ? 'busy' : ''}/>)}</div>
        <small>Qwen3 14B · Ollama</small>
        <small>{task && task.kind !== 'learning' ? 'Thinking locally…' : 'Private · 0 cloud calls'}</small>
        {modelStatus === 'down' && backendOnline !== false && <small className="dock-warn">Ollama or model unavailable</small>}
        {backendOnline === false && <button className="text-link" onClick={checkHealth}><RefreshCw aria-hidden="true"/>Reconnect</button>}
      </div>
    </aside>

    <header className="topbar">
      <button className="brand compact" onClick={() => go('Home')} aria-label="StudyShield home"><span className="brand-mark" aria-hidden="true"><ShieldCheck/></span></button>
      <div className="topbar-title">
        <span className="crumb">StudyShield /</span><strong>{view}</strong>
        {(file || sessionCount > 0) && <span className="session-chip" title={file?.name}>
          {file && <><FileText aria-hidden="true"/><span className="session-file">{file.name}</span></>}
          {sessionCount > 0 && <span className="session-count">{sessionCount} answered</span>}
        </span>}
      </div>
      <div className="top-actions">
        <button className={`conn-pill ${statusClass}`} onClick={checkHealth} title="Check backend connection">
          <span className={`status-dot ${statusClass}`} aria-hidden="true"/><span className="conn-label">{statusLabel}</span>
        </button>
        <span className="model-pill" title="Local model via Ollama"><span className="model-glyph" aria-hidden="true">Q</span>Qwen3 14B<small>Ollama</small></span>
        <span className="private-pill"><LockKeyhole aria-hidden="true"/><span>Local &amp; private</span></span>
        <label className="student">
          <span>Student</span>
          <input value={studentId} onChange={e => setStudentId(e.target.value)} onBlur={commitStudent}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} aria-label="Student ID" spellCheck={false}/>
        </label>
      </div>
    </header>

    <main id="main" tabIndex={-1}>
      <div className="feedback-stack">
        {task && task.kind !== 'learning' && <Thinking task={task}/>}
        <ErrorCard message={error} onRetry={retryRef.current ? () => retryRef.current() : null} onDismiss={() => setError('')}/>
      </div>
      <div className="route" key={view}><Screen ctx={ctx}/></div>
    </main>

    <nav className="mobile-nav" aria-label="Mobile navigation">
      {tabs.filter(([tab]) => MOBILE_PRIMARY.includes(tab)).map(([tab, Icon, short]) => <button className={view === tab ? 'active' : ''} aria-current={view === tab ? 'page' : undefined} onClick={() => go(tab)} key={tab}>
        <Icon aria-hidden="true"/><span>{short}</span>
      </button>)}
      <button className={!MOBILE_PRIMARY.includes(view) ? 'active' : ''} aria-expanded={moreOpen} aria-controls="more-sheet" onClick={() => setMoreOpen(open => !open)}>
        {moreOpen ? <X aria-hidden="true"/> : <MoreHorizontal aria-hidden="true"/>}<span>More</span>
        {misconceptions?.active > 0 && <b className="nav-count" aria-hidden="true">{misconceptions.active}</b>}
      </button>
    </nav>
    {moreOpen && <>
      <button className="sheet-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)}/>
      <div className="more-sheet" id="more-sheet" role="menu">
        {tabs.filter(([tab]) => !MOBILE_PRIMARY.includes(tab)).map(([tab, Icon]) => <button role="menuitem" className={view === tab ? 'active' : ''} onClick={() => go(tab)} key={tab}>
          <Icon aria-hidden="true"/><span>{tab}</span>
          {tab === 'Misconceptions' && misconceptions?.active > 0 && <b className="nav-count">{misconceptions.active}</b>}
        </button>)}
      </div>
    </>}
  </div>
}

export default App
