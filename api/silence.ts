import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { z } from 'zod';

const Schema = z.object({
  targetUserId: z.string().min(1),
  silent:       z.boolean(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload' });

  const { targetUserId, silent } = v.data;
  if (targetUserId === auth.userId) return res.status(400).json({ error: 'Cannot silence yourself' });

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('silenced_users')
    .eq('id', auth.userId)
    .single();

  const current: string[] = userRow?.silenced_users || [];
  const updated = silent
    ? [...new Set([...current, targetUserId])]
    : current.filter((id) => id !== targetUserId);

  await supabaseAdmin.from('users').update({ silenced_users: updated }).eq('id', auth.userId);

  res.json({ success: true });
}
