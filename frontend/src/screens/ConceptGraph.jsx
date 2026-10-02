import { ArrowRight, Database, FileText, GitFork, Network, RefreshCw, Target, Upload } from 'lucide-react'
import GraphCanvas from '../components/GraphCanvas'
import { Badge, Empty, Meter, PickFile, ScoreRing, SectionHead, Skeleton } from '../components/ui'
import { STATUS_LABEL } from '../lib/metrics'

const STATUS_TONE = { strong: 'success', needs_revision: 'warning', weak: 'danger', unpracticed: 'neutral' }
const REL_LABEL = { prerequisite: 'Prerequisite', related: 'Related', supports: 'Supports', part_of: 'Part of' }

function Legend() {
  return <div className="legend" aria-label="Legend">
    {Object.entries(STATUS_LABEL).map(([key, label]) => <span key={key}><i className={`dot status-${key}`} aria-hidden="true"/>{label}</span>)}
    <span className="legend-sep" aria-hidden="true"/>
    <span><i className="line rel-prerequisite" aria-hidden="true"/>Prerequisite</span>
    <span><i className="line rel-related" aria-hidden="true"/>Related</span>
  </div>
}

function Detail({ concept, graph, onSelect, onPractice, busy }) {
  const byId = Object.fromEntries(graph.concepts.map(c => [c.id, c]))
  const linked = graph.edges.filter(e => e.source === concept.id || e.target === concept.id)
  // An edge "A -prerequisite-> B" means A must be understood before B.
  const prerequisites = linked.filter(e => e.relationship === 'prerequisite' && e.target === concept.id).map(e => byId[e.source]).filter(Boolean)
  const connections = linked.filter(e => !(e.relationship === 'prerequisite' && e.target === concept.id))
  const tone = STATUS_TONE[concept.status]
  return <aside className={`card concept-detail enter tone-card-${tone}`} key={concept.id} aria-live="polite">
    <Badge tone={tone}><i className={`dot status-${concept.status}`} aria-hidden="true"/>{STATUS_LABEL[concept.status]}</Badge>
    <h2>{concept.label}</h2>
    <div className="detail-score">
      <ScoreRing score={concept.average_score == null ? null : Math.round(concept.average_score)} size={92} tone={tone === 'neutral' ? 'cyan' : tone} label="Average score"/>
      <dl>
        <div><dt>Attempts</dt><dd>{concept.attempts}</dd></div>
        <div><dt>Connections</dt><dd>{linked.length}</dd></div>
      </dl>
    </div>
    <div className="importance"><div><span>Importance</span><b>{Math.round(concept.importance * 100)}%</b></div><Meter value={concept.importance * 100} tone="violet" label="Importance"/></div>
    <h3>Prerequisites</h3>
    {prerequisites.length ? <div className="chips">{prerequisites.map(p => <button className={`chip node-chip status-${p.status}`} key={p.id} onClick={() => onSelect(p)}>{p.label}</button>)}</div> : <p className="muted">None — a good place to start.</p>}
    <h3>Connections</h3>
    {connections.length ? <ul className="connection-list">{connections.map((edge, i) => {
      const other = byId[edge.source === concept.id ? edge.target : edge.source]
      return other && <li key={`${other.id}-${i}`}><span>{REL_LABEL[edge.relationship]}</span><button onClick={() => onSelect(other)}>{other.label}<ArrowRight aria-hidden="true"/></button></li>
    })}</ul> : <p className="muted">No other links in this graph.</p>}
    <button className="button primary shine full" onClick={() => onPractice(concept.label)} disabled={busy}><Target aria-hidden="true"/>Practice This</button>
  </aside>
}

export default function ConceptGraph({ ctx }) {
  const { file, conceptGraph, selectedConcept, setSelectedConcept, buildConceptGraph, practiceTopic, onPickFile, task } = ctx
  const busy = Boolean(task)
  const building = task?.kind === 'graph'
  return <section className="screen">
    <SectionHead eyebrow="Concept graph" title="See how the ideas connect."
      copy="Nodes are coloured by your real scores, so gaps in prerequisites stand out."
      actions={conceptGraph && file && <button className="button secondary" onClick={buildConceptGraph} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</button>}/>

    {!conceptGraph ? (building ? <div className="graph-layout"><Skeleton lines={7} className="graph-skeleton"/><Skeleton lines={5}/></div>
      : <div className="card graph-empty"><Empty icon={Network} tone="violet" title="No concept graph yet"
        copy={file ? `Map the concepts, prerequisites and relationships inside ${file.name}.` : 'Load a study PDF, then map the relationships and prerequisites in your notes.'}>
        {file ? <button className="button primary shine" onClick={buildConceptGraph} disabled={busy}><GitFork aria-hidden="true"/>Build concept graph</button>
          : <PickFile className="button primary shine" onPick={onPickFile}><Upload aria-hidden="true"/>Choose PDF</PickFile>}
      </Empty></div>) : <>
      <div className="graph-meta">
        <span><FileText aria-hidden="true"/>{conceptGraph.filename}</span>
        <span><Database aria-hidden="true"/>{conceptGraph.cached ? 'Loaded from local cache' : 'Generated locally'}</span>
        <span>{conceptGraph.concepts.length} concepts · {conceptGraph.edges.length} links</span>
      </div>
      <div className="graph-layout">
        <article className="card graph-card">
          <Legend/>
          <GraphCanvas concepts={conceptGraph.concepts} edges={conceptGraph.edges} selectedId={selectedConcept?.id} onSelect={setSelectedConcept}/>
          <details className="edge-details">
            <summary>All relationships ({conceptGraph.edges.length})</summary>
            <ul>{conceptGraph.edges.map((edge, index) => {
              const source = conceptGraph.concepts.find(c => c.id === edge.source)
              const target = conceptGraph.concepts.find(c => c.id === edge.target)
              return <li key={`${edge.source}-${edge.target}-${index}`}>
                <button onClick={() => setSelectedConcept(source)}>{source?.label}</button>
                <span>{REL_LABEL[edge.relationship]}<ArrowRight aria-hidden="true"/></span>
                <button onClick={() => setSelectedConcept(target)}>{target?.label}</button>
              </li>
            })}</ul>
          </details>
        </article>
        {selectedConcept ? <Detail concept={selectedConcept} graph={conceptGraph} onSelect={setSelectedConcept} onPractice={practiceTopic} busy={busy}/>
          : <aside className="card"><Empty icon={Target} title="Choose a concept" copy="Select a node to inspect its progress and connections."/></aside>}
      </div>
    </>}
  </section>
}
