import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) return res.status(403).json({ error: 'Forbidden' });

  const dataset = req.query.dataset as string;

  let query;
  if (dataset === 'group_index') {
    query = supabaseAdmin
      .from('group_index')
      .select('group_id, member_count, categories, languages, age_categories, locations, nationalities, updated_at')
      .limit(100);
  } else if (dataset === 'unassigned_active') {
    query = supabaseAdmin
      .from('goals_unassigned_index')
      .select('goal_id, user_id, age_category, activity_status, categories, languages, current_location, nationality, last_logged_in_at, updated_at')
      .eq('activity_status', 'active')
      .limit(100);
  } else if (dataset === 'unassigned_inactive') {
    query = supabaseAdmin
      .from('goals_unassigned_index')
      .select('goal_id, user_id, age_category, activity_status, categories, languages, current_location, nationality, last_logged_in_at, updated_at')
      .eq('activity_status', 'inactive')
      .limit(100);
  } else {
    return res.status(400).json({ error: 'Invalid dataset' });
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).map((row: any) => ({
    _id: row.group_id || row.goal_id,
    ...row,
  }));

  res.json({ rows });
}
