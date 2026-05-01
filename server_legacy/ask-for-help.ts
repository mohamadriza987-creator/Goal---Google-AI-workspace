import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { z } from 'zod';

const Schema = z.object({
  goalId:       z.string().min(1),
  groupId:      z.string().min(1),
  taskText:     z.string().min(1).max(500),
  description:  z.string().max(1000).optional(),
  authorName:   z.string().min(1),
  authorAvatar: z.string().optional(),
  notifyUserIds: z.array(z.string()).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const v = Schema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload' });

  const { goalId, groupId, taskText, description, authorName, authorAvatar, notifyUserIds } = v.data;
  const now = nowIso();

  const { data: thread } = await supabaseAdmin
    .from('threads')
    .insert({
      group_id:         groupId,
      goal_id:          goalId,
      badge:            'help',
      title:            taskText,
      linked_task_text: taskText,
      author_id:        auth.userId,
      author_name:      authorName,
      author_avatar:    authorAvatar || '',
      preview_text:     description || 'Asking for help with this task.',
      reply_count:      0,
      useful_count:     0,
      reactions:        {},
      is_pinned:        false,
      created_at:       now,
      last_activity_at: now,
    })
    .select('id')
    .single();

  if (!thread) return res.status(500).json({ error: 'Failed to create thread' });

  if (notifyUserIds && notifyUserIds.length > 0) {
    await supabaseAdmin.from('notifications').insert(
      notifyUserIds.map((uid) => ({
        type:          'help_request',
        to_user_id:    uid,
        from_user_id:  auth.userId,
        from_name:     authorName,
        thread_id:     thread.id,
        group_id:      groupId,
        task_text:     taskText,
        read:          false,
        created_at:    now,
      }))
    );
  }

  res.json({ success: true, threadId: thread.id });
}
