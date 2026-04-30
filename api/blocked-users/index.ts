import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('blocked_users')
    .eq('id', auth.userId)
    .single();

  if (!userRow) return res.json({ blockedUsers: [] });

  const blockedIds: string[] = userRow.blocked_users || [];
  if (blockedIds.length === 0) return res.json({ blockedUsers: [] });

  const { data: profiles } = await supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url')
    .in('id', blockedIds);

  const blockedUsers = blockedIds.map((uid) => {
    const p = (profiles || []).find((u: any) => u.id === uid);
    return {
      userId:      uid,
      displayName: p?.display_name || 'Unknown',
      avatarUrl:   p?.avatar_url   || '',
    };
  });

  res.json({ blockedUsers });
}
