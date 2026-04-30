import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const groupId = req.query.groupId as string;
  if (!groupId) return res.status(400).json({ error: 'groupId required' });

  const { data: groupData } = await supabaseAdmin
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!groupData) return res.status(404).json({ error: 'Group not found' });

  const memberIds: string[]       = groupData.member_ids      || [];
  const eligibleGoalIds: string[] = groupData.eligible_goal_ids || [];

  let allowed = memberIds.includes(auth.userId);
  if (!allowed && eligibleGoalIds.length > 0) {
    const { data: ownedGoals } = await supabaseAdmin
      .from('goals')
      .select('id')
      .eq('owner_id', auth.userId)
      .in('id', eligibleGoalIds);
    allowed = (ownedGoals || []).length > 0;
  }

  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { representative_embedding: _drop, ...safe } = groupData;
  res.json({ id: groupId, ...safe });
}
