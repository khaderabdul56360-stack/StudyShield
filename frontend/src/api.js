const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch {
    throw new Error('StudyShield could not reach the local backend. Is FastAPI running?')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || 'The request could not be completed.')
  return data
}

function withFile(file, fields = {}) {
  const body = new FormData()
  body.append('file', file)
  Object.entries(fields).forEach(([key, value]) => value && body.append(key, value))
  return body
}

export const api = {
  analyze: (file) => request('/analyze-pdf', { method: 'POST', body: withFile(file) }),
  quiz: (file) => request('/generate-quiz', { method: 'POST', body: withFile(file) }),
  adaptiveQuiz: (file, studentId, topic) => request('/adaptive-question', {
    method: 'POST', body: withFile(file, { student_id: studentId, topic }),
  }),
  evaluate: (payload) => request('/evaluate-answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  progress: (studentId) => request(`/progress/${encodeURIComponent(studentId)}`),
  fixWeakAreas: (studentId) => request('/fix-weak-areas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  }),
}
