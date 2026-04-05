import { AnalysisResult, SourceType } from '../types';

interface Props { result: AnalysisResult | null; error: string | null }

const SOURCE_META: Record<SourceType, { label: string; cls: string }> = {
  frontend_static:   { label: 'Frontend Static',  cls: 'src-static'  },
  api_response:      { label: 'API Response',      cls: 'src-api'     },
  config_driven:     { label: 'Config Driven',     cls: 'src-config'  },
  derived_field:     { label: 'Derived Field',     cls: 'src-derived' },
  unknown_candidate: { label: 'Unknown',           cls: 'src-unknown' },
};

export function AnalysisResultPanel({ result, error }: Props) {
  if (error) return (
    <div className="panel">
      <h3 className="panel-title">📊 Analysis Result</h3>
      <div className="result-error">{error}</div>
    </div>
  );

  if (!result) return (
    <div className="panel">
      <h3 className="panel-title">📊 Analysis Result</h3>
      <p className="panel-empty">Click Analyze to see results</p>
    </div>
  );

  const src = SOURCE_META[result.sourceType];
  const pct = Math.round(result.confidence * 100);

  return (
    <div className="panel">
      <h3 className="panel-title">
        📊 Analysis Result
        {result.analysisMode && (
          <span className={`mode-badge ${result.analysisMode === 'llm' ? 'mode-llm' : 'mode-mock'}`}>
            {result.analysisMode === 'llm' ? `✨ ${result.modelUsed ?? 'LLM'}` : '🔧 mock'}
          </span>
        )}
      </h3>
      <div className="result-grid">
        <div className="result-row">
          <span className="result-label">Element Text</span>
          <span className="result-value result-text">"{result.elementText}"</span>
        </div>
        <div className="result-row">
          <span className="result-label">Module</span>
          <span className="result-value module-tag">{result.moduleName}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Source Type</span>
          <span className={`result-value source-badge ${src.cls}`}>{src.label}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Confidence</span>
          <div className="conf-wrap">
            <div className="conf-bar"><div className="conf-fill" style={{ width: `${pct}%` }} /></div>
            <span className="conf-pct">{pct}%</span>
          </div>
        </div>
      </div>

      <div className="result-section">
        <div className="section-label">Candidate Components</div>
        <div className="chip-row">
          {result.candidateComponents.map((c) => <span key={c} className="chip comp-chip">{c}</span>)}
        </div>
      </div>

      <div className="result-section">
        <div className="section-label">Evidence</div>
        <ul className="evidence-list">
          {result.evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </div>

      <div className="result-section">
        <div className="section-label">Explanation</div>
        <p className="explanation">{result.explanation}</p>
      </div>
    </div>
  );
}
