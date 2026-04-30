import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { z } from 'zod';

const FavouriteSchema = z.object({
  targetUserId:    z.string().min(1),
  targetUserName:  z.string().min(1),
  targetAvatarUrl: z.string().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('favourites')
      .select('*')
      .eq('owner_id', auth.userId)
      .order('created_at', { ascending: false });
    return res.json({ favourites: data || [] });
  }

  if (req.method === 'POST') {
    const v = FavouriteSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: 'Invalid payload' });
    const { targetUserId, targetUserName, targetAvatarUrl } = v.data;
    if (targetUserId === auth.userId) return res.status(400).json({ error: 'Cannot favourite yourself' });

    const { data: existing } = await supabaseAdmin
      .from('favourites')
      .select('id')
      .eq('owner_id', auth.userId)
      .eq('target_user_id', targetUserId)
      .limit(1)
      .single();

    if (existing) return res.json({ success: true, alreadyFavourited: true });

    await supabaseAdmin.from('favourites').insert({
      owner_id:          auth.userId,
      target_user_id:    targetUserId,
      target_user_name:  targetUserName,
      target_avatar_url: targetAvatarUrl || '',
      created_at:        nowIso(),
    });
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
