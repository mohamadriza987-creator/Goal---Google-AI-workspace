import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { getModelCallStats } from '../../server/gemini.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) return res.status(403).json({ error: 'Forbidden' });

  const windowMs = 15 * 60 * 1000;
  res.json({ stats: getModelCallStats(windowMs), windowMs });
}
