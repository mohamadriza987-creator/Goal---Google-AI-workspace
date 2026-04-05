import express from "express";
import path from "path";
import { createServer as createViteServer, loadEnv } from "vite";
import session from "express-session";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import {
  structureGoalFromAudio,
  transcribeAudio,
  generateGoalFromTranscript,
  normalizeGoal,
  generateEmbedding,
  generateGroupName,
} from "./server/gemini.ts";
import { z } from "zod";
import { StreamChat } from "stream-chat";
import fs from "fs";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;

const firebaseApp =
  admin.apps.length > 0
    ? admin.app()
    : admin.initializeApp({
        projectId: firebaseConfig.projectId,
        credential: admin.credential.applicationDefault(),
      });

console.log("Admin SDK initialized. Project ID:", firebaseApp.options.projectId);

const dbId = firebaseConfig.firestoreDatabaseId;
const db = getFirestore(firebaseApp, dbId);

console.log(
  `Firestore initialized for database: ${dbId}`,
);

// Test Firestore connection
(async () => {
  try {
    console.log(`Testing Firestore connection for database: ${dbId}...`);
    await db.collection("_health").doc("check").set({ lastCheck: nowIso() });
    console.log("Firestore connection test successful.");
  } catch (error) {
    console.error("Firestore connection test failed:", error);
    if (error instanceof Error && error.message.includes("PERMISSION_DENIED")) {
      console.warn("Permission denied. This might be due to missing IAM roles or incorrect database ID.");
      console.warn("Current Project ID:", firebaseConfig.projectId);
      console.warn("Current Database ID:", dbId);
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
  eligibleGoalIds?: string[];
  matchingCriteria?: {
    category?: string;
    timeHorizon?: string;
    privacy?: string;
  };
  createdAt?: string;
  [key: string]: any;
};

const nowIso = () => new Date().toISOString();

function isPrivateGoal(goal: GoalDoc) {
  return goal.visibility === "private" || goal.privacy === "private";
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function isAdminRequest(req: any) {
  const userDoc = await db.collection("users").doc(req.userId).get();
  return (
    userDoc.data()?.role === "admin" ||
    req.user?.email === "mohamadriza987@gmail.com"
  );
}

// Helper for cosine similarity
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

// Helper to find or create a group for a goal
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

    const groupsSnap = await db.collection("groups").get();
    const allGroups = groupsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as GroupDoc,
    );

    const SIMILARITY_THRESHOLD_EXISTING = 0.78;
    const SIMILARITY_THRESHOLD_NEW = 0.72;

    let bestGroup: GroupDoc | null = null;
    let maxScore = -1;

    for (const group of allGroups) {
      if (!group.representativeEmbedding) continue;

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
      const eligibleAt = nowIso();

      await db.runTransaction(async (transaction) => {
        transaction.update(goalRef, {
          groupId: bestGroup!.id,
          groupJoined: false,
          eligibleAt,
          joinedAt: admin.firestore.FieldValue.delete(),
        });

        transaction.set(
          groupRef,
          {
            eligibleGoalIds: admin.firestore.FieldValue.arrayUnion(goal.id),
          },
          { merge: true },
        );
      });

      return {
        action: "assigned",
        groupId: bestGroup.id,
        groupName: bestGroup.derivedGoalTheme,
      };
    }

    const goalsSnap = await db.collection("goals").get();
    const allGoals = goalsSnap.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as GoalDoc,
    );

    const goalIsPrivate = isPrivateGoal(goal);
    const ungroupedGoals = allGoals.filter(
      (g) =>
        !g.groupId &&
        g.id !== goal.id &&
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
      const eligibleAt = nowIso();

      const groupData = {
        derivedGoalTheme: groupName,
        representativeEmbedding: goal.embedding,
        localityCenter: goal.matchingMetadata?.locality || "Global",
        maxMembers: 70,
        members: [],
        eligibleGoalIds,
        memberCount: 0,
        matchingCriteria: {
          category: goal.category,
          timeHorizon: goal.timeHorizon,
          privacy: goalIsPrivate ? "private" : "public",
        },
        createdAt: eligibleAt,
      };

      const groupRef = await db.collection("groups").add(groupData);

      const batch = db.batch();
      for (const g of clusterGoals) {
        batch.update(db.collection("goals").doc(g.id), {
          groupId: groupRef.id,
          groupJoined: false,
          eligibleAt,
          joinedAt: admin.firestore.FieldValue.delete(),
        });
      }
      await batch.commit();

      return { action: "create", groupId: groupRef.id, groupName };
    }

    return null;
  } catch (error) {
    console.error(`Error in findOrCreateGroupForGoal for ${goalId}:`, error);
    throw error;
  }
}

// Helper to cleanup broken groups with no representativeEmbedding
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

async function computeAndStoreSimilarGoals(
  goalId: string,
  embedding: number[],
  ownerId: string,
) {
  try {
    console.log(`Computing similar goals for ${goalId}...`);

    const goalsSnap = await db.collection("goals").get();
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
          privacy: goal.privacy || goal.visibility || "private",
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

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

function checkRateLimit(userId: string) {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);

  if (!limit || now - limit.lastReset > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(userId, { count: 1, lastReset: now });
    return true;
  }

  if (limit.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  limit.count++;
  return true;
}

// Zod Schemas for validation
const TranscribeSchema = z.object({
  audioBase64: z.string().min(1).max(50 * 1024 * 1024),
  mimeType: z.string().min(1).max(100),
});

const GenerateGoalSchema = z.object({
  transcript: z.string().min(1).max(10000),
  userContext: z.any().optional(),
});

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

  app.get("/api/health", async (_req, res) => {
    try {
      await db.collection("test").doc("health").get();
      const streamKey = process.env.STREAM_API_KEY || "";
      const streamSecret = process.env.STREAM_API_SECRET || "";
      res.json({ 
        status: "ok", 
        firestore: "connected", 
        stream: streamKey ? "configured" : "missing",
        database: firebaseConfig.firestoreDatabaseId || "(default)"
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
      if (!checkRateLimit(req.userId)) {
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
      if (!checkRateLimit(req.userId)) {
        console.warn(`[API] /api/generate-goal - Rate limit exceeded for user ${req.userId}`);
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = GenerateGoalSchema.safeParse(req.body);
      if (!validation.success) {
        console.warn(`[API] /api/generate-goal - Invalid payload:`, validation.error.format());
        return res
          .status(400)
          .json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { transcript, userContext } = validation.data;
      console.log(`[API] /api/generate-goal - Starting goal generation for user ${req.userId}...`);
      const structuredGoal = await generateGoalFromTranscript(transcript, userContext);
      console.log(`[API] /api/generate-goal - Goal generation successful for user ${req.userId}: ${structuredGoal.goalTitle}`);
      res.json(structuredGoal);
    } catch (error: any) {
      console.error(`[API] /api/generate-goal - Error for user ${req.userId}:`, error);
      res.status(500).json({
        error: "Failed to generate goal from transcript",
        details: error.message || String(error),
      });
    }
  });

  app.post("/api/normalize-goal", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
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

  app.post("/api/generate-embedding", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
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
      const matches = await computeAndStoreSimilarGoals(goalId, embedding, req.userId);
      res.json({ success: true, matches });
    } catch (error: any) {
      console.error("Precompute similarity error:", error);
      res.status(500).json({ error: "Failed to precompute similarity" });
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
              privacy: goal.privacy || goal.visibility || "private",
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

      const goalDoc = await db.collection("goals").doc(goalId).get();
      if (!goalDoc.exists || goalDoc.data()?.ownerId !== userId || goalDoc.data()?.groupId !== groupId) {
        return res.status(403).json({ error: "Not eligible for this group" });
      }

      const groupRef = db.collection("groups").doc(groupId);
      const goalRef = db.collection("goals").doc(goalId);

      await db.runTransaction(async (transaction) => {
        const gDoc = await transaction.get(groupRef);
        if (!gDoc.exists) throw new Error("Group not found");

        const gData = gDoc.data() as GroupDoc;
        const members = gData.members || [];
        const eligibleGoalIds = gData.eligibleGoalIds || [];
        const alreadyMember = members.some((m) => m.goalId === goalId);

        if (!eligibleGoalIds.includes(goalId)) {
          throw new Error("Goal is not eligible for this group");
        }

        if (!alreadyMember) {
          const currentMemberCount = typeof gData.memberCount === "number" ? gData.memberCount : members.length;
          if (typeof gData.maxMembers === "number" && currentMemberCount >= gData.maxMembers) {
            throw new Error("Group is full");
          }

          transaction.update(groupRef, {
            members: admin.firestore.FieldValue.arrayUnion({
              goalId,
              userId,
              joinedAt: nowIso(),
            }),
            memberCount: admin.firestore.FieldValue.increment(1),
          });
        }

        transaction.update(goalRef, {
          groupJoined: true,
          joinedAt: nowIso(),
        });
      });

      const apiKey = process.env.STREAM_API_KEY || env.STREAM_API_KEY;
      const apiSecret = process.env.STREAM_API_SECRET || env.STREAM_API_SECRET;

      if (apiKey && apiSecret) {
        const serverClient = StreamChat.getInstance(apiKey, apiSecret);
        const channel = serverClient.channel("messaging", groupId);
        await channel.watch().catch(() => undefined);
        await channel.addMembers([userId]).catch(() => undefined);
      }

      res.json({ success: true, groupId });
    } catch (error: any) {
      console.error("Join group error:", error);
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

  app.post("/api/stream/token", authMiddleware, async (req: any, res) => {
    try {
      const apiKey = process.env.STREAM_API_KEY || env.STREAM_API_KEY;
      const apiSecret = process.env.STREAM_API_SECRET || env.STREAM_API_SECRET;

      if (!apiKey || !apiSecret) {
        return res.status(500).json({ error: "Stream API keys not configured" });
      }

      const serverClient = StreamChat.getInstance(apiKey, apiSecret);
      const userDoc = await db.collection("users").doc(req.userId).get();
      const userData = userDoc.data();

      await serverClient.upsertUser({
        id: req.userId,
        name: userData?.displayName || req.user.name || "User",
        image: userData?.avatarUrl || req.user.picture,
      });

      const token = serverClient.createToken(req.userId);
      res.json({ token, apiKey });
    } catch (error: any) {
      console.error("Stream token error:", error);
      res.status(500).json({ error: "Failed to generate Stream token" });
    }
  });

  // NOTE: This still stores base64 in Firestore because switching to object storage
  // requires bucket/storage setup outside this file.
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

      const consumedBy = mediaData.consumedBy ?? [];
      if (consumedBy.includes(userId)) {
        return res.status(410).json({ error: "Media already viewed and expired" });
      }

      await mediaDoc.ref.update({
        consumedBy: admin.firestore.FieldValue.arrayUnion(userId),
      });

      res.json({
        type: mediaData.type,
        data: mediaData.data,
        expiresIn: 30,
      });
    } catch (error: any) {
      console.error("Media open error:", error);
      res.status(500).json({ error: "Failed to open media" });
    }
  });

  app.post("/api/process-audio", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        console.warn(`[API] /api/process-audio - Rate limit exceeded for user ${req.userId}`);
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const { audioBase64, mimeType, userContext } = req.body;
      if (!audioBase64 || !mimeType) {
        console.warn(`[API] /api/process-audio - Missing audio data or mime type`);
        return res.status(400).json({ error: "Missing audio data or mime type" });
      }

      console.log(`[API] /api/process-audio - Starting audio processing for user ${req.userId}...`);
      const structuredGoal = await structureGoalFromAudio(audioBase64, mimeType, userContext);
      console.log(`[API] /api/process-audio - Audio processing successful for user ${req.userId}: ${structuredGoal.goalTitle}`);
      res.json(structuredGoal);
    } catch (error: any) {
      console.error(`[API] /api/process-audio - Error for user ${req.userId}:`, error);
      res.status(500).json({
        error: "Failed to process audio with Panda",
        details: error.message || String(error),
      });
    }
  });

  app.post("/api/groups/match", authMiddleware, async (_req: any, res) => {
    res.json({ success: true, message: "Matching logic triggered" });
  });

  app.post("/api/moderation/signal", authMiddleware, async (_req: any, res) => {
    res.json({ success: true });
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

  app.use("/api/*", (req, res) => {
    console.warn(`Unmatched API request: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "API endpoint not found" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
