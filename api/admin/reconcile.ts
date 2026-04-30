import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { reconcileAllGoals } from '../../lib/matching.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    await reconcileAllGoals();
    res.json({ success: true, message: 'Reconciliation complete.' });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to reconcile goals', details: e.message });
  }
}
