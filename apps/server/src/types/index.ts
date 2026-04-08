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

export interface ReactInspection {
  nearestComponent: string | null;
  businessStack: string[];
  propsSummary: Record<string, unknown> | null;
  fiberDepth: number;
}

export interface ElementContext {
  url: string;
  selectedElement: SelectedElement;
  ancestors: AncestorNode[];
  siblings: SiblingNode[];
  nearbyTexts: string[];
  /** Structured React inspection result from Fiber tree */
  reactInspection?: ReactInspection;
  /** Business component stack (backward compat, also populated from reactInspection) */
  reactComponentStack?: string[];
  /** Network data collected by the bookmarklet — undefined when using iframe demo mode */
  networkContext?: NetworkContext;
  /** Client-provided code search root path (overrides CODE_SEARCH_ROOT env var) */
  codeSearchRoot?: string;
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

/**
 * A SOA/BFF endpoint call found statically in source code.
 * Extracted by grepping candidate component files for SOA URL patterns.
 * e.g. /restapi/soa2/31454/fetchHotelInfoList
 */
export interface SoaReference {
  /** Source file where the call was found, relative to project root */
  file: string;
  line: number;
  /** Full matched path, e.g. "/restapi/soa2/31454/fetchHotelInfoList" */
  endpoint: string;
  /** Numeric SOA service ID, e.g. "31454" */
  serviceId: string;
  /** SOA method name, e.g. "fetchHotelInfoList" */
  methodName: string;
  /** The raw source line snippet for context */
  snippet: string;
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
  /**
   * SOA/BFF service calls found statically in candidate component files.
   * Only populated when CODE_SEARCH_ROOT is set (local dev mode).
   */
  soaReferences?: SoaReference[];
  /** Which backend produced this result */
  analysisMode?: 'llm' | 'mock';
  /** Raw model name used, e.g. "gpt-5.4" */
  modelUsed?: string;
}
