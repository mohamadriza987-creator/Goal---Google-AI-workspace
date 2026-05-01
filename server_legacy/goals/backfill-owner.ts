/**
 * POST /api/goals/backfill-owner
 *
 * Migrates goals (and related rows) from a legacy Firebase owner_id to the
 * current Supabase user UUID.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The migration script (scripts/migrate.ts) wrote goals with
 *   owner_id = Firebase UID  (e.g. "abc123XYZ")
 *
 * The Supabase schema enforces:
 *   goals.owner_id → public.users.id → auth.users.id  (all UUIDs)
 *
 * Because Firebase UIDs are not valid auth.users UUIDs, the migration
 * INSERT/UPSERTs would have been rejected by the FK constraint for most rows.
 * Any rows that did land (e.g. inserted before the FK was added, or via a
 * raw connection that deferred constraints) will be invisible to the current
 * user because the app queries owner_id = supabase_uuid.
 *
 * HOW IT WORKS
 * ────────────
 * For Google OAuth users, Firebase and Supabase both store the same Google
 * "sub" claim in their identity tables.  Supabase exposes this as
 *   auth.identities.id  (provider = 'google')
 * That value IS the Firebase UID for Google sign-ins.
 *
 * This endpoint:
 *   1. Looks up the caller's Google identity ID  (= legacy Firebase UID)
 *   2. Finds any rows in goals / tasks / goal_notes / calendar_notes owned
 *      by that legacy UID
 *   3. Re-assigns them to the caller's current Supabase UUID
 *
 * The endpoint is idempotent: if no legacy rows exist it returns
 * { migrated: false } and does nothing.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, cors } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { userId } = auth;

  // ── 1. Resolve the legacy Firebase UID ──────────────────────────────────
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userErr || !user) {
    return res.status(500).json({ error: 'Failed to fetch auth user' });
  }

  // For Google OAuth, identity.id = Google sub claim = Firebase UID
  const googleIdentity = user.identities?.find(i => i.provider === 'google');
  const legacyUid = googleIdentity?.id;

  if (!legacyUid || legacyUid === userId) {
    return res.json({ migrated: false, reason: 'No distinct legacy UID found' });
  }

  // Firebase UIDs (Google sub claims) are numeric strings, not UUIDs.
  // Postgres would throw "invalid input syntax for type uuid" if we try to
  // filter a uuid column with a non-UUID string, so bail out early.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(legacyUid)) {
    return res.json({ migrated: false, reason: 'Legacy UID is not UUID-shaped; no rows to migrate' });
  }

  // ── 2. Check if any goals exist with the legacy UID ──────────────────────
  const { count, error: countErr } = await supabaseAdmin
    .from('goals')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', legacyUid);

  if (countErr) {
    console.error('[backfill-owner] Count query error:', countErr.message);
    return res.status(500).json({ error: 'Count query failed' });
  }

  if (!count) {
    return res.json({ migrated: false, reason: 'No goals found with legacy owner_id' });
  }

  // ── 3. Re-own all rows across every table that references owner/user ──────
  const [goalsRes, tasksRes, notesRes, calRes] = await Promise.all([
    supabaseAdmin.from('goals')       .update({ owner_id: userId }).eq('owner_id', legacyUid),
    supabaseAdmin.from('tasks')       .update({ owner_id: userId }).eq('owner_id', legacyUid),
    supabaseAdmin.from('goal_notes')  .update({ owner_id: userId }).eq('owner_id', legacyUid),
    supabaseAdmin.from('calendar_notes').update({ user_id: userId }).eq('user_id', legacyUid),
  ]);

  const errors = [goalsRes.error, tasksRes.error, notesRes.error, calRes.error].filter(Boolean);
  if (errors.length) {
    console.error('[backfill-owner] Partial failure:', errors.map(e => e?.message));
    return res.status(500).json({
      error: 'Partial failure — some tables may not have been updated',
      details: errors.map(e => e?.message),
    });
  }

  console.log(`[backfill-owner] Migrated ${count} goals: ${legacyUid} → ${userId}`);
  return res.json({ migrated: true, goals_updated: count });
}
