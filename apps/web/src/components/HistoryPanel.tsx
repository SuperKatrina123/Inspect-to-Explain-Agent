/**
 * HistoryPanel — shows all past inspect sessions, newest first.
 *
 * Each entry card can be expanded (click the card body) to reveal
 * the full explanation and evidence — avoiding any text truncation.
 */
import { useState } from 'react';
import { HistoryEntry, SourceType } from '../types';

const SRC_LABEL: Record<SourceType, string> = {
  frontend_static:   'Static',
  api_response:      'API',
  config_driven:     'Config',
  derived_field:     'Derived',
  unknown_candidate: '?',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  entries: HistoryEntry[];
  loading: boolean;
  compareIds: string[];
  onRestore: (entry: HistoryEntry) => void;
  onToggleCompare: (id: string) => void;
  onCompare: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryPanel({
  entries, loading, compareIds,
  onRestore, onToggleCompare, onCompare, onDelete, onClearAll,
}: Props) {
  // Track which entry ids are expanded
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="panel history-panel">
      <h3 className="panel-title">
        🕑 History
        <span className="hist-count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="hist-clear-btn" onClick={onClearAll} title="Clear all history">✕ Clear</button>
        )}
      </h3>

      {compareIds.length === 2 && (
        <button className="compare-trigger-btn" onClick={onCompare}>
          ⚖️ Compare selected ({compareIds.length}/2)
        </button>
      )}
      {compareIds.length === 1 && (
        <p className="hist-compare-hint">Select one more entry to compare</p>
      )}

      {loading && <p className="panel-empty">Loading…</p>}
      {!loading && entries.length === 0 && (
        <p className="panel-empty">No history yet. Analyze an element to start.</p>
      )}

      <div className="history-list">
        {entries.map((entry) => {
          const { result, context } = entry;
          const el = context.selectedElement;
          const isSelected = compareIds.includes(entry.id);
          const canSelect = compareIds.length < 2 || isSelected;
          const pct = Math.round(result.confidence * 100);
          const isExpanded = expandedIds.has(entry.id);

          return (
            <div
              key={entry.id}
              className={`history-entry${isSelected ? ' history-entry--selected' : ''}`}
            >
              {/* ── Clickable summary row → toggles expand ── */}
              <div
                className="hist-entry-summary"
                onClick={() => toggleExpand(entry.id)}
                title={isExpanded ? 'Click to collapse' : 'Click to expand details'}
              >
                <div className="hist-entry-header">
                  <span className="hist-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                  <span className="hist-time">{fmtTime(entry.timestamp)}</span>
                  <span className="hist-tag">&lt;{el.tag}&gt;</span>
                  {/* Show full text — no truncation in header */}
                  {el.text && (
                    <span className="hist-text" title={el.text}>
                      "{el.text.length > 24 && !isExpanded
                        ? el.text.slice(0, 24) + '…'
                        : el.text}"
                    </span>
                  )}
                  <button
                    className="hist-delete-btn"
                    onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                    title="Remove from history"
                  >✕</button>
                </div>

                <div className="hist-entry-meta">
                  <span className="hist-module">{result.moduleName}</span>
                  <span className={`hist-source-badge src-${result.sourceType.replace(/_/g, '-')}`}>
                    {SRC_LABEL[result.sourceType]}
                  </span>
                  <span className="hist-conf">{pct}%</span>
                </div>
              </div>

              {/* ── Expanded detail: full explanation + evidence ── */}
              {isExpanded && (
                <div className="hist-entry-detail">
                  {/* Full element info */}
                  <div className="hist-detail-section">
                    <div className="hist-detail-label">Element</div>
                    <div className="hist-detail-field">
                      <span className="hist-detail-key">text</span>
                      <span className="hist-detail-val">{el.text || '—'}</span>
                    </div>
                    <div className="hist-detail-field">
                      <span className="hist-detail-key">class</span>
                      <code className="hist-detail-val">{el.className || '—'}</code>
                    </div>
                    <div className="hist-detail-field">
                      <span className="hist-detail-key">selector</span>
                      <code className="hist-detail-val">{el.selector || '—'}</code>
                    </div>
                  </div>

                  {/* Full explanation */}
                  <div className="hist-detail-section">
                    <div className="hist-detail-label">Explanation</div>
                    <p className="hist-detail-explanation">{result.explanation}</p>
                  </div>

                  {/* Evidence bullets */}
                  {result.evidence.length > 0 && (
                    <div className="hist-detail-section">
                      <div className="hist-detail-label">Evidence</div>
                      <ul className="hist-detail-evidence">
                        {result.evidence.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* First code ref */}
                  {result.codeReferences?.[0] && (
                    <div className="hist-detail-section">
                      <div className="hist-detail-label">Code Reference</div>
                      <div className="code-ref-item">
                        <div className="code-ref-header">
                          <span className="code-ref-file">{result.codeReferences[0].file}</span>
                          <span className="code-ref-line">:{result.codeReferences[0].line}</span>
                          <span className="code-ref-comp">{result.codeReferences[0].componentName}</span>
                        </div>
                        <pre className="code-ref-snippet">{result.codeReferences[0].snippet}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="hist-entry-actions">
                <button className="hist-restore-btn" onClick={() => onRestore(entry)}>
                  ↩ Restore
                </button>
                <label
                  className={`hist-compare-check${!canSelect ? ' disabled' : ''}`}
                  title={canSelect ? 'Select for comparison' : 'Deselect another first'}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!canSelect}
                    onChange={() => onToggleCompare(entry.id)}
                  />
                  Compare
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

