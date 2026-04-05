import { useState, useCallback, useEffect } from 'react';
import { useInspectMode } from './hooks/useInspectMode';
import { SelectedElementPanel } from './components/SelectedElementPanel';
import { AnalysisStatusPanel } from './components/AnalysisStatusPanel';
import { AnalysisResultPanel } from './components/AnalysisResultPanel';
import { AnalysisResult, AnalysisStatus } from './types';
import './App.css';

const SERVER_URL = 'http://localhost:3001';
const DEMO_URL   = 'http://localhost:5174';

function App() {
  const { isInspectMode, selectedContext, toggleInspectMode, iframeRef } = useInspectMode();
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError,  setAnalysisError]  = useState<string | null>(null);
  const [demoReady,      setDemoReady]       = useState(false);

  // When a new element is selected, reset previous analysis
  useEffect(() => {
    setAnalysisStatus('idle');
    setAnalysisResult(null);
    setAnalysisError(null);
  }, [selectedContext]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedContext) return;
    setAnalysisStatus('loading');
    setAnalysisError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/analyze-element`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(selectedContext),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setAnalysisResult(data.result);
      setAnalysisStatus('success');
    } catch (err) {
      setAnalysisError(String(err));
      setAnalysisStatus('error');
    }
  }, [selectedContext]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="app-title">🔍 Inspect-to-Explain Agent</div>
          <div className="app-subtitle">Click elements in the demo page to analyze their source</div>
        </div>
        <button
          className={`inspect-toggle${isInspectMode ? ' inspect-active' : ''}`}
          onClick={toggleInspectMode}
        >
          {isInspectMode ? '🟢 Inspect ON' : '⚪ Inspect OFF'}
        </button>
      </header>

      <div className="app-body">
        {/* ── Left: embedded demo-app in iframe ── */}
        <div className="demo-container">
          <div className="demo-bar">
            <span className="demo-label">demo-app</span>
            <span className="demo-url">{DEMO_URL}</span>
            <span className={`demo-dot${demoReady ? ' live' : ''}`} title={demoReady ? 'loaded' : 'loading'} />
          </div>
          <iframe
            ref={iframeRef}
            src={DEMO_URL}
            className={`demo-iframe${isInspectMode ? ' inspect-on' : ''}`}
            title="Demo App"
            onLoad={() => setDemoReady(true)}
          />
        </div>

        {/* ── Right: three analysis panels ── */}
        <div className="panels-container">
          <SelectedElementPanel context={selectedContext} />
          <AnalysisStatusPanel
            status={analysisStatus}
            onAnalyze={handleAnalyze}
            hasContext={!!selectedContext}
          />
          <AnalysisResultPanel result={analysisResult} error={analysisError} />
        </div>
      </div>
    </div>
  );
}

export default App;
