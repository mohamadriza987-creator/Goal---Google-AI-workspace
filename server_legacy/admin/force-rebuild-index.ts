import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { backfillIndexIfNeeded, backfillMissingLastLoggedIn, BACKFILL_FLAG } from '../../lib/matching.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) return res.status(403).json({ error: 'Forbidden' });

  try {
    const fixResult = await backfillMissingLastLoggedIn();
    await supabaseAdmin.from('admin_flags').delete().eq('id', BACKFILL_FLAG);
    const result = await backfillIndexIfNeeded();
    res.json({ success: true, ...result, fixedMissingLastLoggedIn: fixResult.fixed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
