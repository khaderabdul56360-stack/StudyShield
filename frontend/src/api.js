const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch {
    throw new Error('StudyShield could not reach the local backend. Is FastAPI running?')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data.detail || ''
    if (/ollama.*(unavailable|connect|running)/i.test(detail)) throw new Error('Ollama is not running. Start Ollama, then try again.')
    if (/model.*(not found|missing)/i.test(detail)) throw new Error('Qwen3 14B is not installed. Run: ollama pull qwen3:14b')
    if (/readable text/i.test(detail)) throw new Error("This PDF doesn't contain readable text. Try a text-based PDF.")
    if (/timed out|timeout/i.test(detail)) throw new Error('The local model took too long to respond. Try again with a shorter PDF.')
    throw new Error(detail || 'The request could not be completed.')
  }
  return data
}

function withFile(file, fields = {}) {
  const body = new FormData()
  if (file) body.append('file', file)
  Object.entries(fields).forEach(([key, value]) => value && body.append(key, value))
  return body
}

export const api = {
  health: () => request('/health'),
  modelStatus: () => request('/model-status'),
  analyze: (file) => request('/analyze-pdf', { method: 'POST', body: withFile(file) }),
  quiz: (file) => request('/generate-quiz', { method: 'POST', body: withFile(file) }),
  // options: { topic, focus, scope: 'adaptive' | 'weak' | 'all', avoid: [topics already asked] }
  adaptiveQuiz: (file, studentId, { topic, focus = false, scope, avoid } = {}) => request('/adaptive-question', {
    method: 'POST',
    body: withFile(file, {
      student_id: studentId, topic, focus: focus ? 'true' : '', scope, avoid: avoid?.length ? JSON.stringify(avoid) : '',
    }),
  }),
  explain: (payload) => request('/explain', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  // Deterministic: no model call. The PDF (optional) only lets the API add unpractised graph concepts.
  revisionQueue: (studentId, file) => request('/revision-queue', {
    method: 'POST', body: withFile(file, { student_id: studentId }),
  }),
  sessionSummary: (studentId, attemptIds) => request('/session-summary', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId, attempt_ids: attemptIds }),
  }),
  conceptGraph: (file, studentId) => request('/concept-graph', {
    method: 'POST', body: withFile(file, { student_id: studentId }),
  }),
  evaluate: (payload) => request('/evaluate-answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  progress: (studentId) => request(`/progress/${encodeURIComponent(studentId)}`),
  misconceptions: (studentId) => request(`/misconceptions/${encodeURIComponent(studentId)}`),
  fixWeakAreas: (studentId) => request('/fix-weak-areas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  }),
}
