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

  // Filter Fiber stack early: keep only components defined in the local codebase
  const projectRoot = process.env.CODE_SEARCH_ROOT;
  if (projectRoot && ctx.reactComponentStack?.length) {
    ctx.reactComponentStack = filterFiberStack(ctx.reactComponentStack, projectRoot);
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

