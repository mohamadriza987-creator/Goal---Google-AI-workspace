/**
 * One-time migration: Firebase Firestore → Supabase
 *
 * Prerequisites (devDependencies):
 *   firebase-admin  – reads source Firestore collections
 *   @supabase/supabase-js – writes to destination Supabase tables
 *
 * Required env vars:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:  npm run migrate
 */
import * as admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error('Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const firestore = admin.firestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function tsField(val: admin.firestore.Timestamp | string | undefined): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  return val.toDate().toISOString();
}

async function migrateCollection(
  collection: string,
  table: string,
  transform: (doc: admin.firestore.DocumentData & { id: string }) => Record<string, unknown>
) {
  console.log(`\nMigrating ${collection} → ${table}...`);
  const snap = await firestore.collection(collection).get();
  if (snap.empty) { console.log(`  0 docs — skipping`); return; }

  const rows = snap.docs.map(d => transform({ id: d.id, ...d.data() }));

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (error) console.error(`  Error at batch ${i}:`, error.message);
    else console.log(`  Upserted ${i + batch.length}/${rows.length}`);
  }
  console.log(`  Done — ${rows.length} docs`);
}

(async () => {
  // ── users ───────────────────────────────────────────────────────────────
  // Schema: id, email, display_name, username, avatar_url, role,
  //         age, locality, nationality, languages, preferred_language,
  //         last_logged_in_at, blocked_users, hidden_users, silenced_users,
  //         created_at
  await migrateCollection('users', 'users', (d) => ({
    id:                d.id,
    email:             d.email ?? null,
    display_name:      d.displayName ?? d.display_name ?? null,
    username:          d.username ?? null,
    avatar_url:        d.avatarUrl ?? d.avatar_url ?? null,
    role:              d.role ?? 'user',
    age:               d.age ?? null,
    locality:          d.locality ?? null,
    nationality:       d.nationality ?? null,
    languages:         d.languages ?? [],
    preferred_language: d.preferredLanguage ?? d.preferred_language ?? null,
    last_logged_in_at: tsField(d.lastLoggedInAt) ?? null,
    blocked_users:     d.blockedUsers ?? d.blocked_users ?? [],
    hidden_users:      d.hiddenUsers ?? d.hidden_users ?? [],
    silenced_users:    d.silencedUsers ?? d.silenced_users ?? [],
    created_at:        tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  // ── goals ────────────────────────────────────────────────────────────────
  // Schema: id, owner_id, temp_id, title, description, category, categories,
  //         tags, time_horizon, progress_percent, status, visibility,
  //         public_fields, source_text, normalized_matching_text, embedding,
  //         embedding_updated_at, matching_metadata, group_id, group_joined,
  //         joined_at, eligible_at, similar_goals, similarity_computed_at,
  //         created_at
  await migrateCollection('goals', 'goals', (d) => ({
    id:                       d.id,
    owner_id:                 d.ownerId ?? d.owner_id ?? d.userId,
    title:                    d.title ?? null,
    description:              d.description ?? null,
    category:                 d.category ?? null,
    categories:               d.categories ?? [],
    tags:                     d.tags ?? [],
    time_horizon:             d.timeHorizon ?? d.time_horizon ?? null,
    progress_percent:         d.progressPercent ?? d.progress_percent ?? 0,
    status:                   d.status ?? 'active',
    visibility:               d.visibility ?? 'public',
    public_fields:            d.publicFields ?? d.public_fields ?? [],
    source_text:              d.sourceText ?? d.source_text ?? null,
    normalized_matching_text: d.normalizedMatchingText ?? d.normalized_matching_text ?? null,
    matching_metadata:        d.matchingMetadata ?? d.matching_metadata ?? null,
    group_id:                 d.groupId ?? d.group_id ?? null,
    group_joined:             d.groupJoined ?? d.group_joined ?? false,
    joined_at:                tsField(d.joinedAt) ?? null,
    eligible_at:              tsField(d.eligibleAt) ?? null,
    created_at:               tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  // ── groups ───────────────────────────────────────────────────────────────
  // Schema: id, derived_goal_theme, representative_embedding, locality_center,
  //         max_members, member_count, members, member_ids, eligible_goal_ids,
  //         matching_criteria, created_at
  await migrateCollection('groups', 'groups', (d) => ({
    id:                  d.id,
    derived_goal_theme:  d.derivedGoalTheme ?? d.derived_goal_theme ?? null,
    locality_center:     d.localityCenter ?? d.locality_center ?? null,
    max_members:         d.maxMembers ?? d.max_members ?? 70,
    member_count:        d.memberCount ?? d.member_count ?? 0,
    members:             d.members ?? [],
    member_ids:          d.memberIds ?? d.member_ids ?? [],
    eligible_goal_ids:   d.eligibleGoalIds ?? d.eligible_goal_ids ?? [],
    matching_criteria:   d.matchingCriteria ?? d.matching_criteria ?? null,
    created_at:          tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  // ── reports ──────────────────────────────────────────────────────────────
  // Schema: id, reporter_id, reported_user_id, group_id, thread_id, reply_id,
  //         reason, status, created_at, updated_at
  await migrateCollection('reports', 'reports', (d) => ({
    id:               d.id,
    reporter_id:      d.reporterId ?? d.reporter_id,
    reported_user_id: d.reportedUserId ?? d.reported_user_id ?? null,
    group_id:         d.groupId ?? d.group_id ?? null,
    thread_id:        d.threadId ?? d.thread_id ?? null,
    reply_id:         d.replyId ?? d.reply_id ?? null,
    reason:           d.reason ?? null,
    status:           d.status ?? 'pending',
    created_at:       tsField(d.createdAt) ?? new Date().toISOString(),
    updated_at:       tsField(d.updatedAt) ?? null,
  }));

  console.log('\nMigration complete.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
