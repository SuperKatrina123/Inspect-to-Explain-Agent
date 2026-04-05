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
