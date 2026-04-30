import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, isAdmin } from '../../lib/auth.js';
import { backfillIndexIfNeeded } from '../../lib/matching.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await isAdmin(auth.userId, auth.userEmail))) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const result = await backfillIndexIfNeeded();
    res.json({
      success: true,
      ...result,
      message: result.ran
        ? `Backfill complete: ${result.groups} groups, ${result.goals} unassigned goals indexed.`
        : 'Backfill already completed previously — nothing to do.',
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to run backfill', details: e.message });
  }
}
