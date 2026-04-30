import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { reconcileAllGoals } from '../../lib/matching.js';

async function hardResetGroups() {
  // Delete all groups (cascades to threads, replies, group_index via FK)
  await supabaseAdmin.from('groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabaseAdmin.from('group_index').delete().neq('group_id', '00000000-0000-0000-0000-000000000000');
  await supabaseAdmin.from('goals_unassigned_index').delete().neq('goal_id', '00000000-0000-0000-0000-000000000000');

  // Clear group references on goals
  await supabaseAdmin.from('goals').update({
    group_id: null,
    group_joined: false,
    eligible_at: null,
    joined_at: null,
  }).neq('id', '00000000-0000-0000-0000-000000000000');

  await reconcileAllGoals();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  hardResetGroups().catch((err) => console.error('Background hard reset failed:', err));
  res.json({ success: true, message: 'Hard reset and rebuild started in background.' });
}
