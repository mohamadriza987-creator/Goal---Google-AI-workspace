import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../../lib/auth.js';
import { supabaseAdmin } from '../../../lib/supabaseAdmin.js';
import { z } from 'zod';

const CopyTaskSchema = z.object({
  text:  z.string().min(1).max(500),
  notes: z.string().max(1000).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const v = CopyTaskSchema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload' });

  const goalId = req.query.goalId as string;
  const { text, notes } = v.data;

  const { data: goal } = await supabaseAdmin
    .from('goals')
    .select('owner_id')
    .eq('id', goalId)
    .single();

  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  if (goal.owner_id !== auth.userId) return res.status(403).json({ error: 'Forbidden' });

  const { data: maxOrderTask } = await supabaseAdmin
    .from('tasks')
    .select('order')
    .eq('goal_id', goalId)
    .order('order', { ascending: false })
    .limit(1)
    .single();

  const maxOrder = maxOrderTask?.order ?? 0;

  const taskData: Record<string, any> = {
    goal_id:   goalId,
    owner_id:  auth.userId,
    text:      text.trim(),
    source:    'manual',
    order:     maxOrder + 1,
    is_done:   false,
    created_at: nowIso(),
  };

  const { data: newTask } = await supabaseAdmin
    .from('tasks')
    .insert(taskData)
    .select('id')
    .single();

  if (notes?.trim() && newTask) {
    await supabaseAdmin.from('goal_notes').insert({
      task_id:    newTask.id,
      goal_id:    goalId,
      owner_id:   auth.userId,
      text:       notes.trim(),
      created_at: nowIso(),
    });
  }

  res.json({ success: true, taskId: newTask?.id });
}
