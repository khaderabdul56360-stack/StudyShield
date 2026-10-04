// On-device persistence so a restart doesn't lose the student's place. Everything stays in this app's
// local browser storage; every access is guarded because storage can be unavailable or cleared.

const DB_NAME = 'studyshield'
const STORE = 'material'
const MATERIAL_KEY = 'current'
const SNAPSHOT_KEY = 'studyshield:v1:snapshot'
const DURATIONS_KEY = 'studyshield:v1:durations'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(mode, action) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => { db.close(); resolve(request?.result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  })
}

// The PDF itself (a Blob) plus its analysis, so analysed notes can be resumed without re-uploading.
export async function loadMaterial() {
  try {
    const record = await withStore('readonly', store => store.get(MATERIAL_KEY))
    if (!record?.blob) return null
    const file = new File([record.blob], record.name, { type: record.type || 'application/pdf', lastModified: record.lastModified })
    return { file, analysis: record.analysis || null }
  } catch { return null }
}

export async function saveMaterial(file, analysis = null) {
  try {
    await withStore('readwrite', store => store.put({
      blob: file, name: file.name, type: file.type, lastModified: file.lastModified, analysis,
    }, MATERIAL_KEY))
  } catch { /* storage unavailable: the app still works, it just won't resume */ }
}

export async function forgetMaterial() {
  try { await withStore('readwrite', store => store.delete(MATERIAL_KEY)) } catch { /* nothing stored */ }
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode or quota: ignore */ }
}

// Student ID, the running session and the current question, so a reload resumes mid-session.
export const loadSnapshot = () => readJson(SNAPSHOT_KEY)
export const saveSnapshot = snapshot => writeJson(SNAPSHOT_KEY, snapshot)

// Real measured durations of previous local-AI steps, shown while waiting. Never estimated.
export const loadDurations = () => readJson(DURATIONS_KEY) || {}
export const saveDurations = durations => writeJson(DURATIONS_KEY, durations)
