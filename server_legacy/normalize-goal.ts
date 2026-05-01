import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { normalizeGoal } from '../server/gemini.js';
import { z } from 'zod';

const NormalizeGoalSchema = z.object({
  goalData: z.any(),
  userContext: z.any().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await checkRateLimit(auth.userId))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const v = NormalizeGoalSchema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  try {
    const normalizedText = await normalizeGoal(v.data.goalData, v.data.userContext);
    res.json({ normalizedMatchingText: normalizedText });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to normalize goal', details: e.message });
  }
}
