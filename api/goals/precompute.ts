import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { computeAndStoreSimilarGoals } from '../../lib/matching.js';
import { z } from 'zod';

const SimilarGoalsSchema = z.object({
  goalId: z.string().min(1),
  embedding: z.array(z.number()).min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = SimilarGoalsSchema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { goalId, embedding } = v.data;

  const { data: goal } = await supabaseAdmin
    .from('goals')
    .select('owner_id')
    .eq('id', goalId)
    .single();

  if (!goal || goal.owner_id !== auth.userId) {
    return res.status(403).json({ error: 'Forbidden: goal does not belong to you' });
  }

  try {
    const matches = await computeAndStoreSimilarGoals(goalId, embedding, auth.userId);
    res.json({ success: true, matches });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to precompute similarity' });
  }
}
