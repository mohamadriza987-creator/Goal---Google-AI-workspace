import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const adminEmail = (process.env.ADMIN_EMAIL || 'mohamadriza987@gmail.com').toLowerCase();
  if (auth.userEmail?.toLowerCase() !== adminEmail) {
    return res.status(403).json({ error: 'Forbidden: not the configured admin email' });
  }

  await supabaseAdmin.from('users').upsert({ id: auth.userId, role: 'admin' });

  res.json({
    success: true,
    message: 'Admin role set. Your next token will include admin access.',
  });
}
