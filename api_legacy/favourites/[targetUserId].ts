import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { targetUserId } = req.query;

  await supabaseAdmin
    .from('favourites')
    .delete()
    .eq('owner_id', auth.userId)
    .eq('target_user_id', targetUserId as string);

  res.json({ success: true });
}
