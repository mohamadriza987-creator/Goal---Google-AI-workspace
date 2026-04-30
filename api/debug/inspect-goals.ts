import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: goals } = await supabaseAdmin
    .from('goals')
    .select('id, owner_id, title, description, category, visibility, group_id, created_at')
    .order('created_at', { ascending: false })
    .limit(15);

  res.json({ goals: goals || [] });
}
