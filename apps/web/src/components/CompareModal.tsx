/**
 * CompareModal — side-by-side diff of two HistoryEntry items.
 *
 * Diff highlights:
 *   - Changed scalar fields  → amber left-border + subtle background (.cmp-row--changed)
 *   - Same scalar fields     → no highlight (default)
 *   - Components unique to this side → amber chip (.comp-chip--unique)
 *   - Components shared by both    → normal chip
 *   - Confidence delta         → Δ badge (green = higher, red = lower)
 *   - Top banner               → "N differences" summary
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

// ── Diff helpers ────────────────────────────────────────────────────────────

function rowCls(changed: boolean) {
  return `cmp-row${changed ? ' cmp-row--changed' : ''}`;
}

/** Count total scalar differences between two entries (for the summary banner) */
function countDiffs(a: HistoryEntry, b: HistoryEntry): number {
  let n = 0;
  const elA = a.context.selectedElement, elB = b.context.selectedElement;
  const rA = a.result, rB = b.result;
  if (elA.tag       !== elB.tag)       n++;
  if (elA.text      !== elB.text)      n++;
  if (elA.className !== elB.className) n++;
  if (rA.moduleName  !== rB.moduleName)  n++;
  if (rA.sourceType  !== rB.sourceType)  n++;
  if (rA.explanation !== rB.explanation) n++;
  // Component set diff (unique items on either side count as 1 diff)
  const setA = new Set(rA.candidateComponents);
  const setB = new Set(rB.candidateComponents);
  const uniqueA = rA.candidateComponents.filter((c) => !setB.has(c));
  const uniqueB = rB.candidateComponents.filter((c) => !setA.has(c));
  if (uniqueA.length > 0 || uniqueB.length > 0) n++;
  // Confidence threshold: flag if gap > 5 pp
  if (Math.abs(rA.confidence - rB.confidence) > 0.05) n++;
  return n;
}

// ── Column component ─────────────────────────────────────────────────────────

interface ColProps { entry: HistoryEntry; other: HistoryEntry; side: 'A' | 'B' }

function CompareCol({ entry, other, side }: ColProps) {
  const { result, context } = entry;
  const el    = context.selectedElement;
  const otherEl  = other.context.selectedElement;
  const otherRes = other.result;

  const src  = SRC_META[result.sourceType];
  const pct  = Math.round(result.confidence * 100);
  const otherPct = Math.round(otherRes.confidence * 100);
  const delta = pct - otherPct;
  const firstRef = result.codeReferences?.[0];

  // Component uniqueness
  const otherComps = new Set(otherRes.candidateComponents);
  const thisComps  = new Set(result.candidateComponents);

  return (
    <div className="cmp-col">
      <div className="cmp-col-header">
        <span className="cmp-side-badge">{side}</span>
        <span className="cmp-time">{fmtDateTime(entry.timestamp)}</span>
      </div>

      {/* ── Element ── */}
      <section className="cmp-section">
        <div className="cmp-section-title">Element</div>

        <div className={rowCls(el.tag !== otherEl.tag)}>
          <span className="cmp-label">Tag</span>
          <code className="cmp-val">&lt;{el.tag}&gt;</code>
          {el.tag !== otherEl.tag && <span className="diff-icon">≠</span>}
        </div>

        <div className={rowCls(el.text !== otherEl.text)}>
          <span className="cmp-label">Text</span>
          <span className="cmp-val cmp-text">"{el.text || '—'}"</span>
          {el.text !== otherEl.text && <span className="diff-icon">≠</span>}
        </div>

        <div className={rowCls(el.className !== otherEl.className)}>
          <span className="cmp-label">Class</span>
          <code className="cmp-val">{el.className || '—'}</code>
          {el.className !== otherEl.className && <span className="diff-icon">≠</span>}
        </div>
      </section>

      {/* ── Analysis ── */}
      <section className="cmp-section">
        <div className="cmp-section-title">Analysis</div>

        <div className={rowCls(result.moduleName !== otherRes.moduleName)}>
          <span className="cmp-label">Module</span>
          <span className="cmp-val cmp-module">{result.moduleName}</span>
          {result.moduleName !== otherRes.moduleName && <span className="diff-icon">≠</span>}
        </div>

        <div className={rowCls(result.sourceType !== otherRes.sourceType)}>
          <span className="cmp-label">Source</span>
          <span className={`source-badge ${src.cls}`}>{src.label}</span>
          {result.sourceType !== otherRes.sourceType && <span className="diff-icon">≠</span>}
        </div>

        <div className={rowCls(Math.abs(result.confidence - otherRes.confidence) > 0.05)}>
          <span className="cmp-label">Confidence</span>
          <div className="conf-wrap">
            <div className="conf-bar">
              <div className="conf-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="conf-pct">{pct}%</span>
            {delta !== 0 && (
              <span className={`conf-delta ${delta > 0 ? 'conf-delta--up' : 'conf-delta--down'}`}>
                {delta > 0 ? `+${delta}` : delta}pp
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Candidate Components (chip-level diff) ── */}
      <section className="cmp-section">
        <div className="cmp-section-title">
          Candidate Components
          {result.candidateComponents.some((c) => !otherComps.has(c)) && (
            <span className="diff-section-note"> — unique chips highlighted</span>
          )}
        </div>
        <div className="chip-row">
          {result.candidateComponents.map((c) => (
            <span
              key={c}
              className={`chip ${otherComps.has(c) ? 'comp-chip' : 'comp-chip comp-chip--unique'}`}
              title={otherComps.has(c) ? 'In both' : 'Only in this side'}
            >
              {c}
              {!otherComps.has(c) && <span className="chip-only-mark"> ★</span>}
            </span>
          ))}
          {/* Show components the other side has but this side doesn't (greyed out) */}
          {[...otherComps].filter((c) => !thisComps.has(c)).map((c) => (
            <span key={`missing-${c}`} className="chip comp-chip comp-chip--absent" title="Only in other side">
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* ── Explanation ── */}
      <section className={`cmp-section${result.explanation !== otherRes.explanation ? ' cmp-section--changed' : ''}`}>
        <div className="cmp-section-title">
          Explanation
          {result.explanation !== otherRes.explanation && (
            <span className="diff-section-note"> — differs ≠</span>
          )}
        </div>
        <p className="cmp-explanation">{result.explanation}</p>
      </section>

      {/* ── First code reference ── */}
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

// ── Modal root ───────────────────────────────────────────────────────────────

interface Props {
  entryA: HistoryEntry;
  entryB: HistoryEntry;
  onClose: () => void;
}

export function CompareModal({ entryA, entryB, onClose }: Props) {
  const diffCount = countDiffs(entryA, entryB);

  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compare-modal-header">
          <span className="compare-modal-title">⚖️ Side-by-Side Comparison</span>
          {/* Diff summary banner */}
          {diffCount === 0
            ? <span className="diff-banner diff-banner--same">✓ All fields match</span>
            : <span className="diff-banner diff-banner--diff">{diffCount} difference{diffCount > 1 ? 's' : ''}</span>
          }
          <button className="compare-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="compare-cols">
          <CompareCol entry={entryA} other={entryB} side="A" />
          <div className="compare-divider" />
          <CompareCol entry={entryB} other={entryA} side="B" />
        </div>
      </div>
    </div>
  );
}

