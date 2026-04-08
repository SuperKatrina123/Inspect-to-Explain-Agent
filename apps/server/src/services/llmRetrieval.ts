import OpenAI from 'openai';
import { ElementContext, AnalysisResult, SourceType, CodeReference, SoaReference } from '../types';
import { buildSystemPrompt, buildUserMessage } from './promptBuilder';
import { analyzeElement as mockAnalyze } from './mockRetrieval';
import { searchByContext, searchSoaEndpoints } from './codeSearch';

// ── OpenAI-compatible client — base URL and model are read from env ──────────
// Default to the user-configured proxy; override via LLM_BASE_URL / LLM_MODEL.
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL    = 'gpt-5.4';

const MODEL = process.env.LLM_MODEL ?? DEFAULT_MODEL;

const VALID_SOURCE_TYPES: SourceType[] = [
  'frontend_static',
  'api_response',
  'config_driven',
  'derived_field',
  'unknown_candidate',
];

function isValidSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && VALID_SOURCE_TYPES.includes(v as SourceType);
}

/**
 * Parse and validate the LLM's raw JSON string into an AnalysisResult.
 * Returns null if parsing fails or required fields are missing.
 */
function parseModelResponse(raw: string, ctx: ElementContext): AnalysisResult | null {
  try {
    // Strip accidental markdown fences if the model adds them
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const elementText         = typeof parsed.elementText === 'string'      ? parsed.elementText       : ctx.selectedElement.text.slice(0, 100);
    const moduleName          = typeof parsed.moduleName === 'string'       ? parsed.moduleName        : 'Unknown';
    const candidateComponents = Array.isArray(parsed.candidateComponents)   ? (parsed.candidateComponents as string[]).filter(s => typeof s === 'string') : [moduleName];
    const sourceType          = isValidSourceType(parsed.sourceType)        ? parsed.sourceType        : 'unknown_candidate';
    const confidence          = typeof parsed.confidence === 'number'       ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5;
    const evidence            = Array.isArray(parsed.evidence)              ? (parsed.evidence as string[]).filter(s => typeof s === 'string') : [];
    const explanation         = typeof parsed.explanation === 'string'      ? parsed.explanation       : '';

    return { elementText, moduleName, candidateComponents, sourceType, confidence, evidence, explanation };
  } catch {
    return null;
  }
}

/**
 * Call the LLM via the configured proxy and return a structured AnalysisResult.
 * Runs local code search first to ground the LLM's analysis in real source files.
 * Falls back to the mock analyser on any error.
 */
export async function analyzeElementWithLLM(ctx: ElementContext): Promise<AnalysisResult> {
  const apiKey      = process.env.ANTHROPIC_API_KEY;
  const baseURL     = process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL;
  const projectRoot = ctx.codeSearchRoot || process.env.CODE_SEARCH_ROOT;

  if (!apiKey) {
    console.warn('[llm] ANTHROPIC_API_KEY not set — falling back to mock');
    return { ...mockAnalyze(ctx), analysisMode: 'mock' };
  }

  // ── Step 1: local code search ──────────────────────────────────────────────
  let codeRefs: CodeReference[] = [];
  let soaRefs: SoaReference[] = [];
  if (projectRoot) {
    try {
      codeRefs = searchByContext(ctx, projectRoot);
      console.log(`[code-search] Found ${codeRefs.length} reference(s)`);
      // Step 1b: scan candidate files for SOA endpoint calls
      if (codeRefs.length > 0) {
        soaRefs = searchSoaEndpoints(codeRefs, projectRoot);
      }
    } catch (err) {
      console.warn('[code-search] Search failed:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[code-search] CODE_SEARCH_ROOT not set — skipping local search');
  }

  // ── Step 2: call LLM with code refs + SOA refs injected into the prompt ───
  const client = new OpenAI({ apiKey, baseURL });
  const systemPrompt = buildSystemPrompt();
  const userMessage  = buildUserMessage(ctx, codeRefs, soaRefs);

  console.log(`[llm] Calling ${MODEL}…`);

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? '';
    console.log('[llm] Raw response:\n', rawContent.slice(0, 500));

    const result = parseModelResponse(rawContent, ctx);
    if (!result) {
      console.error('[llm] Failed to parse model response — falling back to mock');
      return { ...mockAnalyze(ctx), codeReferences: codeRefs, analysisMode: 'mock' };
    }

    return {
      ...result,
      codeReferences: codeRefs,
      soaReferences: soaRefs.length > 0 ? soaRefs : undefined,
      analysisMode: 'llm',
      modelUsed: MODEL,
    };
  } catch (err) {
    console.error('[llm] API call failed:', err instanceof Error ? err.message : err);
    return { ...mockAnalyze(ctx), codeReferences: codeRefs, soaReferences: soaRefs.length > 0 ? soaRefs : undefined, analysisMode: 'mock' };
  }
}
