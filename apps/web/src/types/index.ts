export interface SelectedElement {
  tag: string;
  text: string;
  className: string;
  id: string;
  selector: string;
  xpath: string;
}

export interface AncestorNode { tag: string; className: string; id: string }
export interface SiblingNode  { tag: string; text: string; className: string }

export interface ElementContext {
  url: string;
  selectedElement: SelectedElement;
  ancestors: AncestorNode[];
  siblings: SiblingNode[];
  nearbyTexts: string[];
  /** React component names from Fiber tree, nearest → root. */
  reactComponentStack: string[];
}

export type SourceType =
  | 'frontend_static'
  | 'api_response'
  | 'config_driven'
  | 'derived_field'
  | 'unknown_candidate';

export interface CodeReference {
  file: string;
  line: number;
  snippet: string;
  componentName: string;
}

export interface AnalysisResult {
  elementText: string;
  moduleName: string;
  candidateComponents: string[];
  sourceType: SourceType;
  confidence: number;
  evidence: string[];
  explanation: string;
  codeReferences?: CodeReference[];
  analysisMode?: 'llm' | 'mock';
  modelUsed?: string;
}

/** One persisted inspect session saved in backend history */
export interface HistoryEntry {
  id: string;
  timestamp: string;
  context: ElementContext;
  result: AnalysisResult;
}

export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error';
