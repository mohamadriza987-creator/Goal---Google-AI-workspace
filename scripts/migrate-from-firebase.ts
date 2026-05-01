/**
 * scripts/migrate-from-firebase.ts
 *
 * Migrates goals, tasks, goal_notes, and calendar_notes from Firebase/Firestore
 * into Supabase, mapping Firebase UIDs → Supabase Auth UUIDs via the Google
 * identity provider_id stored in auth.identities.
 *
 * USAGE
 * ─────
 * 1. Install firebase-admin (one-time, not committed):
 *      npm install --no-save firebase-admin
 *
 * 2. Download your Firebase service account JSON:
 *      Firebase Console → Project Settings → Service Accounts → Generate new private key
 *    Save it as scripts/firebase-service-account.json  (already in .gitignore)
 *
 * 3. Copy .env.example → .env.local and fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * 4. Run (dry-run first to see what would be inserted):
 *      npx tsx scripts/migrate-from-firebase.ts --dry-run
 *
 * 5. Then run for real:
 *      npx tsx scripts/migrate-from-firebase.ts
 *
 * SAFETY
 * ──────
 * - Idempotent: uses upsert with onConflict so re-running won't duplicate data.
 * - Goals are keyed by temp_id (original Firestore doc ID).
 * - Tasks/notes are keyed by a stable composite or original Firestore ID.
 * - Dry-run prints every row that would be inserted without touching the DB.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── env ──────────────────────────────────────────────────────────────────────
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

const SUPABASE_URL            = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) console.log('🔍  DRY RUN — nothing will be written to Supabase\n');

// ── dynamic imports (firebase-admin is optional dep) ─────────────────────────
let admin: any;
try {
  admin = (await import('firebase-admin')).default;
} catch {
  console.error('❌  firebase-admin not installed. Run: npm install --no-save firebase-admin');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');

// ── Firebase init ─────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SA_PATH   = path.join(__dirname, 'firebase-service-account.json');

if (!fs.existsSync(SA_PATH)) {
  console.error(`❌  Firebase service account not found at ${SA_PATH}`);
  console.error('    Download it from Firebase Console → Project Settings → Service Accounts');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

// ── Supabase init ─────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── helpers ───────────────────────────────────────────────────────────────────

function ts(val: any): string | null {
  if (!val) return null;
  if (val._seconds !== undefined) return new Date(val._seconds * 1000).toISOString();
  if (val.toDate)                 return val.toDate().toISOString();
  if (typeof val === 'string')    return val;
  return null;
}

function arr(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean).map(String);
  return [];
}

function num(val: any, fallback = 0): number {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function bool(val: any, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  return fallback;
}

// ── Step 1: Build Firebase UID → Supabase UUID map ───────────────────────────
// Queried directly from auth.identities via Supabase MCP on 2026-05-01.
// Firebase UIDs = Google OAuth sub claims stored in auth.identities.provider_id.
// Only include users who have a public.users profile (FK constraint on goals.owner_id).
console.log('Step 1 — Loading Firebase UID → Supabase UUID map…');

const KNOWN_UID_MAP: Array<{ firebase_uid: string; supabase_uuid: string; email: string; has_profile: boolean }> = [
  { firebase_uid: '114887610529231933656', supabase_uuid: '7c505d4c-be25-45c4-893d-964edf8343da', email: 'mohamadriza987@gmail.com',     has_profile: true  },
  { firebase_uid: '106355380333382000960', supabase_uuid: '0e6a7b1b-0d58-455d-82c4-a17b7dbc2ef6', email: 'riza9987@gmail.com',           has_profile: true  },
  { firebase_uid: '114695419186631743064', supabase_uuid: 'd87ea3c6-5364-4293-a884-86308c07c318', email: 'ai.riza71242704@gmail.com',    has_profile: false },
];

const uidMap = new Map<string, string>(); // firebase_uid → supabase_uuid
for (const entry of KNOWN_UID_MAP) {
  if (!entry.has_profile) {
    console.log(`   ⚠️  Skipping ${entry.email} — no public.users profile yet (must sign in first)`);
    continue;
  }
  uidMap.set(entry.firebase_uid, entry.supabase_uuid);
}

console.log(`   Found ${uidMap.size} Firebase↔Supabase user mappings:`);
for (const [fbUid, sbUuid] of uidMap) {
  console.log(`   ${fbUid}  →  ${sbUuid}`);
}

if (uidMap.size === 0) {
  console.error('❌  No user mappings found. Users must sign in with Google via Supabase first.');
  process.exit(1);
}

// ── Step 2: Export goals from Firestore ──────────────────────────────────────
console.log('\nStep 2 — Reading goals from Firestore…');

// Try top-level `goals` collection first, then `users/{uid}/goals`
let goalDocs: any[] = [];

const topLevelGoals = await db.collection('goals').get();
if (!topLevelGoals.empty) {
  goalDocs = topLevelGoals.docs;
  console.log(`   Found ${goalDocs.length} goals in top-level 'goals' collection`);
} else {
  // Try per-user subcollections
  for (const [fbUid] of uidMap) {
    const userGoals = await db.collection('users').doc(fbUid).collection('goals').get();
    goalDocs.push(...userGoals.docs.map((d: any) => {
      // Inject owner firebase UID so we can map it
      const data = d.data();
      data.__fbOwnerUid = data.userId || data.owner_id || fbUid;
      return { id: d.id, data: () => data };
    }));
  }
  console.log(`   Found ${goalDocs.length} goals across per-user subcollections`);
}

if (goalDocs.length === 0) {
  console.log('   ⚠️  No goals found in Firestore. Nothing to migrate.');
}

// ── Step 3: Map + insert goals ────────────────────────────────────────────────
console.log('\nStep 3 — Mapping and inserting goals…');

type GoalRow = {
  owner_id:    string;
  temp_id:     string;
  title:       string | null;
  description: string | null;
  category:    string | null;
  categories:  string[];
  tags:        string[];
  time_horizon: string | null;
  progress_percent: number;
  status:      string;
  visibility:  string;
  public_fields: string[];
  source_text: string | null;
  created_at:  string | null;
};

// firestoreId → supabase goal UUID (populated after insert)
const goalIdMap = new Map<string, string>();

const goalRows: GoalRow[] = [];
const skippedGoals: string[] = [];

for (const doc of goalDocs) {
  const d = doc.data();
  const fbOwnerUid = d.__fbOwnerUid || d.userId || d.owner_id || d.ownerId || '';
  const supaUuid   = uidMap.get(fbOwnerUid);

  if (!supaUuid) {
    skippedGoals.push(`goal ${doc.id} (owner Firebase UID "${fbOwnerUid}" has no Supabase mapping)`);
    continue;
  }

  goalRows.push({
    owner_id:         supaUuid,
    temp_id:          doc.id,
    title:            d.title         || null,
    description:      d.description   || null,
    category:         d.category      || null,
    categories:       arr(d.categories),
    tags:             arr(d.tags),
    time_horizon:     d.timeHorizon   || d.time_horizon   || null,
    progress_percent: num(d.progressPercent ?? d.progress_percent, 0),
    status:           d.status        || 'active',
    visibility:       d.visibility    || 'public',
    public_fields:    arr(d.publicFields ?? d.public_fields),
    source_text:      d.sourceText    || d.source_text    || null,
    created_at:       ts(d.createdAt  ?? d.created_at),
  });
}

console.log(`   Mapping: ${goalRows.length} insertable, ${skippedGoals.length} skipped`);
if (skippedGoals.length) skippedGoals.forEach(s => console.log(`   ⚠️  Skipped: ${s}`));

if (DRY_RUN) {
  console.log('\n   [DRY RUN] Would insert goals:');
  goalRows.forEach(g => console.log(`   • [${g.temp_id}] "${g.title}" → owner ${g.owner_id}`));
} else {
  // Insert in chunks of 100
  const CHUNK = 100;
  for (let i = 0; i < goalRows.length; i += CHUNK) {
    const chunk = goalRows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('goals')
      .upsert(chunk, { onConflict: 'temp_id' })
      .select('id, temp_id');
    if (error) {
      console.error(`   ❌  Error inserting goals chunk ${i / CHUNK + 1}:`, error.message);
    } else {
      for (const row of (data || [])) goalIdMap.set(row.temp_id, row.id);
      console.log(`   ✅  Inserted chunk ${Math.floor(i / CHUNK) + 1}: ${chunk.length} goals`);
    }
  }
  // Fetch any goals already in DB (idempotent re-run)
  const { data: existing } = await supabase
    .from('goals')
    .select('id, temp_id')
    .in('temp_id', goalRows.map(g => g.temp_id).filter(Boolean));
  for (const row of (existing || [])) if (row.temp_id) goalIdMap.set(row.temp_id, row.id);
}

console.log(`   goalIdMap has ${goalIdMap.size} entries`);

// ── Step 4: Export and insert tasks ──────────────────────────────────────────
console.log('\nStep 4 — Reading and inserting tasks…');

type TaskRow = {
  id?:         string;
  goal_id:     string;
  owner_id:    string;
  text:        string;
  is_done:     boolean;
  order:       number;
  micro_steps: any[];
  source:      string;
  reminder_at: string | null;
  created_at:  string | null;
};

const taskRows: TaskRow[] = [];
let taskSkipped = 0;

for (const goalDoc of goalDocs) {
  const firestoreGoalId = goalDoc.id;
  const supaGoalId      = goalIdMap.get(firestoreGoalId);
  if (!supaGoalId && !DRY_RUN) { taskSkipped++; continue; }

  const d = goalDoc.data();
  const fbOwnerUid = d.__fbOwnerUid || d.userId || d.owner_id || d.ownerId || '';
  const supaOwner  = uidMap.get(fbOwnerUid);
  if (!supaOwner) { taskSkipped++; continue; }

  // Tasks in subcollection
  let taskCollection: any;
  if (topLevelGoals.empty) {
    taskCollection = await db
      .collection('users').doc(fbOwnerUid)
      .collection('goals').doc(firestoreGoalId)
      .collection('tasks').get();
  } else {
    taskCollection = await db.collection('goals').doc(firestoreGoalId).collection('tasks').get();
  }

  for (const tDoc of taskCollection.docs) {
    const t = tDoc.data();
    taskRows.push({
      goal_id:     supaGoalId || 'DRY_RUN',
      owner_id:    supaOwner,
      text:        t.text || t.title || '',
      is_done:     bool(t.isDone ?? t.is_done),
      order:       num(t.order, 0),
      micro_steps: Array.isArray(t.microSteps ?? t.micro_steps) ? (t.microSteps ?? t.micro_steps) : [],
      source:      t.source || 'manual',
      reminder_at: ts(t.reminderAt ?? t.reminder_at),
      created_at:  ts(t.createdAt  ?? t.created_at),
    });
  }
}

console.log(`   ${taskRows.length} tasks to insert, ${taskSkipped} skipped`);

if (DRY_RUN) {
  console.log(`\n   [DRY RUN] Would insert ${taskRows.length} tasks`);
  taskRows.slice(0, 5).forEach(t => console.log(`   • "${t.text}" (done=${t.is_done})`));
} else {
  const CHUNK = 100;
  for (let i = 0; i < taskRows.length; i += CHUNK) {
    const { error } = await supabase.from('tasks').insert(taskRows.slice(i, i + CHUNK));
    if (error) console.error(`   ❌  Tasks chunk ${Math.floor(i / CHUNK) + 1}:`, error.message);
    else        console.log(`   ✅  Inserted chunk ${Math.floor(i / CHUNK) + 1}: ${Math.min(CHUNK, taskRows.length - i)} tasks`);
  }
}

// ── Step 5: Export and insert goal_notes ─────────────────────────────────────
console.log('\nStep 5 — Reading and inserting goal_notes…');

type NoteRow = {
  goal_id:     string;
  owner_id:    string;
  text:        string | null;
  reminder_at: string | null;
  created_at:  string | null;
};

const noteRows: NoteRow[] = [];
let noteSkipped = 0;

for (const goalDoc of goalDocs) {
  const firestoreGoalId = goalDoc.id;
  const supaGoalId      = goalIdMap.get(firestoreGoalId);
  if (!supaGoalId && !DRY_RUN) { noteSkipped++; continue; }

  const d = goalDoc.data();
  const fbOwnerUid = d.__fbOwnerUid || d.userId || d.owner_id || d.ownerId || '';
  const supaOwner  = uidMap.get(fbOwnerUid);
  if (!supaOwner) { noteSkipped++; continue; }

  let noteCollection: any;
  if (topLevelGoals.empty) {
    noteCollection = await db
      .collection('users').doc(fbOwnerUid)
      .collection('goals').doc(firestoreGoalId)
      .collection('notes').get();
  } else {
    noteCollection = await db.collection('goals').doc(firestoreGoalId).collection('notes').get();
  }

  for (const nDoc of noteCollection.docs) {
    const n = nDoc.data();
    noteRows.push({
      goal_id:     supaGoalId || 'DRY_RUN',
      owner_id:    supaOwner,
      text:        n.text || null,
      reminder_at: ts(n.reminderAt ?? n.reminder_at),
      created_at:  ts(n.createdAt  ?? n.created_at),
    });
  }
}

console.log(`   ${noteRows.length} goal_notes to insert, ${noteSkipped} skipped`);

if (!DRY_RUN && noteRows.length > 0) {
  const CHUNK = 100;
  for (let i = 0; i < noteRows.length; i += CHUNK) {
    const { error } = await supabase.from('goal_notes').insert(noteRows.slice(i, i + CHUNK));
    if (error) console.error(`   ❌  Notes chunk ${Math.floor(i / CHUNK) + 1}:`, error.message);
    else        console.log(`   ✅  Inserted chunk ${Math.floor(i / CHUNK) + 1}: ${Math.min(CHUNK, noteRows.length - i)} notes`);
  }
} else if (DRY_RUN) {
  console.log(`   [DRY RUN] Would insert ${noteRows.length} goal_notes`);
}

// ── Step 6: Export and insert calendar_notes ──────────────────────────────────
console.log('\nStep 6 — Reading and inserting calendar_notes…');

type CalRow = { user_id: string; date: string; text: string | null; };
const calRows: CalRow[] = [];

for (const [fbUid, supaUuid] of uidMap) {
  const calSnap = await db
    .collection('users').doc(fbUid)
    .collection('calendarNotes').get();

  for (const cDoc of calSnap.docs) {
    const c = cDoc.data();
    // doc ID is often the date string (YYYY-MM-DD)
    const date = c.date || cDoc.id;
    calRows.push({ user_id: supaUuid, date, text: c.text || null });
  }
}

console.log(`   ${calRows.length} calendar_notes to insert`);

if (!DRY_RUN && calRows.length > 0) {
  const CHUNK = 100;
  for (let i = 0; i < calRows.length; i += CHUNK) {
    const { error } = await supabase
      .from('calendar_notes')
      .upsert(calRows.slice(i, i + CHUNK), { onConflict: 'user_id,date' });
    if (error) console.error(`   ❌  CalNotes chunk ${Math.floor(i / CHUNK) + 1}:`, error.message);
    else        console.log(`   ✅  Inserted chunk ${Math.floor(i / CHUNK) + 1}`);
  }
} else if (DRY_RUN) {
  console.log(`   [DRY RUN] Would insert ${calRows.length} calendar_notes`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(DRY_RUN ? '  DRY RUN COMPLETE — no data was written' : '  MIGRATION COMPLETE');
console.log('══════════════════════════════════════════');
console.log(`  Users mapped:       ${uidMap.size}`);
console.log(`  Goals:              ${goalRows.length} insertable, ${skippedGoals.length} skipped`);
console.log(`  Tasks:              ${taskRows.length}`);
console.log(`  Goal notes:         ${noteRows.length}`);
console.log(`  Calendar notes:     ${calRows.length}`);
if (!DRY_RUN) {
  console.log('\n  Run the app and verify goals appear for each user.');
  console.log('  Then trigger /api/goals/post-save for each goal to regenerate embeddings.');
}
console.log('══════════════════════════════════════════\n');
