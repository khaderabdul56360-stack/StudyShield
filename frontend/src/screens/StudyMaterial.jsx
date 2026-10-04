import { useState } from 'react'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, FileText, GitFork, Layers, ScanText, ShieldCheck,
  Sparkles, Target, Trash2, Upload, Zap,
} from 'lucide-react'
import { Badge, Empty, PickFile, SectionHead, Skeleton } from '../components/ui'
import { formatBytes } from '../lib/metrics'

function DropZone({ onPickFile }) {
  const [dragging, setDragging] = useState(false)
  return <label className={`drop-zone ${dragging ? 'dragging' : ''}`}
    onDragEnter={e => { e.preventDefault(); setDragging(true) }}
    onDragOver={e => { e.preventDefault(); setDragging(true) }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
    onDrop={e => { e.preventDefault(); setDragging(false); onPickFile(e.dataTransfer.files[0]) }}>
    <span className="drop-border" aria-hidden="true"/>
    <span className="drop-icon" aria-hidden="true"><FileText className="doc-back"/><FileText className="doc-front"/><Upload className="doc-arrow"/></span>
    <strong>{dragging ? 'Release to load your PDF' : 'Drop your study PDF here'}</strong>
    <span className="drop-sub">or <u>browse this device</u></span>
    <span className="drop-meta"><Badge tone="cyan" icon={ShieldCheck}>Processed locally</Badge><small>PDF with selectable text · up to 20 MB</small></span>
    <input type="file" accept="application/pdf,.pdf" onChange={e => { onPickFile(e.target.files[0]); e.target.value = '' }}/>
  </label>
}

export default function StudyMaterial({ ctx }) {
  const { file, analysis, task, onPickFile, analyze, startQuiz, testMe, buildConceptGraph, go, restoredMaterial, forgetStudyMaterial } = ctx
  const analyzing = task?.kind === 'analyze'
  const status = analyzing ? 'Analyzing' : analysis ? 'Analyzed' : 'Ready'
  const busy = Boolean(task)

  return <section className="screen">
    <SectionHead eyebrow="Study material" title="Turn pages into a study map."
      copy="Load a PDF and Qwen3 14B maps its topics, key ideas and tricky areas — on this device."
      actions={file && <>
        <PickFile onPick={onPickFile}><Upload aria-hidden="true"/>Change PDF</PickFile>
        <button className="button ghost" onClick={forgetStudyMaterial} disabled={busy} title="Remove this PDF from the app's storage on this device"><Trash2 aria-hidden="true"/>Forget</button>
      </>}/>

    {!file ? <div className="card upload-card"><DropZone onPickFile={onPickFile}/>
      <ul className="upload-steps" aria-label="What happens next">
        <li><ScanText aria-hidden="true"/><span><b>Extract</b>Text is read from the PDF locally</span></li>
        <li><Sparkles aria-hidden="true"/><span><b>Analyze</b>Topics and hard areas are mapped</span></li>
        <li><Target aria-hidden="true"/><span><b>Revise</b>Adaptive questions target your gaps</span></li>
      </ul>
    </div> : <>
      <div className="file-card card enter">
        <div className="file-icon" aria-hidden="true"><FileText/><span>PDF</span></div>
        <div className="file-info">
          <strong title={file.name}>{file.name}</strong>
          <span>{formatBytes(file.size)}{analysis && ` · ${analysis.characters_extracted.toLocaleString()} characters · ${analysis.analysis.main_topics.length} topics`}</span>
        </div>
        <Badge tone={analyzing ? 'violet' : analysis ? 'success' : 'cyan'} icon={analysis && !analyzing ? CheckCircle2 : undefined}>
          {analyzing && <span className="live-dot" aria-hidden="true"/>}{status}
        </Badge>
        <Badge tone="neutral" icon={ShieldCheck} className="hide-sm">{restoredMaterial ? 'Resumed from this device' : 'Stays on device'}</Badge>
      </div>

      <div className="quick-actions" role="group" aria-label="Quick actions">
        <button className={`button ${analysis ? 'secondary' : 'primary shine'}`} onClick={analyze} disabled={busy}><Sparkles aria-hidden="true"/>{analysis ? 'Re-analyze' : 'Analyze'}</button>
        <button className={`button ${analysis ? 'primary shine' : 'secondary'}`} onClick={startQuiz} disabled={busy}><Zap aria-hidden="true"/>Start Revision</button>
        <button className="button secondary" onClick={testMe} disabled={busy}><Target aria-hidden="true"/>Test Me</button>
        <button className="button secondary" onClick={buildConceptGraph} disabled={busy}><GitFork aria-hidden="true"/>View Concept Graph</button>
      </div>

      {analyzing && !analysis && <div className="analysis-grid"><Skeleton lines={5} className="span-2"/><Skeleton lines={4}/><Skeleton lines={3}/></div>}

      {!analysis && !analyzing && <div className="card"><Empty icon={Layers} title="Not analyzed yet"
        copy="Run Analyze to see detected topics and difficult areas, or jump straight into revision."/></div>}

      {analysis && <div className="analysis-grid enter">
        <article className="card span-2">
          <span className="eyebrow">Detected topics</span>
          <h2 className="card-title">{analysis.analysis.title}</h2>
          <ol className="topic-list">{analysis.analysis.main_topics.map((item, i) => <li className="topic-row" key={`${item.topic}-${i}`}>
            <b aria-hidden="true">{String(i + 1).padStart(2, '0')}</b>
            <div>
              <h3>{item.topic}</h3>
              <div className="chips">{item.important_concepts.map(concept => <span className="chip" key={concept}>{concept}</span>)}</div>
            </div>
          </li>)}</ol>
        </article>
        <article className="card">
          <span className="eyebrow">Revision essentials</span>
          <ul className="check-list">{analysis.analysis.key_revision_points.map(point => <li key={point}><Check aria-hidden="true"/>{point}</li>)}</ul>
        </article>
        <article className="card tone-card-warning">
          <span className="eyebrow warning"><AlertTriangle aria-hidden="true"/>Difficult areas</span>
          <ul className="difficult-list">{analysis.analysis.difficult_areas.map(item => <li key={item.concept}><strong>{item.concept}</strong><p>{item.reason}</p></li>)}</ul>
          <button className="text-link" onClick={() => go('Revision Arena')} disabled={busy}>Go to Revision Arena<ArrowRight aria-hidden="true"/></button>
        </article>
      </div>}
    </>}
  </section>
}
