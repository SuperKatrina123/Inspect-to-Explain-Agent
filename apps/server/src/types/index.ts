export interface SelectedElement {
  tag: string;
  text: string;
  className: string;
  id: string;
  selector: string;
  xpath: string;
}

export interface AncestorNode {
  tag: string;
  className: string;
  id: string;
}

export interface SiblingNode {
  tag: string;
  text: string;
  className: string;
}

/** A single API request recorded by the bookmarklet while Inspect Mode was ON */
export interface RecordedRequest {
  method: string;
  endpoint: string;  // URL pathname only, e.g. "/api/v1/order/detail"
  body: any;         // raw JSON response — will be masked before LLM
  timestamp: number;
}

/** SSR hydration object detected in the page (Next.js, Nuxt, custom BFF, etc.) */
export interface SsrData {
  key: string;   // e.g. "__NEXT_DATA__"
  data: any;
}

/**
 * Network context collected by the bookmarklet at click time.
 * Contains only requests matching the user-configured path filter,
 * recorded since Inspect Mode was turned ON.
 */
export interface NetworkContext {
  filter: string;              // path prefix filter, e.g. "/api/"
  requests: RecordedRequest[]; // recorded API responses (to be masked server-side)
  ssrData: SsrData[];          // SSR hydration data found on the page
}

export interface ElementContext {
  url: string;
  selectedElement: SelectedElement;
  ancestors: AncestorNode[];
  siblings: SiblingNode[];
  nearbyTexts: string[];
  /**
   * React component names from the Fiber tree, nearest → root.
   * e.g. ["OrderItemRow", "OrderSummary", "App"]
   * Empty array when Fiber is not accessible.
   */
  reactComponentStack: string[];
  /** Network data collected by the bookmarklet — undefined when using iframe demo mode */
  networkContext?: NetworkContext;
}

export type SourceType =
  | 'frontend_static'
  | 'api_response'
  | 'config_driven'
  | 'derived_field'
  | 'unknown_candidate';

/** A single matched location found by the local code searcher */
export interface CodeReference {
  /** Path relative to project root, e.g. "demo/demo-app/src/components/UserProfileCard.tsx" */
  file: string;
  line: number;
  /** The trimmed source line that matched */
  snippet: string;
  /** Component name inferred from the file name */
  componentName: string;
}

/** One persisted inspect session — context + analysis result */
export interface HistoryEntry {
  id: string;
  timestamp: string;
  context: ElementContext;
  result: AnalysisResult;
}

export interface AnalysisResult {
  elementText: string;
  moduleName: string;
  candidateComponents: string[];
  sourceType: SourceType;
  confidence: number;
  evidence: string[];
  explanation: string;
  /** Source file locations found by local code search */
  codeReferences?: CodeReference[];
  /** Which backend produced this result */
  analysisMode?: 'llm' | 'mock';
  /** Raw model name used, e.g. "gpt-5.4" */
  modelUsed?: string;
}
