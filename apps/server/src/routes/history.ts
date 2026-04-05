import { Router, Request, Response } from 'express';
import * as historyStore from '../services/historyStore';

const router = Router();

/** List all history entries (newest first) */
router.get('/history', (_req: Request, res: Response) => {
  res.json({ entries: historyStore.getAll() });
});

/** Get a single history entry by id */
router.get('/history/:id', (req: Request, res: Response) => {
  const entry = historyStore.getById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  return res.json({ entry });
});

/** Delete a single history entry */
router.delete('/history/:id', (req: Request, res: Response) => {
  const ok = historyStore.deleteById(req.params.id);
  return res.json({ success: ok });
});

/** Clear all history */
router.delete('/history', (_req: Request, res: Response) => {
  historyStore.clearAll();
  return res.json({ success: true });
});

export default router;
