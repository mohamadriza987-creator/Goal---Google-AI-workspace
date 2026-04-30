import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { data: joinedGoals } = await supabaseAdmin
    .from('goals')
    .select('id, title, group_id, joined_at')
    .eq('owner_id', auth.userId)
    .eq('group_joined', true)
    .not('group_id', 'is', null);

  if (!joinedGoals || joinedGoals.length === 0) return res.json({ joinedGroups: [] });

  const groupIds = joinedGoals.map((g: any) => g.group_id);
  const { data: groups } = await supabaseAdmin
    .from('groups')
    .select('id, member_count')
    .in('id', groupIds);

  const joinedGroups = joinedGoals.map((g: any) => {
    const grp = (groups || []).find((gr: any) => gr.id === g.group_id);
    return {
      groupId:     g.group_id,
      goalId:      g.id,
      goalTitle:   g.title,
      joinedAt:    g.joined_at,
      memberCount: grp?.member_count || 0,
    };
  });

  res.json({ joinedGroups });
}
