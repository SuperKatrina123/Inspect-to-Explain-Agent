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

export interface RecordedRequest {
  method: string;
  endpoint: string;
  body: any;
  timestamp: number;
}

export interface SsrData {
  key: string;
  data: any;
}

export interface NetworkContext {
  filter: string;
  requests: RecordedRequest[];
  ssrData: SsrData[];
}

export interface ElementContext {
  url: string;
  selectedElement: SelectedElement;
  ancestors: AncestorNode[];
  siblings: SiblingNode[];
  nearbyTexts: string[];
  /** @deprecated Use reactInspection instead */
  reactComponentStack?: string[];
  /** Structured React inspection from Fiber tree */
  reactInspection?: {
    nearestComponent: string | null;
    businessStack: string[];
    propsSummary: Record<string, unknown> | null;
    fiberDepth: number;
  };
  /** Network context from bookmarklet — undefined in iframe/demo mode */
  networkContext?: NetworkContext;
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

export interface SoaReference {
  file: string;
  line: number;
  endpoint: string;
  serviceId: string;
  methodName: string;
  snippet: string;
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
  soaReferences?: SoaReference[];
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
