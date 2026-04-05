import { Router, Request, Response } from 'express';
import { ElementContext } from '../types';
import { analyzeElement } from '../services/mockRetrieval';

const router = Router();

router.post('/analyze-element', (req: Request, res: Response) => {
  const ctx = req.body as ElementContext;

  if (!ctx?.selectedElement?.tag) {
    return res.status(400).json({ error: 'Invalid element context: missing selectedElement' });
  }

  try {
    const result = analyzeElement(ctx);
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[analyze-element] error:', err);
    return res.status(500).json({ error: 'Analysis failed', details: String(err) });
  }
});

export default router;
