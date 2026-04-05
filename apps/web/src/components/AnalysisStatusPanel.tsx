import { AnalysisStatus } from '../types';

interface Props {
  status: AnalysisStatus;
  onAnalyze: () => void;
  hasContext: boolean;
}

const STATUS_META: Record<AnalysisStatus, { icon: string; label: string; cls: string }> = {
  idle:    { icon: '◌', label: 'Ready to analyze',   cls: 'status-idle'    },
  loading: { icon: '⟳', label: 'Analyzing element…', cls: 'status-loading'  },
  success: { icon: '✓', label: 'Analysis complete',  cls: 'status-success'  },
  error:   { icon: '✗', label: 'Analysis failed',    cls: 'status-error'    },
};

export function AnalysisStatusPanel({ status, onAnalyze, hasContext }: Props) {
  const meta = STATUS_META[status];
  return (
    <div className="panel">
      <h3 className="panel-title">⚙️ Analysis Status</h3>
      <div className={`status-badge ${meta.cls}`}>
        <span className={status === 'loading' ? 'spin' : ''}>{meta.icon}</span>
        <span>{meta.label}</span>
      </div>
      <button
        className="analyze-btn"
        onClick={onAnalyze}
        disabled={!hasContext || status === 'loading'}
      >
        {status === 'loading' ? 'Analyzing…' : '🔍 Analyze Element'}
      </button>
      {!hasContext && <p className="hint">Select an element first</p>}
    </div>
  );
}
