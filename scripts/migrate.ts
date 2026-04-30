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

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const firestore = admin.firestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function migrateCollection(
  collection: string,
  table: string,
  transform?: (doc: admin.firestore.DocumentData & { id: string }) => Record<string, unknown>
) {
  console.log(`\nMigrating ${collection} → ${table}...`);
  const snap = await firestore.collection(collection).get();
  if (snap.empty) { console.log(`  0 docs — skipping`); return; }

  const rows = snap.docs.map(d => {
    const raw = { id: d.id, ...d.data() };
    return transform ? transform(raw) : raw;
  });

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    if (error) console.error(`  Error at batch ${i}:`, error.message);
    else console.log(`  Upserted ${i + batch.length}/${rows.length}`);
  }
  console.log(`  Done — ${rows.length} docs`);
}

function tsField(val: admin.firestore.Timestamp | string | undefined): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  return val.toDate().toISOString();
}

(async () => {
  await migrateCollection('users', 'users', (d) => ({
    id: d.id,
    email: d.email,
    full_name: d.displayName ?? d.full_name,
    avatar_url: d.avatarUrl ?? d.avatar_url,
    role: d.role ?? 'user',
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  await migrateCollection('goals', 'goals', (d) => ({
    id: d.id,
    owner_id: d.ownerId ?? d.userId,
    title: d.title,
    description: d.description,
    visibility: d.visibility ?? 'public',
    status: d.status ?? 'active',
    group_id: d.groupId ?? null,
    normalized_matching_text: d.normalizedMatchingText ?? null,
    progress_percent: d.progressPercent ?? 0,
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
    updated_at: tsField(d.updatedAt) ?? new Date().toISOString(),
  }));

  await migrateCollection('groups', 'groups', (d) => ({
    id: d.id,
    derived_goal_theme: d.derivedGoalTheme ?? null,
    member_count: d.memberCount ?? 0,
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  await migrateCollection('challenges', 'challenges', (d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  await migrateCollection('reports', 'reports', (d) => ({
    id: d.id,
    reported_user_id: d.reportedUserId,
    reporter_id: d.reporterId,
    reason: d.reason,
    message_id: d.messageId ?? null,
    status: d.status ?? 'pending',
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
    updated_at: tsField(d.updatedAt) ?? null,
  }));

  await migrateCollection('embeddings', 'embeddings', (d) => ({
    id: d.id,
    goal_id: d.goalId,
    embedding: d.embedding,
    created_at: tsField(d.createdAt) ?? new Date().toISOString(),
  }));

  console.log('\nMigration complete.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
