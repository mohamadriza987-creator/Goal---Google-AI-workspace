import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { z } from 'zod';

const Schema = z.object({
  groupId:  z.string().min(1),
  type:     z.enum(['image', 'video']),
  data:     z.string().min(1),
  duration: z.number().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { groupId, type, data, duration } = v.data;

  if (type === 'video' && (duration || 0) > 10) {
    return res.status(400).json({ error: 'Video must be max 10 seconds' });
  }

  const { data: goalSnap } = await supabaseAdmin
    .from('goals')
    .select('id')
    .eq('owner_id', auth.userId)
    .eq('group_id', groupId)
    .eq('group_joined', true)
    .limit(1)
    .single();

  if (!goalSnap) return res.status(403).json({ error: 'Must join group to upload media' });

  const { data: media } = await supabaseAdmin
    .from('one_time_media')
    .insert({
      group_id:    groupId,
      sender_id:   auth.userId,
      type,
      data,
      created_at:  nowIso(),
      consumed_by: [],
      first_opened_at: {},
    })
    .select('id')
    .single();

  res.json({ mediaId: media?.id });
}
