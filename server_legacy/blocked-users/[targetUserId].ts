import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { targetUserId } = req.query as { targetUserId: string };

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('blocked_users')
    .eq('id', auth.userId)
    .single();

  const current: string[] = userRow?.blocked_users || [];
  const updated = current.filter((id) => id !== targetUserId);

  await supabaseAdmin.from('users').update({ blocked_users: updated }).eq('id', auth.userId);

  res.json({ success: true });
}
