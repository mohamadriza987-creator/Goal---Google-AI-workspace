import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    return res.json({ reports: data || [] });
  }

  if (req.method === 'PATCH') {
    const { reportId, status } = req.body;
    if (!reportId || !['resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'reportId and valid status required' });
    }
    await supabaseAdmin.from('reports').update({ status, updated_at: new Date().toISOString() }).eq('id', reportId);
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
