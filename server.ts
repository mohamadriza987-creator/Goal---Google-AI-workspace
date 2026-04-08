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
  generateMicroSteps,
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

function isPrivateGoal(goal: GoalDoc) {
  return goal.visibility === "private" || goal.privacy === "private";
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function isAdminRequest(req: any) {
  return req.user?.email === "mohamadriza987@gmail.com" && req.user?.email_verified === true;
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
          goalTitle:       mgData.title        || "",
          goalDescription: mgData.description  || "",
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
      const validation = ModerationSignalSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { targetUserId, action, context } = validation.data;
      const userId = req.userId;

      if (targetUserId === userId) {
        return res.status(400).json({ error: "Cannot moderate yourself" });
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