import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { generateGoal } from '../server/gemini.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await checkRateLimit(auth.userId))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const { text, audioBase64, mimeType, userContext } = req.body;
  if (!text && !audioBase64) {
    return res.status(400).json({ error: 'text or audioBase64 required' });
  }

  try {
    const input: { text: string } | { audioBase64: string; mimeType: string } =
      text ? { text } : { audioBase64, mimeType };
    const structuredGoal = await generateGoal(input, userContext);
    res.json(structuredGoal);
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to generate goal', details: e.message });
  }
}
