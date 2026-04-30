import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { generateMicroSteps } from '../../server/gemini.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { taskText } = req.body;
  if (!taskText?.trim()) return res.status(400).json({ error: 'taskText required' });

  try {
    const steps = await generateMicroSteps(taskText.trim());
    res.json({ steps });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to generate micro-steps' });
  }
}
