import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, nowIso } from '../../../lib/auth.js';
import { supabaseAdmin } from '../../../lib/supabaseAdmin.js';

const REVIEW_WINDOW_SEC = 30;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const mediaId = req.query.mediaId as string;

  const { data: mediaData } = await supabaseAdmin
    .from('one_time_media')
    .select('*')
    .eq('id', mediaId)
    .single();

  if (!mediaData) return res.status(404).json({ error: 'Media not found' });

  const { data: goalSnap } = await supabaseAdmin
    .from('goals')
    .select('id')
    .eq('owner_id', auth.userId)
    .eq('group_id', mediaData.group_id)
    .eq('group_joined', true)
    .limit(1)
    .single();

  if (!goalSnap) return res.status(403).json({ error: 'Must join group to view media' });

  const consumedBy: string[]                  = mediaData.consumed_by ?? [];
  const openedAtMap: Record<string, string>   = mediaData.first_opened_at ?? {};
  const firstOpenedAtIso                       = openedAtMap[auth.userId];

  if (consumedBy.includes(auth.userId) && firstOpenedAtIso) {
    const elapsedSec = (Date.now() - new Date(firstOpenedAtIso).getTime()) / 1000;
    if (elapsedSec > REVIEW_WINDOW_SEC) {
      return res.status(410).json({ error: 'Media already viewed and expired' });
    }
    return res.json({
      type: mediaData.type,
      data: mediaData.data,
      expiresIn: Math.max(1, Math.ceil(REVIEW_WINDOW_SEC - elapsedSec)),
    });
  }

  const nowStr = nowIso();
  await supabaseAdmin.from('one_time_media').update({
    consumed_by:     [...consumedBy, auth.userId],
    first_opened_at: { ...openedAtMap, [auth.userId]: nowStr },
  }).eq('id', mediaId);

  res.json({ type: mediaData.type, data: mediaData.data, expiresIn: REVIEW_WINDOW_SEC });
}
