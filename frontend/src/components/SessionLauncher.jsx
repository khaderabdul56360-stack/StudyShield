import { useId, useState } from 'react'
import { ClipboardCheck, GraduationCap, Play } from 'lucide-react'

// Small radio group: real radios (keyboard + screen readers) styled as pills.
function Options({ legend, name, options, value, onChange }) {
  return <fieldset className="option-group">
    <legend>{legend}</legend>
    <div>{options.map(([id, label]) => <label key={id} className={value === id ? 'selected' : ''}>
      <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)}/>{label}
    </label>)}</div>
  </fieldset>
}

export default function SessionLauncher({ file, busy, onStart, onLoadMaterial, compact = false }) {
  const id = useId()
  const [quickCount, setQuickCount] = useState(5)
  const [quickScope, setQuickScope] = useState('adaptive')
  const [examCount, setExamCount] = useState(5)
  const [examScope, setExamScope] = useState('all')
  const disabled = busy || !file
  return <section className={`launcher ${compact ? 'compact' : ''}`} aria-label="Start a session">
    <article className="card launch-card tone-card-cyan">
      <div className="launch-head">
        <span className="launch-icon tone-cyan" aria-hidden="true"><GraduationCap/></span>
        <div><span className="eyebrow">Learn</span><h2>Quick Revision</h2></div>
      </div>
      <p>Adaptive practice with feedback after every answer. Each question is chosen from what you just got right or wrong.</p>
      <div className="launch-options">
        <Options legend="Questions" name={`${id}-quick-count`} value={quickCount} onChange={setQuickCount}
          options={[[3, '3'], [5, '5'], [7, '7']]}/>
        <Options legend="Focus" name={`${id}-quick-scope`} value={quickScope} onChange={setQuickScope}
          options={[['adaptive', 'Adaptive'], ['weak', 'Weak Areas']]}/>
      </div>
      <button className="button primary shine" disabled={disabled}
        onClick={() => onStart('quick', { total: quickCount, scope: quickScope })}>
        <Play aria-hidden="true"/>Start Quick Revision
      </button>
    </article>
    <article className="card launch-card tone-card-violet">
      <div className="launch-head">
        <span className="launch-icon tone-violet" aria-hidden="true"><ClipboardCheck/></span>
        <div><span className="eyebrow violet">Test</span><h2>Exam Mode</h2></div>
      </div>
      <p>An honest assessment. No scores, answers or hints until you finish, then a full results breakdown.</p>
      <div className="launch-options">
        <Options legend="Questions" name={`${id}-exam-count`} value={examCount} onChange={setExamCount}
          options={[[5, '5'], [10, '10']]}/>
        <Options legend="Topics" name={`${id}-exam-scope`} value={examScope} onChange={setExamScope}
          options={[['all', 'All topics'], ['weak', 'Weak topics']]}/>
      </div>
      <button className="button secondary" disabled={disabled}
        onClick={() => onStart('exam', { total: examCount, scope: examScope })}>
        <ClipboardCheck aria-hidden="true"/>Start Exam
      </button>
    </article>
    {!file && <p className="launch-hint">Sessions use your study material.{' '}
      <button className="text-link" onClick={onLoadMaterial}>Load a PDF first</button></p>}
  </section>
}
