import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { z } from 'zod';

const Schema = z.object({
  groupId:  z.string().min(1),
  threadId: z.string().min(1),
  replyId:  z.string().optional(),
  authorId: z.string().min(1),
  reason:   z.string().min(1).max(500),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { groupId, threadId, replyId, authorId, reason } = v.data;
  if (authorId === auth.userId) return res.status(400).json({ error: 'Cannot report your own content' });

  const { data: group } = await supabaseAdmin
    .from('groups')
    .select('member_ids')
    .eq('id', groupId)
    .single();

  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!(group.member_ids || []).includes(auth.userId)) {
    return res.status(403).json({ error: 'You are not a member of this group' });
  }

  await supabaseAdmin.from('reports').insert({
    reporter_id:      auth.userId,
    reported_user_id: authorId,
    group_id:         groupId,
    thread_id:        threadId,
    reply_id:         replyId || null,
    reason,
    created_at:       nowIso(),
    status:           'pending',
  });

  res.json({ success: true });
}
