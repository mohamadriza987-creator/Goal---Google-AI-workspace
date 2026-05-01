import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { z } from 'zod';

const Schema = z.object({
  targetUserId: z.string().min(1),
  senderName:   z.string().min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload' });

  const { targetUserId, senderName } = v.data;
  if (targetUserId === auth.userId) return res.status(400).json({ error: 'Cannot poke yourself' });

  await supabaseAdmin.from('notifications').insert({
    type:          'poke',
    to_user_id:    targetUserId,
    from_user_id:  auth.userId,
    from_name:     senderName,
    read:          false,
    created_at:    nowIso(),
  });

  res.json({ success: true });
}
