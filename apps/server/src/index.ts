import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import analyzeRouter from './routes/analyze';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Mount routes under /api
app.use('/api', analyzeRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
