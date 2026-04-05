import { useState, useCallback, useEffect, useRef } from 'react';
import { useInspectMode } from './hooks/useInspectMode';
import { useHistory } from './hooks/useHistory';
import { SelectedElementPanel } from './components/SelectedElementPanel';
import { AnalysisStatusPanel } from './components/AnalysisStatusPanel';
import { AnalysisResultPanel } from './components/AnalysisResultPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { CompareModal } from './components/CompareModal';
import { AnalysisResult, AnalysisStatus, HistoryEntry } from './types';
import './App.css';

const SERVER_URL = 'http://localhost:3001';
const DEMO_URL   = 'http://localhost:5174';

function App() {
  const { isInspectMode, selectedContext, toggleInspectMode, iframeRef, setSelectedContext } = useInspectMode();
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError,  setAnalysisError]  = useState<string | null>(null);
  const [demoReady,      setDemoReady]       = useState(false);

  // History
  const { entries, loading: histLoading, refresh: refreshHistory, deleteEntry, clearAll } = useHistory();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareEntries, setCompareEntries] = useState<[HistoryEntry, HistoryEntry] | null>(null);

  /**
   * Flag that prevents the "selectedContext changed → reset analysis" effect
   * from firing when we're restoring an entry from history.
   */
  const restoringRef = useRef(false);

  // When a new element is selected via iframe inspection, reset previous analysis
  useEffect(() => {
    if (restoringRef.current) {
      restoringRef.current = false; // consume the flag, keep current analysis
      return;
    }
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
      // Refresh history list so the new entry appears immediately
      refreshHistory();
    } catch (err) {
      setAnalysisError(String(err));
      setAnalysisStatus('error');
    }
  }, [selectedContext, refreshHistory]);

  /** Restore a history entry — populate all panels without resetting them */
  const handleRestore = useCallback((entry: HistoryEntry) => {
    restoringRef.current = true;
    setSelectedContext(entry.context);
    setAnalysisResult(entry.result);
    setAnalysisStatus('success');
    setAnalysisError(null);
  }, [setSelectedContext]);

  /** Toggle an entry in/out of the compare selection (max 2) */
  const handleToggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }, []);

  /** Open the compare modal for the two selected entries */
  const handleCompare = useCallback(() => {
    const [idA, idB] = compareIds;
    const a = entries.find((e) => e.id === idA);
    const b = entries.find((e) => e.id === idB);
    if (a && b) setCompareEntries([a, b]);
  }, [compareIds, entries]);

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

        {/* ── Right: analysis panels + history ── */}
        <div className="panels-container">
          <SelectedElementPanel context={selectedContext} />
          <AnalysisStatusPanel
            status={analysisStatus}
            onAnalyze={handleAnalyze}
            hasContext={!!selectedContext}
          />
          <AnalysisResultPanel result={analysisResult} error={analysisError} />
          <HistoryPanel
            entries={entries}
            loading={histLoading}
            compareIds={compareIds}
            onRestore={handleRestore}
            onToggleCompare={handleToggleCompare}
            onCompare={handleCompare}
            onDelete={deleteEntry}
            onClearAll={clearAll}
          />
        </div>
      </div>

      {/* Compare modal — rendered at app root so it overlays everything */}
      {compareEntries && (
        <CompareModal
          entryA={compareEntries[0]}
          entryB={compareEntries[1]}
          onClose={() => setCompareEntries(null)}
        />
      )}
    </div>
  );
}

export default App;
