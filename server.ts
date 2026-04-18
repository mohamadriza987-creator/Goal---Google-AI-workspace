import express from "express";
import path from "path";
import { createServer as createViteServer, loadEnv } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  generateGoal,
  transcribeAudio,
  normalizeGoal,
  generateEmbedding,
  generateGroupName,
  generateMicroSteps,
  setGeminiModelOrder,
  getModelCallStats,
} from "./server/gemini.ts";
import { z } from "zod";
import fs from "fs";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : null;

const firebaseApp =
  admin.apps.length > 0
    ? admin.app()
    : admin.initializeApp({
        projectId: firebaseConfig.projectId,
        credential: serviceAccount
          ? admin.credential.cert(serviceAccount)
          : admin.credential.applicationDefault(),
      });

console.log("Admin SDK initialized. Project ID:", firebaseApp.options.projectId);

const dbId = 'ai-studio-a88ce025-f109-4cce-bf43-4c096c19e5dd';
const db = getFirestore(firebaseApp, dbId);

console.log(`Firestore initialized for database: ${dbId}`);

const nowIso = () => new Date().toISOString();

(async () => {
  try {
    console.log(`Testing Firestore connection for database: ${dbId}...`);
    await db.collection("test").doc("health").get();
    console.log("Firestore connection test successful.");
  } catch (error) {
    console.error("Firestore connection test failed:", error);
    if (error instanceof Error && error.message.includes("PERMISSION_DENIED")) {
      console.warn("Permission denied on startup check. Deploy firestore.rules and retry.");
      console.warn("Project ID:", firebaseConfig.projectId);
      console.warn("Database ID:", dbId);
    }
  }
})();

type GoalDoc = {
  id: string;
  ownerId?: string;
  title?: string;
  description?: string;
  category?: string;
  timeHorizon?: string;
  visibility?: string;
  privacy?: string;
  groupId?: string | null;
  groupJoined?: boolean;
  joinedAt?: string;
  eligibleAt?: string;
  normalizedMatchingText?: string;
  embedding?: number[];
  matchingMetadata?: {
    locality?: string;
  };
  tags?: string[];
  createdAt?: string;
  [key: string]: any;
};

type GroupDoc = {
  id: string;
  derivedGoalTheme?: string;
  representativeEmbedding?: number[];
  localityCenter?: string;
  maxMembers?: number;
  memberCount?: number;
  members?: Array<{
    goalId: string;
    userId: string;
    joinedAt: string;
  }>;
  // Flat userId set — kept in sync with members[] by server routes.
  // Used by Firestore security rules for cheap membership checks.
  memberIds?: string[];
  eligibleGoalIds?: string[];
  matchingCriteria?: {
    category?: string;
    timeHorizon?: string;
    privacy?: string;
  };
  createdAt?: string;
  [key: string]: any;
};

// ── Goal Matching Index types ────────────────────────────────────────────────

type GroupIndexEntry = {
  groupId: string;
  memberGoalIds: string[];
  memberUserIds: string[];
  memberCount: number;
  categories: string[];
  languages: string[];
  ageCategories: string[];
  locations: string[];
  nationalities: string[];
  vectorMetadata: { representativeEmbedding: number[] };
  updatedAt: string;
};

type UnassignedGoalIndexEntry = {
  goalId: string;
  userId: string;
  vectorMetadata: { embedding: number[] };
  ageCategory: string;
  currentLocation: string;
  nationality: string;
  languages: string[];
  categories: string[];
  lastLoggedInAt: string;
  activityStatus: "active" | "inactive";
  updatedAt: string;
};

// ── Index helpers ────────────────────────────────────────────────────────────

function computeAgeCategory(age?: number | null): string {
  if (!age || age < 13) return "";
  if (age <= 17) return "13-17";
  if (age <= 30) return "18-30";
  if (age <= 45) return "31-45";
  return "45+";
}

const IDX_ACTIVE_DAYS = 30;
function isActiveUser(lastLoggedInAt?: string): boolean {
  if (!lastLoggedInAt) return true; // missing = treat as active (never penalise new users)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - IDX_ACTIVE_DAYS);
  return new Date(lastLoggedInAt) >= cutoff;
}

function isPrivateGoal(goal: GoalDoc) {
  return goal.visibility === "private" || goal.privacy === "private";
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

// Bootstrap admin email (configurable). Roles also recognised via:
//   1. Custom claim:  decodedToken.role === 'admin'  or  decodedToken.admin === true
//   2. Firestore:     users/{uid}.role === 'admin'
// Email match remains as a one-time bootstrap for the very first admin.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "mohamadriza987@gmail.com";

async function isAdminRequest(req: any): Promise<boolean> {
  const u = req.user;
  if (!u) return false;
  if (u.role === "admin" || u.admin === true) return true;
  if (u.email_verified === true && typeof u.email === "string" && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return true;
  if (u.uid) {
    try {
      const doc = await db.collection("users").doc(u.uid).get();
      if (doc.exists && doc.data()?.role === "admin") return true;
    } catch {
      // fall through
    }
  }
  return false;
}

function cosineSimilarity(vecA: number[], vecB: number[]) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// Upper bounds for fallback full-collection scans. Indexed matching
// (goals_unassigned_index, group_index) is the primary path; these caps
// keep the fallback path from O(N) degradation as the corpus grows.
const GROUP_SCAN_CAP = 500;
const GOAL_SCAN_CAP = 1000;

async function findOrCreateGroupForGoal(goalId: string) {
  try {
    console.log(`Attempting to find or create group for goal ${goalId}...`);

    const goalDoc = await db.collection("goals").doc(goalId).get();
    if (!goalDoc.exists) {
      console.warn(`Goal ${goalId} not found.`);
      return null;
    }

    const goal = { id: goalDoc.id, ...goalDoc.data() } as GoalDoc;

    if (!goal.embedding || goal.groupId) {
      return null;
    }

    // Bounded scan: previously a full-collection read on every goal save.
    // Indexed matching (runIndexedMatching) is the primary path; this scan
    // is a fallback and a top-N cosine sort still picks the best match
    // within the cap.
    const groupsSnap = await db.collection("groups").limit(GROUP_SCAN_CAP).get();
    const allGroups = groupsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as GroupDoc,
    );

    const SIMILARITY_THRESHOLD_EXISTING = 0.78;
    const SIMILARITY_THRESHOLD_NEW = 0.72;

    let bestGroup: GroupDoc | null = null;
    let maxScore = -1;

    for (const group of allGroups) {
      if (!group.representativeEmbedding) continue;
      if ((group.memberIds || []).includes(goal.ownerId)) continue;

      const goalIsPrivate = isPrivateGoal(goal);
      const groupIsPrivate = group.matchingCriteria?.privacy === "private";
      if (goalIsPrivate !== groupIsPrivate) continue;

      const score = cosineSimilarity(goal.embedding, group.representativeEmbedding);
      if (score > maxScore) {
        maxScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && maxScore >= SIMILARITY_THRESHOLD_EXISTING) {
      console.log(
        `Goal ${goal.id} is eligible for existing group ${bestGroup.id} (score: ${maxScore.toFixed(3)})`,
      );

      const groupRef = db.collection("groups").doc(bestGroup.id);
      const goalRef = db.collection("goals").doc(goal.id);
      const joinedAt = nowIso();

      await db.runTransaction(async (transaction) => {
        const gDoc = await transaction.get(groupRef);
        const gData = gDoc.data() as GroupDoc;
        const members: any[] = gData?.members || [];
        const memberIds: string[] = gData?.memberIds || [];
        const alreadyMember = members.some((m) => m.goalId === goal.id);

        transaction.update(goalRef, {
          groupId: bestGroup!.id,
          groupJoined: true,
          joinedAt,
          eligibleAt: joinedAt,
        });

        const groupUpdate: any = {
          eligibleGoalIds: admin.firestore.FieldValue.arrayUnion(goal.id),
        };
        if (!alreadyMember) {
          groupUpdate.members = admin.firestore.FieldValue.arrayUnion({
            goalId: goal.id,
            userId: goal.ownerId,
            joinedAt,
          });
          if (!memberIds.includes(goal.ownerId)) {
            groupUpdate.memberIds = admin.firestore.FieldValue.arrayUnion(goal.ownerId);
            groupUpdate.memberCount = admin.firestore.FieldValue.increment(1);
          }
        }
        transaction.set(groupRef, groupUpdate, { merge: true });
      });

      // D2: index maintenance must complete before returning so the goal is
      // searchable / removable in the same request lifecycle.
      await Promise.all([
        removeGoalFromUnassignedIndex(goal.id).catch((e) => {
          console.error("removeGoalFromUnassignedIndex failed:", e);
        }),
        upsertGroupIndex(bestGroup!.id).catch((e) => {
          console.error("upsertGroupIndex failed:", e);
        }),
      ]);

      return {
        action: "assigned",
        groupId: bestGroup.id,
        groupName: bestGroup.derivedGoalTheme,
      };
    }

    // Bounded scan: see GROUP_SCAN_CAP note above.
    const goalsSnap = await db.collection("goals").limit(GOAL_SCAN_CAP).get();
    const allGoals = goalsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as GoalDoc,
    );

    const goalIsPrivate = isPrivateGoal(goal);
    const ungroupedGoals = allGoals.filter(
      (g) =>
        !g.groupId &&
        g.id !== goal.id &&
        g.ownerId !== goal.ownerId &&
        Array.isArray(g.embedding) &&
        isPrivateGoal(g) === goalIsPrivate,
    );

    const potentialMatches = ungroupedGoals
      .map((g) => ({ goal: g, score: cosineSimilarity(goal.embedding!, g.embedding!) }))
      .filter((m) => m.score >= SIMILARITY_THRESHOLD_NEW)
      .sort((a, b) => b.score - a.score);

    if (potentialMatches.length >= 1) {
      const clusterGoals = [goal, ...potentialMatches.slice(0, 5).map((m) => m.goal)];
      console.log(`Creating new group for ${clusterGoals.length} goals...`);

      const groupName = await generateGroupName(
        clusterGoals.map((g) => ({ title: g.title, description: g.description })),
      );

      const eligibleGoalIds = uniqueStrings(clusterGoals.map((g) => g.id));
      const joinedAt = nowIso();

      const initialMembers = clusterGoals.map((g) => ({
        goalId: g.id,
        userId: g.ownerId,
        joinedAt,
      }));
      const initialMemberIds = uniqueStrings(clusterGoals.map((g) => g.ownerId));

      const groupData = {
        derivedGoalTheme: groupName,
        representativeEmbedding: goal.embedding,
        localityCenter: goal.matchingMetadata?.locality || "Global",
        maxMembers: 70,
        members: initialMembers,
        memberIds: initialMemberIds,
        eligibleGoalIds,
        memberCount: initialMemberIds.length,
        matchingCriteria: {
          category: goal.category,
          timeHorizon: goal.timeHorizon,
          privacy: goalIsPrivate ? "private" : "public",
        },
        createdAt: joinedAt,
      };

      const groupRef = await db.collection("groups").add(groupData);

      const batch = db.batch();
      for (const g of clusterGoals) {
        batch.update(db.collection("goals").doc(g.id), {
          groupId: groupRef.id,
          groupJoined: true,
          joinedAt,
          eligibleAt: joinedAt,
        });
      }
      await batch.commit();

      // Index maintenance (fire-and-forget)
      for (const g of clusterGoals) {
        removeGoalFromUnassignedIndex(g.id).catch(console.error);
      }
      upsertGroupIndex(groupRef.id).catch(console.error);

      return { action: "create", groupId: groupRef.id, groupName };
    }

    return null;
  } catch (error) {
    console.error(`Error in findOrCreateGroupForGoal for ${goalId}:`, error);
    throw error;
  }
}

async function cleanupBrokenGroups() {
  console.log("Cleaning up broken groups with no representativeEmbedding...");

  const groupsSnap = await db.collection("groups").get();
  const goalsSnap = await db.collection("goals").get();
  const allGoals = goalsSnap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as GoalDoc,
  );

  for (const groupDoc of groupsSnap.docs) {
    const group = { id: groupDoc.id, ...groupDoc.data() } as GroupDoc;

    if (!group.representativeEmbedding) {
      console.log(`Deleting broken group ${group.id} ("${group.derivedGoalTheme}")`);

      const batch = db.batch();
      const goalsInGroup = allGoals.filter((g) => g.groupId === group.id);

      for (const g of goalsInGroup) {
        batch.update(db.collection("goals").doc(g.id), {
          groupId: admin.firestore.FieldValue.delete(),
          groupJoined: false,
          eligibleAt: admin.firestore.FieldValue.delete(),
          joinedAt: admin.firestore.FieldValue.delete(),
        });
      }

      batch.delete(groupDoc.ref);
      await batch.commit();
    }
  }
}

// ── Goal Matching Index — write/update functions ─────────────────────────────

async function upsertGroupIndex(groupId: string): Promise<void> {
  const groupDoc = await db.collection("groups").doc(groupId).get();
  if (!groupDoc.exists) return;
  const group = { id: groupDoc.id, ...groupDoc.data() } as GroupDoc;
  if (!group.representativeEmbedding) return;

  const memberGoalIds  = (group.members || []).map((m) => m.goalId);
  const memberUserIds  = group.memberIds
    ?? uniqueStrings((group.members || []).map((m) => m.userId).filter(Boolean) as string[]);

  const categories    = new Set<string>();
  const languages     = new Set<string>();
  const ageCategories = new Set<string>();
  const locations     = new Set<string>();
  const nationalities = new Set<string>();

  if (group.matchingCriteria?.category) categories.add(group.matchingCriteria.category);
  if (group.localityCenter && group.localityCenter !== "Global") locations.add(group.localityCenter);

  if (memberGoalIds.length > 0) {
    const goalDocs = await Promise.all(memberGoalIds.map((id) => db.collection("goals").doc(id).get()));
    const userIds = new Set<string>();
    for (const gd of goalDocs) {
      if (!gd.exists) continue;
      const g = gd.data() as GoalDoc;
      if (g.category) categories.add(g.category);
      if (g.matchingMetadata?.locality) locations.add(g.matchingMetadata.locality);
      if (g.ownerId) userIds.add(g.ownerId);
    }
    const userDocs = await Promise.all([...userIds].map((uid) => db.collection("users").doc(uid).get()));
    for (const ud of userDocs) {
      if (!ud.exists) continue;
      const u = ud.data() as any;
      if (u.locality) locations.add(u.locality);
      if (u.nationality) nationalities.add(u.nationality);
      const ageCat = computeAgeCategory(u.age);
      if (ageCat) ageCategories.add(ageCat);
      const langs: string[] = u.languages || (u.preferredLanguage ? [u.preferredLanguage] : []);
      langs.forEach((l: string) => languages.add(l));
    }
  }

  const entry: GroupIndexEntry = {
    groupId,
    memberGoalIds,
    memberUserIds,
    memberCount: typeof group.memberCount === "number" ? group.memberCount : memberGoalIds.length,
    categories:    [...categories],
    languages:     [...languages],
    ageCategories: [...ageCategories],
    locations:     [...locations],
    nationalities: [...nationalities],
    vectorMetadata: { representativeEmbedding: group.representativeEmbedding },
    updatedAt: nowIso(),
  };

  await db.collection("group_index").doc(groupId).set(entry);
}

async function removeGroupIndex(groupId: string): Promise<void> {
  await db.collection("group_index").doc(groupId).delete().catch(() => {});
}

async function upsertGoalToUnassignedIndex(
  goalId: string,
  opts: { stampNow?: boolean } = {},
): Promise<void> {
  const goalDoc = await db.collection("goals").doc(goalId).get();
  if (!goalDoc.exists) return;
  const goal = { id: goalDoc.id, ...goalDoc.data() } as GoalDoc;

  // State exclusivity: if the goal is already in a group, it must not be in the unassigned index
  if (goal.groupId) {
    await db.collection("goals_unassigned_index").doc(goalId).delete().catch(() => {});
    return;
  }
  if (!goal.embedding) return;

  const userId = goal.ownerId;
  if (!userId) return;

  const userDoc = await db.collection("users").doc(userId).get();
  const u: any = userDoc.exists ? userDoc.data() : {};

  const ageCategory    = computeAgeCategory(u.age);
  const currentLocation: string = u.locality || goal.matchingMetadata?.locality || "";
  const nationality: string    = u.nationality || "";
  const languages: string[]    = u.languages || (u.preferredLanguage ? [u.preferredLanguage] : []);

  // Stamp lastLoggedInAt = now when:
  //   - caller explicitly requests it (new goal creation, re-entry after leaving group), OR
  //   - the user has never had it set at all
  const now = nowIso();
  let lastLoggedInAt: string = u.lastLoggedInAt || "";
  if (opts.stampNow || !lastLoggedInAt) {
    lastLoggedInAt = now;
    // Persist back to the user doc so it's consistent everywhere
    await db.collection("users").doc(userId).update({ lastLoggedInAt }).catch(() => {
      // If user doc doesn't exist yet (edge case), use set with merge
      db.collection("users").doc(userId).set({ lastLoggedInAt }, { merge: true }).catch(console.error);
    });
  }

  const activityStatus = isActiveUser(lastLoggedInAt) ? "active" : "inactive";

  const entry: UnassignedGoalIndexEntry = {
    goalId,
    userId,
    vectorMetadata: { embedding: goal.embedding },
    ageCategory,
    currentLocation,
    nationality,
    languages,
    categories: goal.category ? [goal.category] : [],
    lastLoggedInAt,
    activityStatus,
    updatedAt: now,
  };

  await db.collection("goals_unassigned_index").doc(goalId).set(entry);
}

async function removeGoalFromUnassignedIndex(goalId: string): Promise<void> {
  await db.collection("goals_unassigned_index").doc(goalId).delete().catch(() => {});
}

// ── Cascading pool narrowing ──────────────────────────────────────────────────
// At each filter step: if applying the filter would shrink the pool below IDX_POOL_MIN,
// stop narrowing and fall through to vector cosine matching on the current pool.

const IDX_POOL_MIN = 25;

function narrowGroupPool(
  pool: GroupIndexEntry[],
  categories: string[], languages: string[], ageCategory: string,
  location: string, nationality: string,
): GroupIndexEntry[] {
  if (categories.length > 0 && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((g) => g.categories.length === 0 || g.categories.some((c) => categories.includes(c)));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (languages.length > 0 && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((g) => g.languages.length === 0 || g.languages.some((l) => languages.includes(l)));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (ageCategory && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((g) => g.ageCategories.length === 0 || g.ageCategories.includes(ageCategory));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (location && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((g) => g.locations.length === 0 || g.locations.includes(location));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (nationality && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((g) => g.nationalities.length === 0 || g.nationalities.includes(nationality));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  return pool;
}

function narrowUnassignedPool(
  pool: UnassignedGoalIndexEntry[],
  categories: string[], languages: string[], ageCategory: string,
  location: string, nationality: string,
): UnassignedGoalIndexEntry[] {
  if (categories.length > 0 && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((e) => e.categories.length === 0 || e.categories.some((c) => categories.includes(c)));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (languages.length > 0 && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((e) => e.languages.length === 0 || e.languages.some((l) => languages.includes(l)));
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (ageCategory && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((e) => !e.ageCategory || e.ageCategory === ageCategory);
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (location && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((e) => !e.currentLocation || e.currentLocation === location);
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  if (nationality && pool.length >= IDX_POOL_MIN) {
    const f = pool.filter((e) => !e.nationality || e.nationality === nationality);
    if (f.length >= IDX_POOL_MIN) pool = f;
  }
  return pool;
}

// ── Core indexed matching ─────────────────────────────────────────────────────

const IDX_COSINE_EXISTING  = 0.78;
const IDX_COSINE_NEW_GROUP = 0.90;

type IndexedMatchResult =
  | { action: "assigned-existing"; groupId: string }
  | { action: "created-new-group"; groupId: string }
  | { action: "placed-unassigned"; activityStatus: "active" | "inactive" };

async function runIndexedMatching(goalId: string): Promise<IndexedMatchResult> {
  const goalDoc = await db.collection("goals").doc(goalId).get();
  if (!goalDoc.exists) throw new Error(`Goal ${goalId} not found`);
  const goal = { id: goalDoc.id, ...goalDoc.data() } as GoalDoc;

  // Already in a group — refresh index and return
  if (goal.groupId) {
    upsertGroupIndex(goal.groupId).catch(console.error);
    await removeGoalFromUnassignedIndex(goalId);
    return { action: "assigned-existing", groupId: goal.groupId };
  }

  // No embedding yet — place in unassigned index with correct activity status
  if (!goal.embedding) {
    await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
    return { action: "placed-unassigned", activityStatus: "active" };
  }

  // Resolve owner metadata
  const userId = goal.ownerId || "";
  const userDoc = userId ? await db.collection("users").doc(userId).get() : null;
  const u: any = userDoc?.exists ? userDoc.data() : {};

  const goalCategories: string[] = goal.category ? [goal.category] : [];
  const goalLanguages: string[]  = u.languages || (u.preferredLanguage ? [u.preferredLanguage] : []);
  const goalAgeCategory: string  = computeAgeCategory(u.age);
  const goalLocation: string     = u.locality || goal.matchingMetadata?.locality || "";
  const goalNationality: string  = u.nationality || "";
  const goalIsPrivate            = isPrivateGoal(goal);

  // ── Step 1: Groups Index (memberCount < 100 only) ─────────────────────────
  const groupIndexSnap = await db.collection("group_index").get();
  let gPool: GroupIndexEntry[] = groupIndexSnap.docs
    .map((d) => d.data() as GroupIndexEntry)
    .filter((g) => g.memberCount < 100)
    .filter((g) => !(g.memberUserIds ?? []).includes(userId));

  gPool = narrowGroupPool(gPool, goalCategories, goalLanguages, goalAgeCategory, goalLocation, goalNationality);

  let bestGroupScore = -1;
  let bestGroupEntry: GroupIndexEntry | null = null;
  for (const entry of gPool) {
    if (!entry.vectorMetadata?.representativeEmbedding) continue;
    const score = cosineSimilarity(goal.embedding, entry.vectorMetadata.representativeEmbedding);
    if (score > bestGroupScore) { bestGroupScore = score; bestGroupEntry = entry; }
  }

  if (bestGroupEntry && bestGroupScore >= IDX_COSINE_EXISTING) {
    const groupRef = db.collection("groups").doc(bestGroupEntry.groupId);
    const goalRef  = db.collection("goals").doc(goalId);
    const joinedAt = nowIso();

    await db.runTransaction(async (tx) => {
      const gDoc = await tx.get(groupRef);
      if (!gDoc.exists) throw new Error("Group not found");
      const gData = gDoc.data() as GroupDoc;
      const members: any[]      = gData.members    || [];
      const memberIds: string[] = gData.memberIds  || [];
      const alreadyMember = members.some((m) => m.goalId === goalId);

      tx.update(goalRef, {
        groupId: bestGroupEntry!.groupId,
        groupJoined: true,
        joinedAt,
        eligibleAt: joinedAt,
      });

      if (!alreadyMember) {
        const upd: any = {
          eligibleGoalIds: admin.firestore.FieldValue.arrayUnion(goalId),
          members: admin.firestore.FieldValue.arrayUnion({ goalId, userId, joinedAt }),
        };
        if (!memberIds.includes(userId)) {
          upd.memberIds   = admin.firestore.FieldValue.arrayUnion(userId);
          upd.memberCount = admin.firestore.FieldValue.increment(1);
        }
        tx.update(groupRef, upd);
      }
    });

    await removeGoalFromUnassignedIndex(goalId);
    upsertGroupIndex(bestGroupEntry.groupId).catch(console.error);
    return { action: "assigned-existing", groupId: bestGroupEntry.groupId };
  }

  // ── Step 2: Active unassigned goals (cosine >= 90%) ───────────────────────
  const unassignedSnap = await db
    .collection("goals_unassigned_index")
    .where("activityStatus", "==", "active")
    .get();

  let uPool: UnassignedGoalIndexEntry[] = unassignedSnap.docs
    .map((d) => d.data() as UnassignedGoalIndexEntry)
    .filter((e) => e.goalId !== goalId && e.userId !== userId);

  uPool = narrowUnassignedPool(uPool, goalCategories, goalLanguages, goalAgeCategory, goalLocation, goalNationality);

  const strongMatches = uPool
    .filter((e) => Array.isArray(e.vectorMetadata?.embedding))
    .map((e) => ({ entry: e, score: cosineSimilarity(goal.embedding!, e.vectorMetadata.embedding) }))
    .filter((m) => m.score >= IDX_COSINE_NEW_GROUP)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (strongMatches.length >= 1) {
    const clusterUserIds = uniqueStrings(
      [userId, ...strongMatches.map((m) => m.entry.userId)].filter(Boolean) as string[],
    );
    if (clusterUserIds.length < 2) {
      await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
      return { action: "placed-unassigned", activityStatus: "active" };
    }

    const clusterGoalIds = [goalId, ...strongMatches.map((m) => m.entry.goalId)];
    const clusterDocs    = await Promise.all(clusterGoalIds.map((id) => db.collection("goals").doc(id).get()));
    const clusterGoals   = clusterDocs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }) as GoalDoc);

    const groupName    = await generateGroupName(clusterGoals.map((g) => ({ title: g.title, description: g.description })));
    const joinedAt     = nowIso();
    const initialMembers   = clusterGoals.map((g) => ({ goalId: g.id, userId: g.ownerId, joinedAt }));
    const initialMemberIds = uniqueStrings(clusterGoals.map((g) => g.ownerId).filter(Boolean) as string[]);

    const newGroupRef = await db.collection("groups").add({
      derivedGoalTheme: groupName,
      representativeEmbedding: goal.embedding,
      localityCenter: goalLocation || "Global",
      maxMembers: 70,
      members: initialMembers,
      memberIds: initialMemberIds,
      eligibleGoalIds: clusterGoalIds,
      memberCount: initialMemberIds.length,
      matchingCriteria: { category: goal.category, privacy: goalIsPrivate ? "private" : "public" },
      createdAt: joinedAt,
    });

    const batch = db.batch();
    for (const g of clusterGoals) {
      batch.update(db.collection("goals").doc(g.id), {
        groupId: newGroupRef.id, groupJoined: true, joinedAt, eligibleAt: joinedAt,
      });
    }
    await batch.commit();

    // Remove all cluster goals from unassigned index (batch delete)
    const removeBatch = db.batch();
    for (const m of strongMatches) {
      removeBatch.delete(db.collection("goals_unassigned_index").doc(m.entry.goalId));
    }
    removeBatch.delete(db.collection("goals_unassigned_index").doc(goalId));
    await removeBatch.commit();

    upsertGroupIndex(newGroupRef.id).catch(console.error);
    return { action: "created-new-group", groupId: newGroupRef.id };
  }

  // ── Step 3: No match — place in unassigned index ──────────────────────────
  await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
  return {
    action: "placed-unassigned",
    activityStatus: "active",
  };
}

// ── Fix existing unassigned index entries that are missing lastLoggedInAt ────
// Stamps lastLoggedInAt = now on the user doc + index doc so activityStatus
// gets correctly re-evaluated as "active" for those records.
async function backfillMissingLastLoggedIn(): Promise<{ fixed: number }> {
  const snap = await db.collection("goals_unassigned_index").get();
  const toFix = snap.docs.filter((d) => {
    const data = d.data();
    return !data.lastLoggedInAt || data.lastLoggedInAt === "";
  });

  if (toFix.length === 0) return { fixed: 0 };

  const now = nowIso();
  const batches: admin.firestore.WriteBatch[] = [];
  let batch = db.batch();
  let opCount = 0;

  for (const d of toFix) {
    const { userId } = d.data();
    // Stamp index doc
    batch.update(d.ref, { lastLoggedInAt: now, activityStatus: "active", updatedAt: now });
    opCount++;
    if (opCount >= 400) { batches.push(batch); batch = db.batch(); opCount = 0; }

    // Stamp user doc (best-effort)
    if (userId) {
      batch.set(db.collection("users").doc(userId), { lastLoggedInAt: now }, { merge: true });
      opCount++;
      if (opCount >= 400) { batches.push(batch); batch = db.batch(); opCount = 0; }
    }
  }
  batches.push(batch);

  for (const b of batches) await b.commit();
  console.log(`[backfillMissingLastLoggedIn] Fixed ${toFix.length} docs`);
  return { fixed: toFix.length };
}

// ── One-time Index Backfill ───────────────────────────────────────────────────

const BACKFILL_FLAG = "backfillIndexV1";

async function backfillIndexIfNeeded(): Promise<{ ran: boolean; goals: number; groups: number }> {
  const flagDoc = await db.collection("admin_flags").doc(BACKFILL_FLAG).get();
  if (flagDoc.exists && flagDoc.data()?.completed === true) {
    return { ran: false, goals: 0, groups: 0 };
  }

  console.log("[backfill] Starting index backfill...");
  let goalCount = 0;
  let groupCount = 0;

  const groupsSnap = await db.collection("groups").get();
  for (const gDoc of groupsSnap.docs) {
    try {
      await upsertGroupIndex(gDoc.id);
      groupCount++;
    } catch (e) {
      console.error(`[backfill] Failed to index group ${gDoc.id}:`, e);
    }
  }

  const goalsSnap = await db.collection("goals").get();
  for (const gDoc of goalsSnap.docs) {
    const g = gDoc.data() as GoalDoc;
    if (!g.groupId && g.embedding) {
      try {
        await upsertGoalToUnassignedIndex(gDoc.id);
        goalCount++;
      } catch (e) {
        console.error(`[backfill] Failed to index unassigned goal ${gDoc.id}:`, e);
      }
    }
  }

  await db.collection("admin_flags").doc(BACKFILL_FLAG).set({
    completed: true,
    completedAt: nowIso(),
    stats: { goals: goalCount, groups: groupCount },
  });

  console.log(`[backfill] Done. Indexed ${groupCount} groups, ${goalCount} unassigned goals.`);
  return { ran: true, goals: goalCount, groups: groupCount };
}

async function computeAndStoreSimilarGoals(
  goalId: string,
  embedding: number[],
  ownerId: string,
) {
  try {
    console.log(`Computing similar goals for ${goalId}...`);

    // Bounded scan — called on every goal save. Without a cap this scan
    // degrades linearly with total goals across the entire app.
    const goalsSnap = await db.collection("goals").limit(GOAL_SCAN_CAP).get();
    const allGoals = goalsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as GoalDoc,
    );

    const matches = allGoals
      .filter((g) => g.id !== goalId && g.embedding && g.ownerId !== ownerId)
      .map((g) => {
        const score = cosineSimilarity(embedding, g.embedding!);
        return {
          goalId: g.id,
          userId: g.ownerId,
          goalTitle: g.title,
          similarityScore: score,
          groupId: g.groupId,
          description: g.description,
        };
      })
      .filter((m) => m.similarityScore >= 0.7)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 5);

    await db.collection("goals").doc(goalId).update({
      similarGoals: matches,
      similarityComputedAt: nowIso(),
    });

    const currentGoalDoc = await db.collection("goals").doc(goalId).get();
    const currentGoal = { id: goalId, ...currentGoalDoc.data() } as GoalDoc;

    if (currentGoal && !currentGoal.groupId) {
      console.log(`Goal ${goalId} has no group. Attempting auto-assignment...`);
      await findOrCreateGroupForGoal(goalId);
    }

    return matches;
  } catch (error) {
    console.error("Error in computeAndStoreSimilarGoals:", error);
    throw error;
  }
}

async function reconcileAllGoals() {
  try {
    console.log("Starting global goal reconciliation...");

    await cleanupBrokenGroups();

    const goalsSnap = await db.collection("goals").get();
    console.log(`Found ${goalsSnap.size} goals to reconcile.`);

    for (const goalDoc of goalsSnap.docs) {
      const goal = { id: goalDoc.id, ...goalDoc.data() } as GoalDoc;

      if (!goal.normalizedMatchingText) {
        const normalizedText = await normalizeGoal({
          title: goal.title || "Untitled Goal",
          description: goal.description || "",
          category: goal.category || "other",
          tags: goal.tags || [],
          timeHorizon: goal.timeHorizon || "unknown",
          privacy: goal.privacy || goal.visibility || "public",
          sourceText: goal.originalVoiceTranscript || ""
        }, { age: null, locality: null });
        await goalDoc.ref.update({ normalizedMatchingText: normalizedText });
        goal.normalizedMatchingText = normalizedText;
      }

      if (!goal.embedding && goal.normalizedMatchingText) {
        const embedding = await generateEmbedding(goal.normalizedMatchingText);
        await goalDoc.ref.update({
          embedding,
          embeddingUpdatedAt: nowIso(),
        });
        goal.embedding = embedding;
      }

      if (goal.embedding) {
        await computeAndStoreSimilarGoals(goal.id, goal.embedding, goal.ownerId || "");
      }

      if (goal.embedding && !goal.groupId) {
        await findOrCreateGroupForGoal(goal.id);
      }
    }

    console.log("Global reconciliation complete.");
  } catch (err) {
    console.error("Error during global reconciliation:", err);
  }
}

async function hardResetGroups() {
  try {
    console.log("!!! HARD RESET GROUPS START !!!");

    await db.recursiveDelete(db.collection("groups"));

    const goalsSnap = await db.collection("goals").get();
    let batch = db.batch();
    let opCount = 0;

    for (const goalDoc of goalsSnap.docs) {
      batch.update(goalDoc.ref, {
        groupId: admin.firestore.FieldValue.delete(),
        groupJoined: false,
        eligibleAt: admin.firestore.FieldValue.delete(),
        joinedAt: admin.firestore.FieldValue.delete(),
      });
      opCount++;

      if (opCount === 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }

    await reconcileAllGoals();

    console.log("!!! HARD RESET GROUPS DONE !!!");
  } catch (err) {
    console.error("Hard reset failed:", err);
    throw err;
  }
}

// ── Rate limiting (Firestore-backed) ─────────────────────────────────────────
// Previously stored in-memory Maps, which reset on every server restart and
// made the limit meaningless against an attacker who could trigger a redeploy
// (or just wait out sticky routing). Backed by Firestore docs now so state
// survives process restarts and scales horizontally across instances.
//
// Throughput note: these are called from already-expensive endpoints
// (Gemini / Firestore writes), so the extra ~10ms of a transactional read is
// not the bottleneck.
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

async function checkRateLimit(userId: string): Promise<boolean> {
  const ref = db.collection("rate_limits").doc(`user_${userId}`);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (!data || now - (data.lastReset as number) > RATE_LIMIT_WINDOW) {
        tx.set(ref, { count: 1, lastReset: now });
        return true;
      }
      if ((data.count as number) >= MAX_REQUESTS_PER_WINDOW) return false;
      tx.update(ref, { count: (data.count as number) + 1 });
      return true;
    });
  } catch (err) {
    // Fail-open on transient Firestore errors — rate limit is best-effort,
    // refusing legit requests on a Firestore blip is worse than letting
    // through a handful extra.
    console.error("checkRateLimit failed; fail-open:", err);
    return true;
  }
}

// ── Moderation-specific rate limiting ────────────────────────────────────────
// Caps the number of moderation signals (hide/block/report) a single reporter
// may file against a single target within an hour. Stops one user from
// spamming hide/block actions to bury another user.
const MODERATION_TARGET_WINDOW = 60 * 60 * 1000; // 1 hour
const MODERATION_TARGET_MAX = 3;

async function checkModerationTargetLimit(
  reporterId: string,
  targetUserId: string,
): Promise<boolean> {
  // Abuse-prevention fails CLOSED: if we can't verify the counter, we refuse
  // the signal. Unlike the generic rate limit, a false positive here just
  // asks the user to try again — whereas a false negative enables the exact
  // spam pattern this check exists to block.
  const safeKey = `${reporterId}_${targetUserId}`.replace(/[^A-Za-z0-9_]/g, "_");
  const ref = db.collection("moderation_target_limits").doc(safeKey);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (!data || now - (data.firstAt as number) > MODERATION_TARGET_WINDOW) {
        tx.set(ref, { count: 1, firstAt: now, reporterId, targetUserId });
        return true;
      }
      if ((data.count as number) >= MODERATION_TARGET_MAX) return false;
      tx.update(ref, { count: (data.count as number) + 1 });
      return true;
    });
  } catch (err) {
    console.error("checkModerationTargetLimit failed; fail-closed:", err);
    return false;
  }
}

// ── Audio MIME / content validation ──────────────────────────────────────────
// Claimed Content-Type is untrusted; verify it matches the actual binary
// signature of the uploaded base64 payload before forwarding to Gemini.
const ALLOWED_AUDIO_MIME = new Set<string>([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav",
  "audio/x-wav", "audio/mp3", "audio/aac", "audio/flac", "audio/m4a",
  "audio/x-m4a",
  // Browser MediaRecorder occasionally emits video/webm for an audio-only stream.
  "video/webm",
]);

function detectAudioFormat(b64: string): string | null {
  let header: Buffer;
  try {
    header = Buffer.from(b64.slice(0, 64), "base64");
  } catch {
    return null;
  }
  if (header.length < 8) return null;
  const b0 = header[0], b1 = header[1], b2 = header[2], b3 = header[3];
  if (b0 === 0x1A && b1 === 0x45 && b2 === 0xDF && b3 === 0xA3) return "webm";   // EBML
  if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return "ogg";    // OggS
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return "wav";    // RIFF
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return "mp3";                   // ID3
  if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) return "mp3";                         // MPEG sync
  if (b0 === 0x66 && b1 === 0x4C && b2 === 0x61 && b3 === 0x43) return "flac";   // fLaC
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return "mp4"; // ftyp
  return null;
}

function validateAudioMime(mimeType: string, b64: string): { ok: boolean; reason?: string } {
  if (!mimeType || typeof mimeType !== "string") return { ok: false, reason: "Missing MIME type" };
  const m = mimeType.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_AUDIO_MIME.has(m)) return { ok: false, reason: `Unsupported MIME: ${mimeType}` };

  const detected = detectAudioFormat(b64);
  if (!detected) return { ok: false, reason: "Could not recognise audio content" };

  const compatible =
    (detected === "webm" && m.includes("webm")) ||
    (detected === "ogg"  && m.includes("ogg")) ||
    (detected === "wav"  && (m.includes("wav") || m.includes("x-wav"))) ||
    (detected === "mp3"  && (m.includes("mp3") || m.includes("mpeg"))) ||
    (detected === "flac" && m.includes("flac")) ||
    (detected === "mp4"  && (m.includes("mp4") || m.includes("m4a") || m.includes("aac")));
  if (!compatible) return { ok: false, reason: `Declared MIME (${mimeType}) does not match audio content (${detected})` };
  return { ok: true };
}

const TranscribeSchema = z.object({
  audioBase64: z.string().min(1).max(50 * 1024 * 1024),
  mimeType: z.string().min(1).max(100),
});

const GenerateGoalSchema = z.union([
  z.object({ text:       z.string().min(1).max(10000), userContext: z.any().optional() }),
  z.object({ audioBase64: z.string().min(1).max(50 * 1024 * 1024), mimeType: z.string().min(1).max(100), userContext: z.any().optional() }),
]);

const NormalizeGoalSchema = z.object({
  goalData: z.any(),
  userContext: z.any().optional(),
});

const EmbeddingSchema = z.object({
  text: z.string().min(1).max(5000),
});

const SimilarGoalsSchema = z.object({
  goalId: z.string().min(1),
  embedding: z.array(z.number()).min(1),
});

const GroupAssignSchema = z.object({
  goalId: z.string().min(1),
});

const GroupJoinSchema = z.object({
  goalId: z.string().min(1),
  groupId: z.string().min(1),
});

const MediaUploadSchema = z.object({
  groupId: z.string().min(1),
  type: z.enum(["image", "video"]),
  data: z.string().min(1),
  duration: z.number().optional(),
});

const env = loadEnv("", process.cwd(), "");
const gemfree = process.env.gemfree || env.gemfree;
const geminiApiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;

if (gemfree || geminiApiKey) {
  const source = gemfree ? "gemfree" : "GEMINI_API_KEY";
  console.log(`Panda Status: Using "${source}" secret path.`);
  if (gemfree) process.env.gemfree = gemfree;
  if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;
} else {
  console.log('Panda Status: Gemini API secret NOT FOUND (checked "gemfree" and "GEMINI_API_KEY").');
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));
  app.use(cookieParser());

  const authMiddleware = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Missing or invalid Authorization header" });
    }

    const idToken = authHeader.slice("Bearer ".length).trim();

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.userId = decodedToken.uid;
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error("Error verifying ID token:", error);
      return res.status(401).json({ error: "Unauthorized: Invalid ID token" });
    }
  };

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "goal-app-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        httpOnly: true,
      },
    }),
  );

  // Load persisted Gemini model order on startup
  db.collection("admin_settings").doc("gemini").get().then((snap) => {
    if (snap.exists) {
      const order: string[] = snap.data()?.modelOrder ?? [];
      if (order.length > 0) {
        setGeminiModelOrder(order);
        console.log("[startup] Gemini model order loaded:", order);
      }
    }
  }).catch((e) => console.warn("[startup] Could not load Gemini model order:", e));

  app.get("/api/health", async (_req, res) => {
    try {
      await db.collection("test").doc("health").get();
      res.json({
        status: "ok",
        firestore: "connected",
        database: dbId
      });
    } catch (error: any) {
      console.error("Health check Firestore error:", error);
      res.status(500).json({
        status: "error",
        firestore: "error",
        details: error.message,
      });
    }
  });

  app.post("/api/transcribe", authMiddleware, async (req: any, res) => {
    try {
      console.log(`[API] /api/transcribe - Received request. Content-Length: ${req.headers['content-length']} bytes`);
      if (!(await checkRateLimit(req.userId))) {
        console.warn(`[API] /api/transcribe - Rate limit exceeded for user ${req.userId}`);
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = TranscribeSchema.safeParse(req.body);
      if (!validation.success) {
        console.warn(`[API] /api/transcribe - Invalid payload:`, validation.error.format());
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { audioBase64, mimeType } = validation.data;
      const mimeCheck = validateAudioMime(mimeType, audioBase64);
      if (!mimeCheck.ok) {
        console.warn(`[API] /api/transcribe - MIME mismatch for user ${req.userId}: ${mimeCheck.reason}`);
        return res.status(415).json({ error: mimeCheck.reason });
      }
      console.log(`[API] /api/transcribe - Starting transcription for user ${req.userId}...`);
      const transcript = await transcribeAudio(audioBase64, mimeType);
      console.log(`[API] /api/transcribe - Transcription successful for user ${req.userId}. Length: ${transcript.length}`);
      res.json({ transcript });
    } catch (error: any) {
      console.error(`[API] /api/transcribe - Error for user ${req.userId}:`, error);
      res.status(500).json({
        error: "Failed to transcribe audio",
        details: error.message || String(error),
      });
    }
  });

  app.post("/api/generate-goal", authMiddleware, async (req: any, res) => {
    try {
      if (!(await checkRateLimit(req.userId))) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const { text, audioBase64, mimeType, userContext } = req.body;
      if (!text && !audioBase64) {
        return res.status(400).json({ error: "text or audioBase64 required" });
      }
      if (audioBase64) {
        const mimeCheck = validateAudioMime(mimeType, audioBase64);
        if (!mimeCheck.ok) {
          console.warn(`[API] /api/generate-goal - MIME mismatch for user ${req.userId}: ${mimeCheck.reason}`);
          return res.status(415).json({ error: mimeCheck.reason });
        }
      }

      const input: { text: string } | { audioBase64: string; mimeType: string } =
        text ? { text } : { audioBase64, mimeType };

      console.log(`[API] /api/generate-goal - user ${req.userId}, input: ${text ? "text" : "audio"}`);
      const structuredGoal = await generateGoal(input, userContext);
      console.log(`[API] /api/generate-goal - done: "${structuredGoal.title}"`);
      res.json(structuredGoal);
    } catch (error: any) {
      console.error(`[API] /api/generate-goal - Error for user ${req.userId}:`, error);
      res.status(500).json({ error: "Failed to generate goal", details: error.message || String(error) });
    }
  });

  app.post("/api/normalize-goal", authMiddleware, async (req: any, res) => {
    try {
      if (!(await checkRateLimit(req.userId))) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = NormalizeGoalSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalData, userContext } = validation.data;
      const normalizedText = await normalizeGoal(goalData, userContext);
      res.json({ normalizedMatchingText: normalizedText });
    } catch (error: any) {
      console.error("Goal normalization error:", error);
      res.status(500).json({
        error: "Failed to normalize goal",
        details: error.message || String(error),
      });
    }
  });

  app.post("/api/tasks/micro-steps", authMiddleware, async (req: any, res) => {
    try {
      const { taskText } = req.body;
      if (!taskText?.trim()) return res.status(400).json({ error: "taskText required" });
      const steps = await generateMicroSteps(taskText.trim());
      res.json({ steps });
    } catch (error: any) {
      console.error("[API] /api/tasks/micro-steps error:", error);
      res.status(500).json({ error: error.message || "Failed to generate micro-steps" });
    }
  });

  app.post("/api/generate-embedding", authMiddleware, async (req: any, res) => {
    try {
      if (!(await checkRateLimit(req.userId))) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = EmbeddingSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { text } = validation.data;
      const embedding = await generateEmbedding(text);
      res.json({ embedding });
    } catch (error: any) {
      console.error("Embedding generation error:", error);
      res.status(500).json({
        error: "Failed to generate embedding",
        details: error.message || String(error),
      });
    }
  });

  app.post("/api/goals/precompute", authMiddleware, async (req: any, res) => {
    try {
      const validation = SimilarGoalsSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId, embedding } = validation.data;

      // SECURITY: Verify the goal belongs to the requesting user before precomputing.
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists || goalDoc.data()?.ownerId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to you" });
      }

      const matches = await computeAndStoreSimilarGoals(goalId, embedding, req.userId);
      res.json({ success: true, matches });
    } catch (error: any) {
      console.error("Precompute similarity error:", error);
      res.status(500).json({ error: "Failed to precompute similarity" });
    }
  });

  // One-time bootstrap so the configured ADMIN_EMAIL (env) can claim the
  // 'admin' custom claim on their own UID. Firestore rules can't read env
  // vars, so without this the email would have to be burned into the rules
  // — which is what we're trying to avoid. After calling this once, the
  // operator must sign out and back in for the fresh ID token to include
  // the claim, after which rules-level admin access works on the claim alone.
  app.post("/api/admin/bootstrap", authMiddleware, async (req: any, res) => {
    try {
      const u = req.user;
      const configured = (process.env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase();
      if (!u?.email_verified || (u.email || "").toLowerCase() !== configured) {
        return res.status(403).json({ error: "Forbidden: not the configured admin email" });
      }
      await admin.auth().setCustomUserClaims(u.uid, { admin: true, role: "admin" });
      await db.collection("users").doc(u.uid).set({ role: "admin" }, { merge: true });
      res.json({
        success: true,
        message:
          "Admin claim set. Sign out and back in for the new ID token to take effect.",
      });
    } catch (error: any) {
      console.error("Admin bootstrap error:", error);
      res.status(500).json({ error: "Failed to set admin claim" });
    }
  });

  app.post("/api/admin/reconcile", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      const goalsSnap = await db.collection("goals").get();
      const results = [];

      for (const goalDoc of goalsSnap.docs) {
        const goal = { id: goalDoc.id, ...goalDoc.data() } as GoalDoc;
        let updated = false;
        let currentEmbedding = goal.embedding;
        let currentNormalizedText = goal.normalizedMatchingText;

        try {
          if (!currentNormalizedText) {
            currentNormalizedText = await normalizeGoal({
              title: goal.title || "Untitled Goal",
              description: goal.description || "",
              category: goal.category || "other",
              tags: goal.tags || [],
              timeHorizon: goal.timeHorizon || "unknown",
              privacy: goal.privacy || goal.visibility || "public",
              sourceText: goal.originalVoiceTranscript || ""
            }, { age: null, locality: null });
            await goalDoc.ref.update({ normalizedMatchingText: currentNormalizedText });
            updated = true;
          }

          if (!currentEmbedding && currentNormalizedText) {
            currentEmbedding = await generateEmbedding(currentNormalizedText);
            await goalDoc.ref.update({
              embedding: currentEmbedding,
              embeddingUpdatedAt: nowIso(),
            });
            updated = true;
          }

          if (currentEmbedding) {
            await computeAndStoreSimilarGoals(goal.id, currentEmbedding, goal.ownerId || "");
            updated = true;
          }

          results.push({ id: goal.id, title: goal.title, status: "success", updated });
        } catch (goalErr: any) {
          console.error(`Error reconciling goal ${goal.id}:`, goalErr);
          results.push({
            id: goal.id,
            title: goal.title,
            status: "error",
            error: goalErr.message,
          });
        }
      }

      res.json({ success: true, processed: results.length, results });
    } catch (error: any) {
      console.error("Reconcile error:", error);
      res.status(500).json({ error: "Failed to reconcile goals" });
    }
  });

  app.post("/api/admin/hard-reset-groups", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      hardResetGroups().catch((err) => console.error("Background hard reset failed:", err));
      res.json({ success: true, message: "Hard reset and rebuild started in background." });
    } catch (error: any) {
      console.error("Hard reset error:", error);
      res.status(500).json({ error: "Failed to start hard reset" });
    }
  });

  app.post("/api/groups/assign", authMiddleware, async (req: any, res) => {
    try {
      const validation = GroupAssignSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId } = validation.data;

      // SECURITY: Verify the goal belongs to the requesting user.
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists || goalDoc.data()?.ownerId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to you" });
      }

      const result = await findOrCreateGroupForGoal(goalId);

      if (result) {
        return res.json(result);
      }

      res.json({ action: "none", reason: "No suitable group or cluster found" });
    } catch (error: any) {
      console.error("Group assignment error:", error);
      res.status(500).json({ error: "Failed to assign group", details: error.message });
    }
  });

  // P2: combined post-save endpoint — replaces 3 separate sequential
  // round-trips (assign → precompute → index-new). Single auth check,
  // single network round-trip, deterministic ordering on the server.
  const PostSaveSchema = z.object({
    goalId: z.string().min(1),
    embedding: z.array(z.number()),
  });

  app.post("/api/goals/post-save", authMiddleware, async (req: any, res) => {
    try {
      const validation = PostSaveSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId, embedding } = validation.data;

      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists || goalDoc.data()?.ownerId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to you" });
      }

      const assignResult = await findOrCreateGroupForGoal(goalId).catch((e) => {
        console.error("post-save: findOrCreateGroupForGoal failed:", e);
        return null;
      });

      const matches = await computeAndStoreSimilarGoals(goalId, embedding, req.userId).catch(
        (e) => {
          console.error("post-save: computeAndStoreSimilarGoals failed:", e);
          return [] as any[];
        },
      );

      const indexResult = await runIndexedMatching(goalId).catch((e) => {
        console.error("post-save: runIndexedMatching failed:", e);
        return null;
      });

      res.json({
        success: true,
        groupId: assignResult?.groupId ?? null,
        groupAction: assignResult?.action ?? "none",
        matchesCount: Array.isArray(matches) ? matches.length : 0,
        indexed: !!indexResult,
      });
    } catch (error: any) {
      console.error("post-save error:", error);
      res.status(500).json({ error: "Failed to finalize goal", details: error.message });
    }
  });

  // S3: server-side group fetch — replaces direct client-side getDoc on
  // groups, which sidestepped server-enforced authorization.
  app.get("/api/groups/:groupId", authMiddleware, async (req: any, res) => {
    try {
      const { groupId } = req.params;
      if (!groupId) return res.status(400).json({ error: "groupId required" });

      const groupDoc = await db.collection("groups").doc(groupId).get();
      if (!groupDoc.exists) return res.status(404).json({ error: "Group not found" });

      const data = groupDoc.data() as GroupDoc;
      const memberIds: string[] = data.memberIds || [];
      const eligibleGoalIds: string[] = data.eligibleGoalIds || [];

      // Caller must either be a member OR own a goal that is eligible to join.
      let allowed = memberIds.includes(req.userId);
      if (!allowed && eligibleGoalIds.length) {
        const ownedSnap = await db
          .collection("goals")
          .where("ownerId", "==", req.userId)
          .get();
        const ownedIds = new Set(ownedSnap.docs.map((d) => d.id));
        allowed = eligibleGoalIds.some((gid) => ownedIds.has(gid));
      }
      if (!allowed) return res.status(403).json({ error: "Forbidden" });

      // Strip representativeEmbedding — large, internal-only.
      const { representativeEmbedding: _drop, ...safe } = data as any;
      res.json({ id: groupDoc.id, ...safe });
    } catch (error: any) {
      console.error("Group fetch error:", error);
      res.status(500).json({ error: "Failed to fetch group" });
    }
  });

  app.post("/api/groups/join", authMiddleware, async (req: any, res) => {
    try {
      const validation = GroupJoinSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId, groupId } = validation.data;
      const userId = req.userId;

      // SECURITY: Verify the goal belongs to the requesting user AND is assigned
      // to this exact group. Prevents users from joining rooms for others' goals.
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (
        !goalDoc.exists ||
        goalDoc.data()?.ownerId !== userId ||
        goalDoc.data()?.groupId !== groupId
      ) {
        return res.status(403).json({ error: "Not eligible for this group" });
      }

      const groupRef = db.collection("groups").doc(groupId);
      const goalRef  = db.collection("goals").doc(goalId);

      await db.runTransaction(async (transaction) => {
        const gDoc = await transaction.get(groupRef);
        if (!gDoc.exists) throw new Error("Group not found");

        const gData = gDoc.data() as GroupDoc;
        const members        = gData.members        || [];
        const eligibleGoalIds = gData.eligibleGoalIds || [];
        // memberIds is a flat string[] we maintain alongside members[] so that
        // Firestore security rules can do cheap `request.auth.uid in memberIds`
        // without an expensive cross-document get().
        const memberIds: string[] = gData.memberIds || [];

        const alreadyMember = members.some((m) => m.goalId === goalId);

        // SECURITY: eligibleGoalIds is server-written — clients cannot spoof it.
        if (!eligibleGoalIds.includes(goalId)) {
          throw new Error("Goal is not eligible for this group");
        }

        if (alreadyMember) {
          // Already joined — idempotent success, no double-write.
          return;
        }

        const currentMemberCount =
          typeof gData.memberCount === "number" ? gData.memberCount : members.length;
        if (typeof gData.maxMembers === "number" && currentMemberCount >= gData.maxMembers) {
          throw new Error("Group is full");
        }

        // Write both the rich members[] entry AND the flat memberIds[] set
        // so Firestore rules can verify membership cheaply.
        if (!memberIds.includes(userId)) {
          transaction.update(groupRef, {
            members: admin.firestore.FieldValue.arrayUnion({
              goalId,
              userId,
              joinedAt: nowIso(),
            }),
            // Flat userId set — used by Firestore security rules.
            memberIds: admin.firestore.FieldValue.arrayUnion(userId),
            memberCount: admin.firestore.FieldValue.increment(1),
          });
        }

        transaction.update(goalRef, {
          groupJoined: true,
          joinedAt: nowIso(),
        });
      });

      // Index maintenance (fire-and-forget)
      removeGoalFromUnassignedIndex(goalId).catch(console.error);
      upsertGroupIndex(groupId).catch(console.error);

      res.json({ success: true, groupId });
    } catch (error: any) {
      console.error("Join group error:", error);
      const clientMsg = ["Goal is not eligible", "Group is full", "Not eligible"].some(
        (s) => error.message?.includes(s)
      );
      if (clientMsg) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: "Failed to join group", details: error.message });
    }
  });

  app.get("/api/groups/joined", authMiddleware, async (req: any, res) => {
    try {
      const userId = req.userId;
      const goalsSnap = await db
        .collection("goals")
        .where("ownerId", "==", userId)
        .where("groupJoined", "==", true)
        .get();

      const joinedGroups = [];

      for (const goalDoc of goalsSnap.docs) {
        const goalData = goalDoc.data() as GoalDoc;
        if (!goalData.groupId) continue;

        const groupDoc = await db.collection("groups").doc(goalData.groupId).get();
        if (groupDoc.exists) {
          joinedGroups.push({
            groupId: goalData.groupId,
            goalId: goalDoc.id,
            goalTitle: goalData.title,
            joinedAt: goalData.joinedAt,
            memberCount: groupDoc.data()?.memberCount || 0,
          });
        }
      }

      res.json({ joinedGroups });
    } catch (error: any) {
      console.error("Fetch joined groups error:", error);
      res.status(500).json({ error: "Failed to fetch joined groups" });
    }
  });

  // ── People tab: tasks from room members (admin SDK bypasses task read rules) ──
  app.get("/api/goals/:goalId/people-tasks", authMiddleware, async (req: any, res) => {
    try {
      const { goalId } = req.params;

      // Verify caller owns or can see this goal
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists) return res.status(404).json({ error: "Goal not found" });
      const goalData = goalDoc.data()!;
      if (goalData.ownerId !== req.userId && goalData.visibility !== "public") {
        return res.status(403).json({ error: "Forbidden" });
      }

      const groupId: string | undefined = goalData.groupId;
      if (!groupId) return res.json({ members: [], similarTasks: [], popularTasks: [] });

      const groupDoc = await db.collection("groups").doc(groupId).get();
      if (!groupDoc.exists) return res.json({ members: [], similarTasks: [], popularTasks: [] });

      const groupData = groupDoc.data()!;
      const rawMembers: { goalId: string; userId: string; joinedAt: string }[] =
        (groupData.members || []).filter((m: any) => m.goalId !== goalId);

      const allActiveTexts: string[] = [];

      interface MemberDetail {
        userId: string;
        displayName: string;
        avatarUrl: string;
        goalTitle: string;
        goalDescription: string;
        progressPercent: number;
        joinedAt: string;
        activeTasks: string[];
        completedTasks: string[];
      }

      const members: MemberDetail[] = [];

      for (const member of rawMembers.slice(0, 6)) {
        const mgDoc = await db.collection("goals").doc(member.goalId).get();
        if (!mgDoc.exists) continue;
        const mgData = mgDoc.data()!;

        // Load user profile for display name and avatar
        const userDoc = await db.collection("users").doc(member.userId).get();
        const userData = userDoc.exists ? userDoc.data()! : {};

        // Load all tasks for this member's goal
        const tasksSnap = await db
          .collection("goals")
          .doc(member.goalId)
          .collection("tasks")
          .orderBy("order", "asc")
          .get();

        const activeTasks: string[]    = [];
        const completedTasks: string[] = [];

        tasksSnap.forEach((t) => {
          const d = t.data();
          if (d.isDone) completedTasks.push(d.text as string);
          else          activeTasks.push(d.text as string);
        });

        members.push({
          userId:          member.userId,
          displayName:     userData.displayName  || "Unknown",
          avatarUrl:       userData.avatarUrl    || "",
          goalTitle:       mgData.title          || "",
          goalDescription: mgData.description    || "",
          progressPercent: mgData.progressPercent ?? 0,
          joinedAt:        member.joinedAt,
          activeTasks:     activeTasks.slice(0, 10),
          completedTasks:  completedTasks.slice(0, 10),
        });

        activeTasks.forEach((t) => allActiveTexts.push(t));
      }

      // Aggregate popular tasks by normalised text (active tasks only)
      const counts = new Map<string, { text: string; count: number }>();
      allActiveTexts.forEach((text) => {
        const key = text.toLowerCase().trim();
        if (counts.has(key)) counts.get(key)!.count++;
        else counts.set(key, { text, count: 1 });
      });

      const popularTasks = [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

      // Similar tasks = unique active tasks not already in popularTasks
      const seen = new Set(popularTasks.map((t) => t.text.toLowerCase().trim()));
      const similarTasks = allActiveTexts
        .filter((t) => !seen.has(t.toLowerCase().trim()))
        .filter((t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
        .slice(0, 8)
        .map((text) => ({ text }));

      res.json({ members, similarTasks, popularTasks });
    } catch (error: any) {
      console.error("/api/goals/:goalId/people-tasks error:", error);
      res.status(500).json({ error: "Failed to load people data" });
    }
  });

  // ── Favourites ──────────────────────────────────────────────────────────────
  // Users can favourite other users; stored in a separate `favourites` collection.

  app.get("/api/favourites", authMiddleware, async (req: any, res) => {
    try {
      const snap = await db.collection("favourites")
        .where("ownerId", "==", req.userId)
        .orderBy("createdAt", "desc")
        .get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json({ favourites: items });
    } catch (error: any) {
      console.error("GET /api/favourites error:", error);
      res.status(500).json({ error: "Failed to load favourites" });
    }
  });

  const FavouriteSchema = z.object({
    targetUserId:   z.string().min(1),
    targetUserName: z.string().min(1),
    targetAvatarUrl: z.string().optional(),
  });

  app.post("/api/favourites", authMiddleware, async (req: any, res) => {
    try {
      const v = FavouriteSchema.safeParse(req.body);
      if (!v.success) return res.status(400).json({ error: "Invalid payload" });
      const { targetUserId, targetUserName, targetAvatarUrl } = v.data;
      if (targetUserId === req.userId) return res.status(400).json({ error: "Cannot favourite yourself" });

      // Check for duplicate
      const existing = await db.collection("favourites")
        .where("ownerId", "==", req.userId)
        .where("targetUserId", "==", targetUserId)
        .limit(1).get();
      if (!existing.empty) return res.json({ success: true, alreadyFavourited: true });

      await db.collection("favourites").add({
        ownerId:         req.userId,
        targetUserId,
        targetUserName,
        targetAvatarUrl: targetAvatarUrl || "",
        createdAt:       nowIso(),
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("POST /api/favourites error:", error);
      res.status(500).json({ error: "Failed to add favourite" });
    }
  });

  app.delete("/api/favourites/:targetUserId", authMiddleware, async (req: any, res) => {
    try {
      const { targetUserId } = req.params;
      const snap = await db.collection("favourites")
        .where("ownerId", "==", req.userId)
        .where("targetUserId", "==", targetUserId)
        .get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      res.json({ success: true });
    } catch (error: any) {
      console.error("DELETE /api/favourites error:", error);
      res.status(500).json({ error: "Failed to remove favourite" });
    }
  });

  // ── Poke ────────────────────────────────────────────────────────────────────
  // Creates a notification record for the target user.

  const PokeSchema = z.object({
    targetUserId: z.string().min(1),
    senderName:   z.string().min(1),
  });

  app.post("/api/poke", authMiddleware, async (req: any, res) => {
    try {
      const v = PokeSchema.safeParse(req.body);
      if (!v.success) return res.status(400).json({ error: "Invalid payload" });
      const { targetUserId, senderName } = v.data;
      if (targetUserId === req.userId) return res.status(400).json({ error: "Cannot poke yourself" });

      await db.collection("notifications").add({
        type:      "poke",
        toUserId:  targetUserId,
        fromUserId: req.userId,
        fromName:  senderName,
        read:      false,
        createdAt: nowIso(),
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("POST /api/poke error:", error);
      res.status(500).json({ error: "Failed to poke user" });
    }
  });

  // ── Silence ──────────────────────────────────────────────────────────────────
  // Stores silenced users on the caller's user doc (they see posts but no notifications).

  const SilenceSchema = z.object({
    targetUserId: z.string().min(1),
    silent: z.boolean(),
  });

  app.post("/api/silence", authMiddleware, async (req: any, res) => {
    try {
      const v = SilenceSchema.safeParse(req.body);
      if (!v.success) return res.status(400).json({ error: "Invalid payload" });
      const { targetUserId, silent } = v.data;
      if (targetUserId === req.userId) return res.status(400).json({ error: "Cannot silence yourself" });

      const op = silent
        ? admin.firestore.FieldValue.arrayUnion(targetUserId)
        : admin.firestore.FieldValue.arrayRemove(targetUserId);
      await db.collection("users").doc(req.userId).update({ silencedUsers: op });
      res.json({ success: true });
    } catch (error: any) {
      console.error("POST /api/silence error:", error);
      res.status(500).json({ error: "Failed to update silence setting" });
    }
  });

  // ── Get blocked users list ─────────────────────────────────────────────────
  app.get("/api/blocked-users", authMiddleware, async (req: any, res) => {
    try {
      const userDoc = await db.collection("users").doc(req.userId).get();
      if (!userDoc.exists) return res.json({ blockedUsers: [] });
      const data = userDoc.data()!;
      const blockedIds: string[] = data.blockedUsers || [];
      if (blockedIds.length === 0) return res.json({ blockedUsers: [] });

      // Fetch display names for blocked users
      const profiles = await Promise.all(
        blockedIds.map(async (uid) => {
          const d = await db.collection("users").doc(uid).get();
          return d.exists
            ? { userId: uid, displayName: d.data()!.displayName || "Unknown", avatarUrl: d.data()!.avatarUrl || "" }
            : { userId: uid, displayName: "Unknown", avatarUrl: "" };
        })
      );
      res.json({ blockedUsers: profiles });
    } catch (error: any) {
      console.error("GET /api/blocked-users error:", error);
      res.status(500).json({ error: "Failed to load blocked users" });
    }
  });

  // ── Unblock user ──────────────────────────────────────────────────────────
  app.delete("/api/blocked-users/:targetUserId", authMiddleware, async (req: any, res) => {
    try {
      const { targetUserId } = req.params;
      await db.collection("users").doc(req.userId).update({
        blockedUsers: admin.firestore.FieldValue.arrayRemove(targetUserId),
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("DELETE /api/blocked-users error:", error);
      res.status(500).json({ error: "Failed to unblock user" });
    }
  });

  // ── Copy task from another member to own goal ──────────────────────────────
  const CopyTaskSchema = z.object({
    goalId: z.string().min(1),
    text:   z.string().min(1).max(500),
    notes:  z.string().max(1000).optional(),
  });

  app.post("/api/goals/:goalId/tasks", authMiddleware, async (req: any, res) => {
    try {
      const v = CopyTaskSchema.safeParse(req.body);
      if (!v.success) return res.status(400).json({ error: "Invalid payload" });
      const { goalId } = req.params;
      const { text, notes } = v.data;

      // Verify ownership
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists) return res.status(404).json({ error: "Goal not found" });
      if (goalDoc.data()!.ownerId !== req.userId) return res.status(403).json({ error: "Forbidden" });

      // Get current max order
      const tasksSnap = await db.collection("goals").doc(goalId).collection("tasks")
        .orderBy("order", "desc").limit(1).get();
      const maxOrder = tasksSnap.empty ? 0 : (tasksSnap.docs[0].data().order ?? 0);

      const taskData: Record<string, any> = {
        goalId,
        ownerId:   req.userId,
        text:      text.trim(),
        source:    "manual",
        order:     maxOrder + 1,
        isDone:    false,
        createdAt: nowIso(),
      };

      if (notes?.trim()) {
        taskData.notes = [{ id: nowIso(), text: notes.trim(), createdAt: nowIso() }];
      }

      const ref = await db.collection("goals").doc(goalId).collection("tasks").add(taskData);
      res.json({ success: true, taskId: ref.id });
    } catch (error: any) {
      console.error("POST /api/goals/:goalId/tasks error:", error);
      res.status(500).json({ error: "Failed to add task" });
    }
  });

  // ── Ask for help on a task (creates Goal Room thread) ─────────────────────
  const AskForHelpSchema = z.object({
    goalId:      z.string().min(1),
    groupId:     z.string().min(1),
    taskText:    z.string().min(1).max(500),
    description: z.string().max(1000).optional(),
    authorName:  z.string().min(1),
    authorAvatar: z.string().optional(),
    notifyUserIds: z.array(z.string()).optional(),
  });

  app.post("/api/ask-for-help", authMiddleware, async (req: any, res) => {
    try {
      const v = AskForHelpSchema.safeParse(req.body);
      if (!v.success) return res.status(400).json({ error: "Invalid payload" });
      const { goalId, groupId, taskText, description, authorName, authorAvatar, notifyUserIds } = v.data;

      const threadRef = await db.collection("groups").doc(groupId).collection("threads").add({
        goalId,
        badge:         "help",
        title:         taskText,
        linkedTaskText: taskText,
        authorId:       req.userId,
        authorName,
        authorAvatar:   authorAvatar || "",
        previewText:    description || "Asking for help with this task.",
        replyCount:     0,
        usefulCount:    0,
        reactions:      {},
        isPinned:       false,
        createdAt:      nowIso(),
        lastActivityAt: nowIso(),
      });

      // Send notifications to users who have this task
      if (notifyUserIds && notifyUserIds.length > 0) {
        const batch = db.batch();
        notifyUserIds.forEach((uid) => {
          const nRef = db.collection("notifications").doc();
          batch.set(nRef, {
            type:       "help_request",
            toUserId:   uid,
            fromUserId: req.userId,
            fromName:   authorName,
            threadId:   threadRef.id,
            groupId,
            taskText,
            read:       false,
            createdAt:  nowIso(),
          });
        });
        await batch.commit();
      }

      res.json({ success: true, threadId: threadRef.id });
    } catch (error: any) {
      console.error("POST /api/ask-for-help error:", error);
      res.status(500).json({ error: "Failed to post help request" });
    }
  });

  app.post("/api/media/upload", authMiddleware, async (req: any, res) => {
    try {
      const validation = MediaUploadSchema.safeParse(req.body);
      if (!validation.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { groupId, type, data, duration } = validation.data;
      const userId = req.userId;

      if (type === "video" && (duration || 0) > 10) {
        return res.status(400).json({ error: "Video must be max 10 seconds" });
      }

      const goalSnap = await db
        .collection("goals")
        .where("ownerId", "==", userId)
        .where("groupId", "==", groupId)
        .where("groupJoined", "==", true)
        .limit(1)
        .get();

      if (goalSnap.empty) {
        return res.status(403).json({ error: "Must join group to upload media" });
      }

      const mediaRef = await db.collection("one_time_media").add({
        groupId,
        senderId: userId,
        type,
        data,
        createdAt: nowIso(),
        consumedBy: [],
      });

      res.json({ mediaId: mediaRef.id });
    } catch (error: any) {
      console.error("Media upload error:", error);
      res.status(500).json({ error: "Failed to upload media" });
    }
  });

  app.get("/api/media/open/:mediaId", authMiddleware, async (req: any, res) => {
    try {
      const { mediaId } = req.params;
      const userId = req.userId;

      const mediaDoc = await db.collection("one_time_media").doc(mediaId).get();
      if (!mediaDoc.exists) {
        return res.status(404).json({ error: "Media not found" });
      }

      const mediaData = mediaDoc.data() as any;

      const goalSnap = await db
        .collection("goals")
        .where("ownerId", "==", userId)
        .where("groupId", "==", mediaData.groupId)
        .where("groupJoined", "==", true)
        .limit(1)
        .get();

      if (goalSnap.empty) {
        return res.status(403).json({ error: "Must join group to view media" });
      }

      // U2: previously a single view marked the media consumed for that user,
      // so a fast re-tap (network blip, accidental scroll-away) silently 410'd.
      // We now track first-open time per user; the same viewer can re-open
      // within REVIEW_WINDOW_SEC, after which the media is locked for them.
      const REVIEW_WINDOW_SEC = 30;
      const consumedBy: string[] = mediaData.consumedBy ?? [];
      const openedAtMap: Record<string, string> = mediaData.firstOpenedAt ?? {};
      const firstOpenedAtIso = openedAtMap[userId];

      if (consumedBy.includes(userId) && firstOpenedAtIso) {
        const elapsedSec = (Date.now() - new Date(firstOpenedAtIso).getTime()) / 1000;
        if (elapsedSec > REVIEW_WINDOW_SEC) {
          return res.status(410).json({ error: "Media already viewed and expired" });
        }
        // Within window — allow re-view, do not re-record.
        return res.json({
          type: mediaData.type,
          data: mediaData.data,
          expiresIn: Math.max(1, Math.ceil(REVIEW_WINDOW_SEC - elapsedSec)),
        });
      }

      const nowIsoStr = nowIso();
      await mediaDoc.ref.update({
        consumedBy: admin.firestore.FieldValue.arrayUnion(userId),
        [`firstOpenedAt.${userId}`]: nowIsoStr,
      });

      res.json({
        type: mediaData.type,
        data: mediaData.data,
        expiresIn: REVIEW_WINDOW_SEC,
      });
    } catch (error: any) {
      console.error("Media open error:", error);
      res.status(500).json({ error: "Failed to open media" });
    }
  });


  // NOTE: /api/groups/match is intentionally removed — it was a no-op stub
  // that returned success without doing anything. Group matching runs
  // server-side automatically after goal precompute.

  // ── Moderation ──────────────────────────────────────────────────────
  // Record a moderation signal (hide/block) from the client.
  // Hidden users are stored on the *reporter's* own user doc (client-writable).
  // Blocked users trigger an additional moderation_events write here.

  const ModerationSignalSchema = z.object({
    targetUserId: z.string().min(1),
    action: z.enum(["hide", "block", "report"]),
    context: z.string().max(200).optional(),
  });

  app.post("/api/moderation/signal", authMiddleware, async (req: any, res) => {
    try {
      // Per-user request rate limit (shared bucket).
      if (!(await checkRateLimit(req.userId))) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = ModerationSignalSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { targetUserId, action, context } = validation.data;
      const userId = req.userId;

      if (targetUserId === userId) {
        return res.status(400).json({ error: "Cannot moderate yourself" });
      }

      // Per-target cap stops one reporter spamming hide/block/report actions
      // against the same user to bury them via repeat signals.
      if (!(await checkModerationTargetLimit(userId, targetUserId))) {
        return res.status(429).json({
          error: "You've already reported this user multiple times recently. Please wait before signalling again.",
        });
      }

      await db.collection("moderation_events").add({
        reporterId: userId,
        targetUserId,
        action,
        context: context || null,
        createdAt: nowIso(),
        status: "pending",
      });

      // Persist hide/block to the user's own document so client-side filtering works
      if (action === "hide" || action === "block") {
        const field = action === "hide" ? "hiddenUsers" : "blockedUsers";
        await db.collection("users").doc(userId).update({
          [field]: admin.firestore.FieldValue.arrayUnion(targetUserId),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Moderation signal error:", error);
      res.status(500).json({ error: "Failed to record moderation signal" });
    }
  });

  // ── Reports (threads / replies) ──────────────────────────────────────
  // Authenticated users can report content inside rooms they are a member of.

  const ReportContentSchema = z.object({
    groupId:    z.string().min(1),
    threadId:   z.string().min(1),
    replyId:    z.string().optional(),
    authorId:   z.string().min(1),
    reason:     z.string().min(1).max(500),
  });

  app.post("/api/moderation/report", authMiddleware, async (req: any, res) => {
    try {
      const validation = ReportContentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { groupId, threadId, replyId, authorId, reason } = validation.data;
      const userId = req.userId;

      // SECURITY: Confirm the reporter is actually a member of this group.
      const groupDoc = await db.collection("groups").doc(groupId).get();
      if (!groupDoc.exists) {
        return res.status(404).json({ error: "Group not found" });
      }
      const memberIds: string[] = groupDoc.data()?.memberIds || [];
      if (!memberIds.includes(userId)) {
        return res.status(403).json({ error: "You are not a member of this group" });
      }

      // Cannot report your own content.
      if (authorId === userId) {
        return res.status(400).json({ error: "Cannot report your own content" });
      }

      await db.collection("reports").add({
        reporterId:  userId,
        reportedUserId: authorId,
        groupId,
        threadId,
        replyId:     replyId || null,
        reason,
        createdAt:   nowIso(),
        status:      "pending",
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Report content error:", error);
      res.status(500).json({ error: "Failed to submit report" });
    }
  });

  app.get("/api/admin/reports", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      res.json({ message: "Admin reports endpoint" });
    } catch (error) {
      console.error("Admin check error:", error);
      res.status(500).json({ error: "Internal server error during admin check" });
    }
  });

  app.get("/api/debug/inspect-goals", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const goalsSnap = await db.collection("goals").get();
      const allGoals = goalsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as GoalDoc));
      const recentGoals = allGoals
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 15);

      res.json({ goals: recentGoals });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Goal Matching Index endpoints ──────────────────────────────────────────

  const IndexNewGoalSchema = z.object({ goalId: z.string().min(1) });

  app.post("/api/goals/index-new", authMiddleware, async (req: any, res) => {
    try {
      const validation = IndexNewGoalSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }
      const { goalId } = validation.data;
      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists || goalDoc.data()?.ownerId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to you" });
      }
      const result = await runIndexedMatching(goalId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Index new goal error:", error);
      res.status(500).json({ error: "Failed to index goal", details: error.message });
    }
  });

  app.post("/api/admin/backfill-index", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }
      const result = await backfillIndexIfNeeded();
      res.json({
        success: true,
        ...result,
        message: result.ran
          ? `Backfill complete: ${result.groups} groups, ${result.goals} unassigned goals indexed.`
          : "Backfill already completed previously — nothing to do.",
      });
    } catch (error: any) {
      console.error("Backfill index error:", error);
      res.status(500).json({ error: "Failed to run backfill", details: error.message });
    }
  });

  // ── Admin: index status (counts + flag) ──────────────────────────────────
  app.get("/api/admin/index-status", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });

      const [flagDoc, groupSnap, activeSnap, inactiveSnap] = await Promise.all([
        db.collection("admin_flags").doc(BACKFILL_FLAG).get(),
        db.collection("group_index").get(),
        db.collection("goals_unassigned_index").where("activityStatus", "==", "active").get(),
        db.collection("goals_unassigned_index").where("activityStatus", "==", "inactive").get(),
      ]);

      res.json({
        projectId: firebaseConfig.projectId,
        dbId,
        flag: flagDoc.exists ? flagDoc.data() : null,
        counts: {
          groupIndex:        groupSnap.size,
          unassignedActive:  activeSnap.size,
          unassignedInactive: inactiveSnap.size,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: force rebuild index (ignores flag) ─────────────────────────────
  app.post("/api/admin/force-rebuild-index", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });

      // Step 1: stamp lastLoggedInAt=now on any existing entries missing it
      const fixResult = await backfillMissingLastLoggedIn();

      // Step 2: delete flag then re-run full rebuild (which re-computes all entries fresh)
      await db.collection("admin_flags").doc(BACKFILL_FLAG).delete().catch(() => {});
      const result = await backfillIndexIfNeeded();

      res.json({ success: true, ...result, fixedMissingLastLoggedIn: fixResult.fixed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: index data rows (server-side, bypasses rules) ─────────────────
  app.get("/api/admin/index-data", authMiddleware, async (req: any, res) => {
    try {
      if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });

      const dataset = req.query.dataset as string;
      let snap: FirebaseFirestore.QuerySnapshot;

      if (dataset === "group_index") {
        snap = await db.collection("group_index").limit(100).get();
      } else if (dataset === "unassigned_active") {
        snap = await db.collection("goals_unassigned_index")
          .where("activityStatus", "==", "active").limit(100).get();
      } else if (dataset === "unassigned_inactive") {
        snap = await db.collection("goals_unassigned_index")
          .where("activityStatus", "==", "inactive").limit(100).get();
      } else {
        return res.status(400).json({ error: "Invalid dataset" });
      }

      const rows = snap.docs.map(d => {
        const data: any = d.data();
        delete data.vectorMetadata;
        return { _id: d.id, ...data };
      });

      res.json({ rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Admin: Gemini model call stats ───────────────────────────────────────
  app.get("/api/admin/gemini-model-stats", authMiddleware, async (req, res) => {
    if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });
    const windowMs = 15 * 60 * 1000;
    res.json({ stats: getModelCallStats(windowMs), windowMs });
  });

  // ── Admin: Gemini model order ─────────────────────────────────────────────
  app.get("/api/admin/gemini-model-order", authMiddleware, async (req, res) => {
    if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });
    try {
      const snap = await db.collection("admin_settings").doc("gemini").get();
      const modelOrder: string[] = snap.exists ? (snap.data()?.modelOrder ?? []) : [];
      res.json({ modelOrder });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/gemini-model-order", authMiddleware, async (req, res) => {
    if (!(await isAdminRequest(req))) return res.status(403).json({ error: "Forbidden" });
    try {
      const { modelOrder } = req.body;
      if (!Array.isArray(modelOrder) || modelOrder.length > 5) {
        return res.status(400).json({ error: "modelOrder must be an array of up to 5 strings" });
      }
      const cleaned: string[] = modelOrder.map((m: any) => (typeof m === "string" ? m.trim() : ""));
      await db.collection("admin_settings").doc("gemini").set({ modelOrder: cleaned, updatedAt: new Date().toISOString() }, { merge: true });
      setGeminiModelOrder(cleaned);
      res.json({ ok: true, modelOrder: cleaned });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use("/api/*", (req, res) => {
    console.warn(`Unmatched API request: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "API endpoint not found" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        // Disable HMR WebSocket server — port 24678 conflicts on Replit
        // causing an unhandled error that crashes the entire process.
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();