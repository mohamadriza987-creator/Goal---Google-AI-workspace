import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../../lib/auth.js';
import { supabaseAdmin } from '../../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const goalId = req.query.goalId as string;

  const { data: goalData } = await supabaseAdmin
    .from('goals')
    .select('owner_id, visibility, group_id')
    .eq('id', goalId)
    .single();

  if (!goalData) return res.status(404).json({ error: 'Goal not found' });
  if (goalData.owner_id !== auth.userId && goalData.visibility !== 'public') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const groupId: string | undefined = goalData.group_id;
  if (!groupId) return res.json({ members: [], similarTasks: [], popularTasks: [] });

  const { data: groupData } = await supabaseAdmin
    .from('groups')
    .select('members')
    .eq('id', groupId)
    .single();

  if (!groupData) return res.json({ members: [], similarTasks: [], popularTasks: [] });

  const rawMembers: { goalId: string; userId: string; joinedAt: string }[] =
    (groupData.members || []).filter((m: any) => m.goalId !== goalId);
  const slicedMembers = rawMembers.slice(0, 6);

  if (slicedMembers.length === 0) return res.json({ members: [], similarTasks: [], popularTasks: [] });

  const goalIds = slicedMembers.map((m) => m.goalId);
  const userIds = slicedMembers.map((m) => m.userId);

  const [{ data: memberGoals }, { data: memberUsers }, { data: memberTasks }] = await Promise.all([
    supabaseAdmin.from('goals').select('id, title, description, progress_percent').in('id', goalIds),
    supabaseAdmin.from('users').select('id, display_name, avatar_url').in('id', userIds),
    supabaseAdmin
      .from('tasks')
      .select('goal_id, text, is_done')
      .in('goal_id', goalIds)
      .order('order', { ascending: true })
      .limit(20 * slicedMembers.length),
  ]);

  const allActiveTexts: string[] = [];

  const members = slicedMembers.map((m) => {
    const mg = (memberGoals || []).find((g: any) => g.id === m.goalId);
    const u  = (memberUsers || []).find((u: any) => u.id === m.userId);
    if (!mg) return null;

    const goalTasks = (memberTasks || []).filter((t: any) => t.goal_id === m.goalId);
    const activeTasks   = goalTasks.filter((t: any) => !t.is_done).map((t: any) => t.text as string).slice(0, 10);
    const completedTasks = goalTasks.filter((t: any) => t.is_done).map((t: any) => t.text as string).slice(0, 10);

    activeTasks.forEach((t: string) => allActiveTexts.push(t));

    return {
      userId:          m.userId,
      displayName:     u?.display_name || 'Unknown',
      avatarUrl:       u?.avatar_url   || '',
      goalTitle:       mg.title         || '',
      goalDescription: mg.description   || '',
      progressPercent: mg.progress_percent ?? 0,
      joinedAt:        m.joinedAt,
      activeTasks,
      completedTasks,
    };
  }).filter(Boolean);

  const counts = new Map<string, { text: string; count: number }>();
  allActiveTexts.forEach((text) => {
    const key = text.toLowerCase().trim();
    if (counts.has(key)) counts.get(key)!.count++;
    else counts.set(key, { text, count: 1 });
  });

  const popularTasks = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const seen = new Set(popularTasks.map((t) => t.text.toLowerCase().trim()));
  const similarTasks = allActiveTexts
    .filter((t) => !seen.has(t.toLowerCase().trim()))
    .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .slice(0, 8)
    .map((text) => ({ text }));

  res.json({ members, similarTasks, popularTasks });
}
