import { Router, Request, Response } from 'express';
import { ElementContext } from '../types';
import { analyzeElement as mockAnalyze } from '../services/mockRetrieval';
import { analyzeElementWithLLM } from '../services/llmRetrieval';
import { filterFiberStack } from '../services/codeSearch';
import { addEntry } from '../services/historyStore';

const router = Router();

router.post('/analyze-element', async (req: Request, res: Response) => {
  const ctx = req.body as ElementContext;
  if (!ctx?.selectedElement?.tag) {
    return res.status(400).json({ error: 'Invalid element context: missing selectedElement' });
  }

  // Normalize: ensure reactComponentStack is populated (from reactInspection or directly)
  if (!ctx.reactComponentStack?.length && ctx.reactInspection?.businessStack?.length) {
    ctx.reactComponentStack = ctx.reactInspection.businessStack;
  }

  // Code search root: prefer client-provided path, fall back to env var
  const codeSearchRoot = ctx.codeSearchRoot || process.env.CODE_SEARCH_ROOT || undefined;
  // Attach resolved value so downstream (llmRetrieval) can use it
  ctx.codeSearchRoot = codeSearchRoot;

  // Filter Fiber stack early: keep only components defined in the local codebase
  if (codeSearchRoot && ctx.reactComponentStack?.length) {
    ctx.reactComponentStack = filterFiberStack(ctx.reactComponentStack, codeSearchRoot);
  }

  const useLLM = process.env.USE_LLM === 'true';
  console.log(`[route] analyze-element — mode: ${useLLM ? 'llm' : 'mock'}`);

  try {
    const result = useLLM
      ? await analyzeElementWithLLM(ctx)
      : { ...mockAnalyze(ctx), analysisMode: 'mock' as const };

    // Persist this inspect session so users can browse history
    addEntry(ctx, result);

    return res.json({ success: true, result });
  } catch (err) {
    console.error('[analyze-element] unexpected error:', err);
    return res.status(500).json({ error: 'Analysis failed', details: String(err) });
  }
});

export default router;

