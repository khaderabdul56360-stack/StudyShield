// Derived learning metrics. Everything here is computed from real SQLite-backed
// API responses (/progress and /misconceptions); nothing is estimated or invented.

export const MASTERY_THRESHOLD = 85

// Mirrors backend/adaptive.py priority_for_score so the UI and API agree.
export function priorityFor(item) {
  if (item.high_confidence_wrong) return 'High'
  if (item.average_score < 50) return 'High'
  if (item.average_score < 70) return 'Medium'
  return 'Low'
}

export function statusFor(score) {
  if (score == null) return 'unpracticed'
  if (score >= 85) return 'strong'
  if (score >= 60) return 'needs_revision'
  return 'weak'
}

export function summarize(progress, misconceptions) {
  const stats = progress?.topic_statistics || []
  const history = progress?.history || []
  const totalAttempts = stats.reduce((sum, item) => sum + item.attempts, 0)
  const average = totalAttempts
    ? Math.round(stats.reduce((sum, item) => sum + item.average_score * item.attempts, 0) / totalAttempts)
    : null
  const ranked = [...stats].sort((a, b) => b.average_score - a.average_score)
  const mastered = stats.filter(item => item.average_score >= MASTERY_THRESHOLD).length
  const weakTopics = stats
    .filter(item => item.average_score < MASTERY_THRESHOLD || item.high_confidence_wrong)
    .map(item => ({ ...item, priority: priorityFor(item) }))
    .sort((a, b) => ['High', 'Medium', 'Low'].indexOf(a.priority) - ['High', 'Medium', 'Low'].indexOf(b.priority)
      || a.average_score - b.average_score)

  // Confidence calibration uses the deterministic confidence_insight stored per attempt.
  const calibration = { aligned: 0, overconfident: 0, underconfident: 0, total: history.length }
  history.forEach(item => {
    if (item.confidence === 'high' && item.score < 60) calibration.overconfident += 1
    else if (item.confidence === 'low' && item.score >= 85) calibration.underconfident += 1
    else calibration.aligned += 1
  })

  return {
    stats,
    history,
    totalAttempts,
    average,
    strongest: ranked[0] || null,
    weakest: ranked.length ? ranked[ranked.length - 1] : null,
    mastery: stats.length ? Math.round((mastered / stats.length) * 100) : null,
    mastered,
    reviewsDue: weakTopics.length,
    weakTopics,
    activeMisconceptions: misconceptions?.active ?? null,
    calibration,
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function relativeTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(value)
}

// confidence is a fixed low/medium/high enum, so formatting it here never rewrites model text.
export const confidenceLabel = level => `${level.charAt(0).toUpperCase()}${level.slice(1)} confidence`

export const STATUS_LABEL = {
  strong: 'Strong', needs_revision: 'Needs revision', weak: 'Weak', unpracticed: 'Unpractised',
}
