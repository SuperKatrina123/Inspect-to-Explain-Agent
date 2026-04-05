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

export interface ElementContext {
  url: string;
  selectedElement: SelectedElement;
  ancestors: AncestorNode[];
  siblings: SiblingNode[];
  nearbyTexts: string[];
}

export type SourceType =
  | 'frontend_static'
  | 'api_response'
  | 'config_driven'
  | 'derived_field'
  | 'unknown_candidate';

export interface AnalysisResult {
  elementText: string;
  moduleName: string;
  candidateComponents: string[];
  sourceType: SourceType;
  confidence: number;
  evidence: string[];
  explanation: string;
  /** Which backend produced this result */
  analysisMode?: 'llm' | 'mock';
  /** Raw model name used, e.g. "anthropic/claude-3-5-sonnet" */
  modelUsed?: string;
}
