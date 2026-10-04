import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, BookOpen, FileText, GitFork, Home as HomeIcon, LockKeyhole, MoreHorizontal,
  RefreshCw, ShieldCheck, Target, X,
} from 'lucide-react'
import { api } from './api'
import { ErrorCard, Thinking } from './components/ui'
import { summarize } from './lib/metrics'
import {
  forgetMaterial, loadDurations, loadMaterial, loadSnapshot, saveDurations, saveMaterial, saveSnapshot,
} from './lib/persistence'
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
// Task kinds that never call the local model, so they show no "Thinking with Qwen3" card.
const LOCAL_ONLY_TASKS = ['learning', 'summary']

const HEALTH_TIMEOUT_MS = 6000
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MODEL_DOWN = /ollama|local model .* is unavailable|not installed|ollama pull/i
const FOCUS_QUESTIONS = 3

const STEPS = {
  analyze: ['Extracting notes', 'Analyzing concepts', 'Finding difficult areas'],
  quiz: ['Reading your material', 'Building your next question'],
  next: ['Reviewing your learning profile', 'Choosing the next topic', 'Building your next question'],
  evaluate: ['Checking your answer', 'Looking for misconceptions', 'Updating your learning profile'],
  exam: ['Checking your answer', 'Updating your learning profile', 'Building your next question'],
  explain: ['Reading your answer', 'Writing the explanation'],
  graph: ['Extracting notes', 'Mapping concepts', 'Linking prerequisites'],
  plan: ['Reading attempt history', 'Building revision plan'],
}
const EXPLAIN_LABELS = {
  simpler: 'Creating a simpler explanation', steps: 'Creating a step-by-step explanation',
  example: 'Creating a worked example', analogy: 'Creating an analogy',
}

const screens = {
  Home, 'Study Material': StudyMaterial, 'Revision Arena': RevisionArena, 'Concept Graph': ConceptGraph,
  Progress, 'Weak Areas': WeakAreas, Misconceptions,
}

// One ID per generated question; a retried submission reuses it so the API never saves a duplicate attempt.
function requestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function sessionQuestionOptions(session) {
  if (session.mode === 'focus') return { topic: session.topic, focus: true }
  // Exam Mode spreads questions across topics; Quick Revision keeps re-targeting the current weakest point.
  if (session.mode === 'exam') return { scope: session.scope === 'weak' ? 'weak' : 'all', avoid: session.results.map(r => r.topic) }
  return { scope: session.scope }
}

function App() {
  // Resume where the student left off: student ID, running session and current question (see lib/persistence).
  const [initial] = useState(() => loadSnapshot() || {})
  const [view, setView] = useState('Home')
  const [studentId, setStudentId] = useState(initial.studentId || 'friend01')
  // The ID actually in use (studentId also changes on every keystroke while typing).
  const [committedStudent, setCommittedStudent] = useState(studentId)
  const [file, setFile] = useState(null)
  const [restoredMaterial, setRestoredMaterial] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [quiz, setQuiz] = useState(initial.quiz || null)
  const [selectionReason, setSelectionReason] = useState(initial.selectionReason || '')
  const [answer, setAnswer] = useState(initial.answer || '')
  const [evaluation, setEvaluation] = useState(initial.evaluation || null)
  const [recorded, setRecorded] = useState(initial.recorded || [])
  const [confidence, setConfidence] = useState(initial.confidence || 'medium')
  const [explanations, setExplanations] = useState(initial.explanations || {})
  const [progress, setProgress] = useState(null)
  const [weakPlan, setWeakPlan] = useState(null)
  const [misconceptions, setMisconceptions] = useState(null)
  const [queue, setQueue] = useState(null)
  const [conceptGraph, setConceptGraph] = useState(null)
  const [selectedConcept, setSelectedConcept] = useState(null)
  const [session, setSession] = useState(initial.session || null)
  const [task, setTask] = useState(null)
  const [error, setError] = useState('')
  const [backendOnline, setBackendOnline] = useState(null)
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [moreOpen, setMoreOpen] = useState(false)
  // 'unknown' until a real model call succeeds or fails; /health only proves FastAPI is up.
  const [modelStatus, setModelStatus] = useState('unknown')
  // From GET /model-status: is Ollama up, is Qwen installed, is it already loaded in memory?
  const [modelInfo, setModelInfo] = useState(null)
  const retryRef = useRef(null)
  const loadedStudent = useRef(studentId)
  const studentRef = useRef(studentId)
  const durationsRef = useRef(loadDurations())
  const busyRef = useRef(false)
  const fileRef = useRef(null)
  const healthSeq = useRef(0)
  // Session state is read inside async work (and on Retry), so keep a ref that is always current.
  const sessionRef = useRef(initial.session || null)
  const quizRef = useRef(initial.quiz || null)

  function updateSession(next) { sessionRef.current = next; setSession(next) }

  function checkHealth() {
    const seq = ++healthSeq.current
    setBackendOnline(null)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS))
    // Only the latest check may update the pill, so overlapping checks (StrictMode, rapid clicks) can't race.
    return Promise.race([api.health(), timeout])
      .then(() => { if (seq === healthSeq.current) setBackendOnline(true) })
      .then(checkModel)
      .catch(() => { if (seq === healthSeq.current) setBackendOnline(false) })
  }

  // Read-only readiness check against local Ollama; it never runs inference.
  function checkModel() {
    return api.modelStatus().then(info => {
      setModelInfo(info)
      setModelStatus(info.ollama && info.installed ? 'ok' : 'down')
    }).catch(() => {})
  }

  useEffect(() => {
    checkHealth()
    refreshLearning(true)
    loadMaterial().then(record => {
      if (!record || fileRef.current) return
      fileRef.current = record.file
      setFile(record.file); setAnalysis(record.analysis); setRestoredMaterial(true)
      refreshLearning(true)
    })
  }, [])

  useEffect(() => {
    saveSnapshot({ studentId: committedStudent, session, quiz, selectionReason, answer, evaluation, recorded, confidence, explanations })
  }, [committedStudent, session, quiz, selectionReason, answer, evaluation, recorded, confidence, explanations])

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
  async function run(kind, label, work, onDone, steps = STEPS[kind]) {
    // Synchronous lock: state updates are async, so a fast double-click or Ctrl+Enter could slip past `task`.
    if (busyRef.current) return undefined
    busyRef.current = true
    retryRef.current = () => run(kind, label, work, onDone, steps)
    setTask({ kind, label, steps, previous: durationsRef.current[kind] }); setError('')
    const started = performance.now()
    try {
      const result = await work()
      healthSeq.current += 1
      setBackendOnline(true)
      if (!LOCAL_ONLY_TASKS.includes(kind)) {
        setModelStatus('ok')
        setModelInfo(info => ({ ...info, ollama: true, installed: true, loaded: true }))
        durationsRef.current = { ...durationsRef.current, [kind]: Math.round((performance.now() - started) / 1000) }
        saveDurations(durationsRef.current)
      }
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
    if (nextFile !== file) {
      setAnalysis(null); setConceptGraph(null); setSelectedConcept(null)
      saveMaterial(nextFile)
    }
    fileRef.current = nextFile
    setFile(nextFile); setError(''); setRestoredMaterial(false)
    refreshLearning(true)
    if (openMaterial) setView('Study Material')
  }

  function refreshLearning(quiet = false) {
    const target = studentRef.current
    const load = async () => {
      const [progressData, misconceptionData, queueData] = await Promise.all([
        api.progress(target), api.misconceptions(target), api.revisionQueue(target, fileRef.current),
      ])
      return { progressData, misconceptionData, queueData }
    }
    const apply = data => {
      // Ignore a response for a student ID that was replaced while the request was in flight.
      if (target !== studentRef.current) return
      setProgress(data.progressData)
      setMisconceptions(data.misconceptionData)
      setQueue(data.queueData.queue)
      setLearningLoaded(true)
      loadedStudent.current = target
    }
    return quiet ? load().then(apply).catch(() => {}) : run('learning', 'Loading your learning map', load, apply)
  }

  function analyze() {
    if (!file) return fail('Choose a PDF first.')
    const target = file
    return run('analyze', 'Analyzing your material', () => api.analyze(target), data => {
      if (fileRef.current === target) { setAnalysis(data); setView('Study Material'); saveMaterial(target, data) }
    })
  }

  function forgetStudyMaterial() {
    forgetMaterial()
    fileRef.current = null; quizRef.current = null
    setFile(null); setAnalysis(null); setConceptGraph(null); setSelectedConcept(null); setRestoredMaterial(false)
    updateSession(null); setQuiz(null); setEvaluation(null)
    refreshLearning(true)
  }

  function showQuiz(data) {
    const next = { ...data.quiz, request_id: requestId() }
    quizRef.current = next
    setQuiz(next); setSelectionReason(data.selection_reason || '')
    setEvaluation(null); setRecorded([]); setAnswer(''); setConfidence('medium'); setExplanations({})
    setView('Revision Arena')
  }

  function startQuiz() {
    if (!file) return fail('Choose a PDF first.')
    updateSession(null)
    return run('quiz', 'Building your next question', () => api.quiz(file), showQuiz)
  }

  function testMe() {
    if (!file) return fail('Choose a PDF first.')
    updateSession(null)
    return run('next', 'Building your next question', () => api.adaptiveQuiz(file, studentId), showQuiz)
  }

  // --- Sessions: Quick Revision (learn), Focus Session (one topic) and Exam Mode (test) -------------------
  // Questions are generated one at a time, after the previous answer is saved, so each pick sees the
  // updated student model. Retrying a failed step replays the same question index.
  function requestSessionQuestion() {
    const current = sessionRef.current
    const target = fileRef.current
    if (!current || !target) return fail('Choose a PDF first.')
    const number = current.results.length + 1
    return run('next', `Building question ${number} of ${current.total}`,
      () => api.adaptiveQuiz(target, studentRef.current, sessionQuestionOptions(current)), showQuiz)
  }

  function startSession(mode, { total, scope = 'adaptive', topic } = {}) {
    if (!fileRef.current) return fail('Choose a PDF first.')
    if (busyRef.current) return undefined
    updateSession({ mode, total: mode === 'focus' ? FOCUS_QUESTIONS : total, scope, topic, results: [], status: 'running' })
    setQuiz(null); setEvaluation(null)
    setView('Revision Arena')
    return requestSessionQuestion()
  }

  function startFocus(topic) { return startSession('focus', { topic }) }

  function recordResult(data, topic) {
    const current = sessionRef.current
    if (!current || current.results.some(item => item.attempt_id === data.attempt_id)) return
    updateSession({ ...current, results: [...current.results, {
      attempt_id: data.attempt_id, topic, score: data.evaluation.score, status: data.evaluation.status,
      confidence_insight: data.evaluation.confidence_insight,
    }] })
  }

  function finishSession() {
    const current = sessionRef.current
    if (!current) return undefined
    if (!current.results.length) { updateSession(null); setQuiz(null); quizRef.current = null; return undefined }
    const ids = current.results.map(item => item.attempt_id)
    return run('summary', 'Summarising your session', () => Promise.all([
      api.sessionSummary(studentRef.current, ids), api.revisionQueue(studentRef.current, fileRef.current),
    ]), ([summary, queueData]) => {
      updateSession({ ...current, status: 'complete', summary, reviseNext: queueData.queue.slice(0, 3) })
      setQueue(queueData.queue)
      // Exam Mode skips refreshes while answering (no result may leak, e.g. via the misconception badge).
      refreshLearning(true)
      setQuiz(null); setEvaluation(null)
      setView('Revision Arena')
    })
  }

  function sessionNext() {
    const current = sessionRef.current
    if (!current) return undefined
    if (current.results.length >= current.total) return finishSession()
    return requestSessionQuestion()
  }

  function keepPractising() {
    const current = sessionRef.current
    if (!current) return undefined
    const next = { ...current, goalAcknowledged: true, total: Math.max(current.total, current.results.length + 1) }
    updateSession(next)
    return requestSessionQuestion()
  }

  function closeSession(nextView) {
    updateSession(null); setQuiz(null); setEvaluation(null)
    if (nextView) go(nextView)
  }

  function restartSession() {
    const current = sessionRef.current
    if (!current) return undefined
    return startSession(current.mode, { total: current.total, scope: current.scope, topic: current.topic })
  }

  function submitAnswer() {
    if (!answer.trim()) return fail('Write an answer before submitting.')
    const payload = {
      student_id: studentId, topic: quiz.topic, question: quiz.question, expected_answer: quiz.expected_answer,
      student_answer: answer, confidence, difficulty: quiz.difficulty, request_id: quiz.request_id,
    }
    const exam = sessionRef.current?.mode === 'exam'
    const target = fileRef.current
    // Exam Mode hides feedback: evaluate, save, and move straight on. Each step is safe to retry because
    // the evaluation is idempotent (request_id) and results are de-duplicated by attempt ID.
    const work = async () => {
      const data = await api.evaluate(payload)
      recordResult(data, payload.topic)
      if (!exam) return { data }
      const current = sessionRef.current
      if (current.results.length >= current.total) return { data, done: true }
      return { data, next: await api.adaptiveQuiz(target, studentRef.current, sessionQuestionOptions(current)) }
    }
    const label = exam ? 'Saving your answer' : 'Checking your answer'
    return run(exam ? 'exam' : 'evaluate', label, work, ({ data, next, done }) => {
      setSessionCount(count => count + 1)
      if (!exam) {
        refreshLearning(true)
        setEvaluation(data.evaluation)
        setRecorded(data.misconceptions_recorded || [])
        return
      }
      if (next) showQuiz(next)
      // Defer so the run lock from this task is released before the summary task starts.
      if (done) setTimeout(finishSession, 0)
    })
  }

  function explain(style) {
    if (!quiz || !evaluation || explanations[style]) return undefined
    const question = quiz
    const payload = {
      topic: quiz.topic, question: quiz.question, expected_answer: quiz.expected_answer,
      student_answer: answer, style,
    }
    return run('explain', EXPLAIN_LABELS[style], () => api.explain(payload), data => {
      // Drop a late answer if the student has already moved to another question.
      if (quizRef.current === question) setExplanations(previous => ({ ...previous, [style]: data.explanation }))
    })
  }

  function nextQuestion() {
    if (!file) return fail('Choose a PDF first.')
    if (sessionRef.current) return sessionNext()
    return run('next', 'Building your next question', () => api.adaptiveQuiz(file, studentId, { topic: quiz?.topic }), showQuiz)
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
      refreshLearning(true)
    })
  }

  function practiceTopic(topic) {
    if (!file) return fail('Choose the original study PDF before practising this topic.')
    updateSession(null)
    return run('next', `Building practice for ${topic}`, () => api.adaptiveQuiz(file, studentId, { topic, focus: true }), showQuiz)
  }

  function go(tab) {
    setView(tab)
    if (LEARNING_VIEWS.includes(tab) && !busyRef.current) refreshLearning()
    else if (tab === 'Home') refreshLearning(true)
  }

  function commitStudent() {
    const trimmed = studentId.trim()
    if (!trimmed) { setStudentId(loadedStudent.current); return }
    if (trimmed !== studentId) setStudentId(trimmed)
    studentRef.current = trimmed
    setCommittedStudent(trimmed)
    if (trimmed !== loadedStudent.current) {
      // Score overlays, plans and sessions belong to the previous student, so drop them rather than mislabel them.
      setWeakPlan(null); setConceptGraph(null); setSelectedConcept(null); setLearningLoaded(false)
      updateSession(null); setQueue(null)
      refreshLearning()
    }
  }

  const summary = useMemo(() => summarize(progress, misconceptions), [progress, misconceptions])
  const activeIndex = tabs.findIndex(([tab]) => tab === view)
  const Screen = screens[view]
  const ctx = {
    view, go, studentId, file, analysis, quiz, selectionReason, answer, setAnswer, evaluation, recorded,
    confidence, setConfidence, progress, misconceptions, queue, weakPlan, conceptGraph, selectedConcept,
    setSelectedConcept, task, backendOnline, modelStatus, modelInfo, restoredMaterial, forgetStudyMaterial, summary, learningLoaded, sessionCount, session,
    explanations, onPickFile: acceptFile, analyze, startQuiz, testMe, submitAnswer, nextQuestion, fixWeakAreas,
    buildConceptGraph, practiceTopic, refreshLearning: () => refreshLearning(), explain, startSession, startFocus,
    finishSession, keepPractising, closeSession, restartSession,
  }
  const statusLabel = backendOnline ? 'Connected' : backendOnline === false ? 'Disconnected' : 'Checking…'
  const statusClass = backendOnline ? 'online' : backendOnline === false ? 'offline' : ''
  const thinking = task && !LOCAL_ONLY_TASKS.includes(task.kind)

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
        <div className="ai-dock-head"><span className={`status-dot ${statusClass}`} aria-hidden="true"/><strong>Local AI</strong><span className="ai-dock-state">{thinking ? 'Busy' : backendOnline === false ? 'Offline' : modelStatus === 'down' ? 'No model' : backendOnline ? (modelInfo?.loaded ? 'Warm' : 'Ready') : '…'}</span></div>
        <div className="ai-dock-bars" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <i key={i} style={{ '--i': i }} className={thinking ? 'busy' : ''}/>)}</div>
        <small>Qwen3 14B · Ollama</small>
        <small>{thinking ? 'Thinking locally…' : 'Private · 0 cloud calls'}</small>
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
        {thinking && <Thinking task={task}/>}
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
