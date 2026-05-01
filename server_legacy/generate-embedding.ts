import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { generateEmbedding } from '../server/gemini.js';
import { z } from 'zod';

const EmbeddingSchema = z.object({
  text: z.string().min(1).max(5000),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await checkRateLimit(auth.userId))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const v = EmbeddingSchema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  try {
    const embedding = await generateEmbedding(v.data.text);
    res.json({ embedding });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to generate embedding', details: e.message });
  }
}
