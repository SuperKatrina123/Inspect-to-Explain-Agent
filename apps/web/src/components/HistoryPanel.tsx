/**
 * HistoryPanel — shows all past inspect sessions, newest first.
 * Users can restore any entry back to the main view, select two
 * entries for side-by-side comparison, or delete entries.
 */
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

          return (
            <div
              key={entry.id}
              className={`history-entry${isSelected ? ' history-entry--selected' : ''}`}
            >
              {/* Top row: time + element + delete */}
              <div className="hist-entry-header">
                <span className="hist-time">{fmtTime(entry.timestamp)}</span>
                <span className="hist-tag">&lt;{el.tag}&gt;</span>
                {el.text && (
                  <span className="hist-text">"{el.text.slice(0, 28)}{el.text.length > 28 ? '…' : ''}"</span>
                )}
                <button
                  className="hist-delete-btn"
                  onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                  title="Remove from history"
                >✕</button>
              </div>

              {/* Module + sourceType + confidence */}
              <div className="hist-entry-meta">
                <span className="hist-module">{result.moduleName}</span>
                <span className={`hist-source-badge src-${result.sourceType.replace(/_/g, '-')}`}>
                  {SRC_LABEL[result.sourceType]}
                </span>
                <span className="hist-conf">{pct}%</span>
              </div>

              {/* Actions */}
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
