import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { checkRateLimit, checkModerationTargetLimit } from '../../lib/rateLimit.js';
import { z } from 'zod';

const Schema = z.object({
  targetUserId: z.string().min(1),
  action:       z.enum(['hide', 'block', 'report']),
  context:      z.string().max(200).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await checkRateLimit(auth.userId))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { targetUserId, action, context } = v.data;
  if (targetUserId === auth.userId) return res.status(400).json({ error: 'Cannot moderate yourself' });

  if (!(await checkModerationTargetLimit(auth.userId, targetUserId))) {
    return res.status(429).json({
      error: "You've already reported this user multiple times recently. Please wait before signalling again.",
    });
  }

  await supabaseAdmin.from('moderation_events').insert({
    reporter_id:    auth.userId,
    target_user_id: targetUserId,
    action,
    context:        context || null,
    created_at:     nowIso(),
    status:         'pending',
  });

  if (action === 'hide' || action === 'block') {
    const field = action === 'hide' ? 'hidden_users' : 'blocked_users';
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select(field)
      .eq('id', auth.userId)
      .single();
    const current: string[] = (userRow as any)?.[field] || [];
    if (!current.includes(targetUserId)) {
      await supabaseAdmin.from('users').update({ [field]: [...current, targetUserId] }).eq('id', auth.userId);
    }
  }

  res.json({ success: true });
}
