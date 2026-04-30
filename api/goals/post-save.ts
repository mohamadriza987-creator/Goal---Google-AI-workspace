import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import {
  findOrCreateGroupForGoal,
  computeAndStoreSimilarGoals,
  runIndexedMatching,
} from '../../lib/matching.js';
import { z } from 'zod';

const PostSaveSchema = z.object({
  goalId: z.string().min(1),
  embedding: z.array(z.number()),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = PostSaveSchema.safeParse(req.body);
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
    const [assignResult, matches, indexResult] = await Promise.allSettled([
      findOrCreateGroupForGoal(goalId),
      computeAndStoreSimilarGoals(goalId, embedding, auth.userId),
      runIndexedMatching(goalId),
    ]);

    const assignValue = assignResult.status === 'fulfilled' ? assignResult.value : null;
    const matchesValue = matches.status === 'fulfilled' ? matches.value : [];
    const indexValue = indexResult.status === 'fulfilled' ? indexResult.value : null;

    res.json({
      success: true,
      groupId: assignValue?.groupId ?? null,
      groupAction: assignValue?.action ?? 'none',
      matchesCount: Array.isArray(matchesValue) ? matchesValue.length : 0,
      indexed: !!indexValue,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to finalize goal', details: e.message });
  }
}
