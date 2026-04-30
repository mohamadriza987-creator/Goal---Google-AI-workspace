import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { removeGoalFromUnassignedIndex, upsertGroupIndex } from '../../lib/matching.js';
import { z } from 'zod';

const Schema = z.object({
  goalId:  z.string().min(1),
  groupId: z.string().min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { goalId, groupId } = v.data;
  const userId = auth.userId;

  const { data: goalData } = await supabaseAdmin
    .from('goals')
    .select('owner_id, group_id')
    .eq('id', goalId)
    .single();

  if (!goalData || goalData.owner_id !== userId || goalData.group_id !== groupId) {
    return res.status(403).json({ error: 'Not eligible for this group' });
  }

  const { data: gData } = await supabaseAdmin
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!gData) return res.status(404).json({ error: 'Group not found' });

  const members: any[]        = gData.members        || [];
  const memberIds: string[]   = gData.member_ids     || [];
  const eligibleGoalIds: string[] = gData.eligible_goal_ids || [];

  if (!eligibleGoalIds.includes(goalId)) {
    return res.status(403).json({ error: 'Goal is not eligible for this group' });
  }

  const alreadyMember = members.some((m: any) => m.goalId === goalId);
  if (alreadyMember) return res.json({ success: true, groupId });

  const currentCount = typeof gData.member_count === 'number' ? gData.member_count : members.length;
  if (typeof gData.max_members === 'number' && currentCount >= gData.max_members) {
    return res.status(403).json({ error: 'Group is full' });
  }

  const joinedAt = nowIso();
  const newMembers = [...members, { goalId, userId, joinedAt }];
  const newMemberIds = memberIds.includes(userId) ? memberIds : [...memberIds, userId];

  await supabaseAdmin.from('groups').update({
    members:      newMembers,
    member_ids:   newMemberIds,
    member_count: newMemberIds.length,
  }).eq('id', groupId);

  await supabaseAdmin.from('goals').update({
    group_joined: true,
    joined_at:    joinedAt,
  }).eq('id', goalId);

  removeGoalFromUnassignedIndex(goalId).catch(console.error);
  upsertGroupIndex(groupId).catch(console.error);

  res.json({ success: true, groupId });
}
