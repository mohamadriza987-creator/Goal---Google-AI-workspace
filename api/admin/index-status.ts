import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { BACKFILL_FLAG } from '../../lib/matching.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) return res.status(403).json({ error: 'Forbidden' });

  const [
    { data: flagDoc },
    { count: groupCount },
    { count: activeCount },
    { count: inactiveCount },
  ] = await Promise.all([
    supabaseAdmin.from('admin_flags').select('*').eq('id', BACKFILL_FLAG).single(),
    supabaseAdmin.from('group_index').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('goals_unassigned_index').select('*', { count: 'exact', head: true }).eq('activity_status', 'active'),
    supabaseAdmin.from('goals_unassigned_index').select('*', { count: 'exact', head: true }).eq('activity_status', 'inactive'),
  ]);

  res.json({
    projectId: 'supabase',
    flag: flagDoc || null,
    counts: {
      groupIndex:         groupCount ?? 0,
      unassignedActive:   activeCount ?? 0,
      unassignedInactive: inactiveCount ?? 0,
    },
  });
}
