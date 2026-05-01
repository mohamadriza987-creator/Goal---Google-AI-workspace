import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin, nowIso } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { setGeminiModelOrder } from '../../server/gemini.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('admin_settings')
      .select('model_order')
      .eq('id', 'gemini')
      .single();
    return res.json({ modelOrder: data?.model_order ?? [] });
  }

  if (req.method === 'POST') {
    const { modelOrder } = req.body;
    if (!Array.isArray(modelOrder) || modelOrder.length > 5) {
      return res.status(400).json({ error: 'modelOrder must be an array of up to 5 strings' });
    }
    const cleaned: string[] = modelOrder.map((m: any) => (typeof m === 'string' ? m.trim() : ''));
    await supabaseAdmin.from('admin_settings').upsert({
      id: 'gemini',
      model_order: cleaned,
      updated_at: nowIso(),
    });
    setGeminiModelOrder(cleaned);
    return res.json({ ok: true, modelOrder: cleaned });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
