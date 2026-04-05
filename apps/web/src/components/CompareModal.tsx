/**
 * CompareModal — side-by-side diff of two HistoryEntry items.
 * Shows element info, module, sourceType, confidence, explanation,
 * and the first code reference for each entry.
 */
import { HistoryEntry, SourceType } from '../types';

const SRC_META: Record<SourceType, { label: string; cls: string }> = {
  frontend_static:   { label: 'Frontend Static', cls: 'src-static'  },
  api_response:      { label: 'API Response',     cls: 'src-api'     },
  config_driven:     { label: 'Config Driven',    cls: 'src-config'  },
  derived_field:     { label: 'Derived Field',    cls: 'src-derived' },
  unknown_candidate: { label: 'Unknown',          cls: 'src-unknown' },
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ColProps { entry: HistoryEntry; side: 'A' | 'B' }

function CompareCol({ entry, side }: ColProps) {
  const { result, context } = entry;
  const el = context.selectedElement;
  const src = SRC_META[result.sourceType];
  const pct = Math.round(result.confidence * 100);
  const firstRef = result.codeReferences?.[0];

  return (
    <div className="cmp-col">
      <div className="cmp-col-header">
        <span className="cmp-side-badge">{side}</span>
        <span className="cmp-time">{fmtDateTime(entry.timestamp)}</span>
      </div>

      {/* Element info */}
      <section className="cmp-section">
        <div className="cmp-section-title">Element</div>
        <div className="cmp-row">
          <span className="cmp-label">Tag</span>
          <code className="cmp-val">&lt;{el.tag}&gt;</code>
        </div>
        <div className="cmp-row">
          <span className="cmp-label">Text</span>
          <span className="cmp-val cmp-text">"{el.text || '—'}"</span>
        </div>
        <div className="cmp-row">
          <span className="cmp-label">Class</span>
          <code className="cmp-val">{el.className || '—'}</code>
        </div>
      </section>

      {/* Analysis summary */}
      <section className="cmp-section">
        <div className="cmp-section-title">Analysis</div>
        <div className="cmp-row">
          <span className="cmp-label">Module</span>
          <span className="cmp-val cmp-module">{result.moduleName}</span>
        </div>
        <div className="cmp-row">
          <span className="cmp-label">Source</span>
          <span className={`source-badge ${src.cls}`}>{src.label}</span>
        </div>
        <div className="cmp-row">
          <span className="cmp-label">Confidence</span>
          <div className="conf-wrap">
            <div className="conf-bar">
              <div className="conf-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="conf-pct">{pct}%</span>
          </div>
        </div>
      </section>

      {/* Components */}
      <section className="cmp-section">
        <div className="cmp-section-title">Candidate Components</div>
        <div className="chip-row">
          {result.candidateComponents.map((c) => (
            <span key={c} className="chip comp-chip">{c}</span>
          ))}
        </div>
      </section>

      {/* Explanation */}
      <section className="cmp-section">
        <div className="cmp-section-title">Explanation</div>
        <p className="cmp-explanation">{result.explanation}</p>
      </section>

      {/* First code reference */}
      {firstRef && (
        <section className="cmp-section">
          <div className="cmp-section-title">Code Reference</div>
          <div className="code-ref-item">
            <div className="code-ref-header">
              <span className="code-ref-file">{firstRef.file}</span>
              <span className="code-ref-line">:{firstRef.line}</span>
              <span className="code-ref-comp">{firstRef.componentName}</span>
            </div>
            <pre className="code-ref-snippet">{firstRef.snippet}</pre>
          </div>
        </section>
      )}
    </div>
  );
}

interface Props {
  entryA: HistoryEntry;
  entryB: HistoryEntry;
  onClose: () => void;
}

export function CompareModal({ entryA, entryB, onClose }: Props) {
  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compare-modal-header">
          <span className="compare-modal-title">⚖️ Side-by-Side Comparison</span>
          <button className="compare-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="compare-cols">
          <CompareCol entry={entryA} side="A" />
          <div className="compare-divider" />
          <CompareCol entry={entryB} side="B" />
        </div>
      </div>
    </div>
  );
}
