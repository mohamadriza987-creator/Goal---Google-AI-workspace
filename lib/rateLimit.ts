import { supabaseAdmin } from './supabaseAdmin.js';

const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

const MODERATION_TARGET_WINDOW = 60 * 60 * 1000;
const MODERATION_TARGET_MAX = 3;

export async function checkRateLimit(userId: string): Promise<boolean> {
  const id = `user_${userId}`;
  const now = Date.now();

  const { data: existing } = await supabaseAdmin
    .from('rate_limits')
    .select('count, last_reset')
    .eq('id', id)
    .single();

  if (!existing || now - existing.last_reset > RATE_LIMIT_WINDOW) {
    await supabaseAdmin
      .from('rate_limits')
      .upsert({ id, count: 1, last_reset: now });
    return true;
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) return false;

  await supabaseAdmin
    .from('rate_limits')
    .update({ count: existing.count + 1 })
    .eq('id', id);

  return true;
}

export async function checkModerationTargetLimit(
  reporterId: string,
  targetUserId: string,
): Promise<boolean> {
  const safeKey = `${reporterId}_${targetUserId}`.replace(/[^A-Za-z0-9_]/g, '_');
  const now = Date.now();

  try {
    const { data: existing } = await supabaseAdmin
      .from('moderation_target_limits')
      .select('count, first_at')
      .eq('id', safeKey)
      .single();

    if (!existing || now - existing.first_at > MODERATION_TARGET_WINDOW) {
      await supabaseAdmin
        .from('moderation_target_limits')
        .upsert({ id: safeKey, count: 1, first_at: now, reporter_id: reporterId, target_user_id: targetUserId });
      return true;
    }

    if (existing.count >= MODERATION_TARGET_MAX) return false;

    await supabaseAdmin
      .from('moderation_target_limits')
      .update({ count: existing.count + 1 })
      .eq('id', safeKey);

    return true;
  } catch {
    return false;
  }
}
