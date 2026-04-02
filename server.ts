import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import session from "express-session";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { structureGoalFromAudio, transcribeAudio, generateGoalFromTranscript, normalizeGoal, generateEmbedding, generateGroupName } from "./server/gemini.ts";
import { z } from "zod";

import fs from "fs";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Force re-initialization to ensure correct project ID
process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;

if (admin.apps.length) {
  for (const app of admin.apps) {
    if (app) await app.delete();
  }
}

console.log("Initializing Admin SDK...");
admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

const currentProjectId = admin.app().options.projectId;
console.log("Admin SDK Final Project ID:", currentProjectId);

// Try default database first
const db = getFirestore(admin.app());
console.log("Firestore initialized for default database");

// Helper to find or create a group for a goal
async function findOrCreateGroupForGoal(goalId: string) {
  try {
    console.log(`Attempting to find or create group for goal ${goalId}...`);
    // Re-fetch goal to ensure we have latest groupId and embedding
    const goalDoc = await db.collection('goals').doc(goalId).get();
    if (!goalDoc.exists) {
      console.warn(`Goal ${goalId} not found.`);
      return null;
    }
  const goal = { id: goalDoc.id, ...goalDoc.data() } as any;

  if (!goal.embedding || goal.groupId) return null;

  const groupsSnap = await db.collection('groups').get();
  const allGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const SIMILARITY_THRESHOLD_EXISTING = 0.78; // Slightly lower to encourage joining
  const SIMILARITY_THRESHOLD_NEW = 0.72;

  let bestGroup = null;
  let maxScore = -1;

  for (const group of allGroups) {
    if (!group.representativeEmbedding) continue;
    
    // Privacy must match
    const goalIsPrivate = goal.visibility === 'private' || goal.privacy === 'private';
    const groupIsPrivate = group.matchingCriteria?.privacy === 'private';
    if (goalIsPrivate !== groupIsPrivate) continue;

    const score = cosineSimilarity(goal.embedding, group.representativeEmbedding);
    if (score > maxScore) {
      maxScore = score;
      bestGroup = group;
    }
  }

  // 1. Join existing group if strong match
  if (bestGroup && maxScore >= SIMILARITY_THRESHOLD_EXISTING) {
    console.log(`Goal ${goal.id} joining existing group ${bestGroup.id} (score: ${maxScore.toFixed(3)})`);
    
    const groupRef = db.collection('groups').doc(bestGroup.id);
    const goalRef = db.collection('goals').doc(goal.id);

    await db.runTransaction(async (transaction) => {
      const gDoc = await transaction.get(groupRef);
      const gData = gDoc.data() as any;
      const members = gData.members || [];
      
      if (!members.find((m: any) => m.goalId === goal.id)) {
        transaction.update(groupRef, {
          members: admin.firestore.FieldValue.arrayUnion({ 
            goalId: goal.id, 
            userId: goal.ownerId,
            joinedAt: new Date().toISOString()
          }),
          memberCount: admin.firestore.FieldValue.increment(1)
        });
      }
      transaction.update(goalRef, { groupId: bestGroup.id });
    });

    return { action: 'assigned', groupId: bestGroup.id, groupName: bestGroup.derivedGoalTheme };
  }

  // 2. Create new group if suitable ungrouped matches found
  const goalsSnap = await db.collection('goals').get();
  const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  
  const ungroupedGoals = allGoals.filter(g => !g.groupId && g.id !== goal.id && g.embedding);
  const potentialMatches = ungroupedGoals
    .map(g => ({ goal: g, score: cosineSimilarity(goal.embedding, g.embedding) }))
    .filter(m => m.score >= SIMILARITY_THRESHOLD_NEW)
    .sort((a, b) => b.score - a.score);

  if (potentialMatches.length >= 1) {
    // We found at least one other similar ungrouped goal
    const clusterGoals = [goal, ...potentialMatches.slice(0, 5).map(m => m.goal)];
    console.log(`Creating new group for ${clusterGoals.length} goals...`);
    
    const groupName = await generateGroupName(clusterGoals.map(g => ({ title: g.title, description: g.description })));
    
    const groupData = {
      derivedGoalTheme: groupName,
      representativeEmbedding: goal.embedding,
      members: clusterGoals.map(g => ({ 
        goalId: g.id, 
        userId: g.ownerId,
        joinedAt: new Date().toISOString()
      })),
      memberCount: clusterGoals.length,
      matchingCriteria: {
        category: goal.category,
        timeHorizon: goal.timeHorizon,
        privacy: (goal.visibility === 'private' || goal.privacy === 'private') ? 'private' : 'public'
      },
      createdAt: new Date().toISOString()
    };
    
    const groupRef = await db.collection('groups').add(groupData);
    
    // Update all goals in the cluster
    const batch = db.batch();
    for (const g of clusterGoals) {
      batch.update(db.collection('goals').doc(g.id), { groupId: groupRef.id });
    }
    await batch.commit();

    return { action: 'create', groupId: groupRef.id, groupName };
  }

  return null;
  } catch (error) {
    console.error(`Error in findOrCreateGroupForGoal for ${goalId}:`, error);
    throw error;
  }
}

// Helper to cleanup broken/duplicate groups with only 1 member
async function cleanupBrokenGroups() {
  console.log("Cleaning up broken/duplicate groups...");
  const groupsSnap = await db.collection('groups').get();
  const goalsSnap = await db.collection('goals').get();
  const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  for (const groupDoc of groupsSnap.docs) {
    const group = { id: groupDoc.id, ...groupDoc.data() } as any;
    const members = group.members || [];
    
    // If group has 0 or 1 members, it's a candidate for cleanup
    if (members.length <= 1) {
      console.log(`Cleaning up group ${group.id} ("${group.derivedGoalTheme}") with ${members.length} members.`);
      
      // Clear groupId for any goals pointing to this group
      const batch = db.batch();
      const goalsInGroup = allGoals.filter(g => g.groupId === group.id);
      for (const g of goalsInGroup) {
        batch.update(db.collection('goals').doc(g.id), { groupId: null });
      }
      
      // Delete the group
      batch.delete(groupDoc.ref);
      await batch.commit();
    }
  }
}

// Global Reconciliation Function
async function reconcileAllGoals() {
  try {
    console.log("Starting global goal reconciliation...");
    
    // 0. Cleanup broken groups first
    await cleanupBrokenGroups();

    const goalsSnap = await db.collection('goals').get();
    console.log(`Found ${goalsSnap.size} goals to reconcile.`);
    
    for (const goalDoc of goalsSnap.docs) {
      const goal = { id: goalDoc.id, ...goalDoc.data() } as any;
      
      // 1. Normalize if missing
      if (!goal.normalizedMatchingText) {
        const normalizedText = await normalizeGoal(goal, { age: null, locality: null });
        await goalDoc.ref.update({ normalizedMatchingText: normalizedText });
        goal.normalizedMatchingText = normalizedText;
      }

      // 2. Embed if missing
      if (!goal.embedding && goal.normalizedMatchingText) {
        const embedding = await generateEmbedding(goal.normalizedMatchingText);
        await goalDoc.ref.update({ 
          embedding, 
          embeddingUpdatedAt: new Date().toISOString() 
        });
        goal.embedding = embedding;
      }

      // 3. Compute Similarity
      if (goal.embedding) {
        await computeAndStoreSimilarGoals(goal.id, goal.embedding, goal.ownerId);
      }

      // 4. Assign Group if missing
      if (goal.embedding && !goal.groupId) {
        await findOrCreateGroupForGoal(goal.id);
      }
    }
    console.log("Global reconciliation complete.");
  } catch (err) {
    console.error("Error during global reconciliation:", err);
  }
}

import { initializeApp as initializeClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection as getClientCollection, getDocs as getClientDocs, deleteDoc as deleteClientDoc, doc as deleteClientDocRef, updateDoc as updateClientDoc, query as getClientQuery, where as getClientWhere } from 'firebase/firestore';

const clientApp = initializeClientApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
});
const clientDb = getClientFirestore(clientApp); // Use default database

// Hard Reset Groups Function using Client SDK
async function hardResetGroups() {
  try {
    console.log("!!! STARTING HARD RESET OF GROUPS (CLIENT SDK) !!!");
    
    // 1. Delete all groups
    const groupsSnap = await getClientDocs(getClientCollection(clientDb, 'groups'));
    console.log(`Deleting ${groupsSnap.size} groups...`);
    for (const groupDoc of groupsSnap.docs) {
      await deleteClientDoc(groupDoc.ref);
    }
    
    // 2. Clear groupId from all goals
    const goalsSnap = await getClientDocs(getClientCollection(clientDb, 'goals'));
    console.log(`Clearing groupId from ${goalsSnap.size} goals...`);
    for (const goalDoc of goalsSnap.docs) {
      await updateClientDoc(goalDoc.ref, { groupId: null });
    }
    
    console.log("Hard reset complete. Rebuilding groups...");
    
    // 3. Rebuild groups
    await reconcileAllGoals();
    
    console.log("!!! HARD RESET AND REBUILD FINISHED !!!");
  } catch (err) {
    console.error("Error during hard reset:", err);
    throw err;
  }
}

import { loadEnv } from "vite";

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

// Helper to compute and store similar goals
async function computeAndStoreSimilarGoals(goalId: string, embedding: number[], ownerId: string) {
  try {
    console.log(`Computing similar goals for ${goalId}...`);
    const goalsSnap = await db.collection('goals').get();
    const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

  const matches = allGoals
    .filter((g: any) => g.id !== goalId && g.embedding && g.ownerId !== ownerId)
    .map((g: any) => {
      const score = cosineSimilarity(embedding, g.embedding);
      return {
        goalId: g.id,
        userId: g.ownerId,
        goalTitle: g.title,
        similarityScore: score,
        groupId: g.groupId,
        description: g.description
      };
    })
    .filter((m: any) => m.similarityScore >= 0.70)
    .sort((a: any, b: any) => b.similarityScore - a.similarityScore)
    .slice(0, 5);

  await db.collection('goals').doc(goalId).update({
    similarGoals: matches,
    similarityComputedAt: new Date().toISOString()
  });

  // If goal has no group, try to assign one
  const currentGoalDoc = await db.collection('goals').doc(goalId).get();
  const currentGoal = { id: goalId, ...currentGoalDoc.data() } as any;
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

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // 10 requests per minute for AI endpoints

function checkRateLimit(userId: string) {
  const now = Date.now();
  const limit = rateLimitMap.get(userId);
  
  if (!limit || (now - limit.lastReset) > RATE_LIMIT_WINDOW) {
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
  audioBase64: z.string().min(1).max(50 * 1024 * 1024), // 50MB max
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
  goalId: z.string().optional(),
  embedding: z.array(z.number()).min(1),
});

const GroupAssignSchema = z.object({
  goal: z.any(),
});

// Load environment variables
const env = loadEnv("", process.cwd(), "");
const gemfree = process.env.gemfree || env.gemfree;

if (gemfree) {
  console.log('Panda Status: Using "gemfree" secret path.');
  // Ensure it's available in process.env for the gemini service
  process.env.gemfree = gemfree;
} else {
  console.log('Panda Status: "gemfree" secret NOT FOUND.');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());
  
  // Firebase Auth middleware to verify ID tokens
  const authMiddleware = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header" });
    }

    const idToken = authHeader.split("Bearer ")[1];
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
      saveUninitialized: true,
      cookie: { 
        secure: process.env.NODE_ENV === "production",
        sameSite: "none"
      },
    })
  );

  // API Routes
  app.get("/api/health", async (req, res) => {
    try {
      // Test Firestore connection
      await db.collection('test').doc('health').get();
      res.json({ status: "ok", firestore: "connected" });
    } catch (error: any) {
      console.error("Health check Firestore error:", error);
      res.json({ status: "ok", firestore: "error", details: error.message });
    }
  });
  
  // Fast Transcription Endpoint
  app.post("/api/transcribe", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = TranscribeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { audioBase64, mimeType } = validation.data;
      const transcript = await transcribeAudio(audioBase64, mimeType);
      res.json({ transcript });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ 
        error: "Failed to transcribe audio",
        details: error.message || String(error)
      });
    }
  });

  // Goal Generation from Transcript Endpoint
  app.post("/api/generate-goal", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = GenerateGoalSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { transcript, userContext } = validation.data;
      const structuredGoal = await generateGoalFromTranscript(transcript, userContext);
      res.json(structuredGoal);
    } catch (error: any) {
      console.error("Goal generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate goal from transcript",
        details: error.message || String(error)
      });
    }
  });

  // Goal Normalization Endpoint
  app.post("/api/normalize-goal", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = NormalizeGoalSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalData, userContext } = validation.data;
      const normalizedText = await normalizeGoal(goalData, userContext);
      res.json({ normalizedMatchingText: normalizedText });
    } catch (error: any) {
      console.error("Goal normalization error:", error);
      res.status(500).json({ 
        error: "Failed to normalize goal",
        details: error.message || String(error)
      });
    }
  });

  // Generate Embedding Endpoint
  app.post("/api/generate-embedding", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const validation = EmbeddingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { text } = validation.data;
      const embedding = await generateEmbedding(text);
      res.json({ embedding });
    } catch (error: any) {
      console.error("Embedding generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate embedding",
        details: error.message || String(error)
      });
    }
  });

  // Precompute Similarity Endpoint
  app.post("/api/goals/precompute", authMiddleware, async (req: any, res) => {
    try {
      const validation = SimilarGoalsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId, embedding } = validation.data;
      if (!goalId || !embedding) {
        return res.status(400).json({ error: "goalId and embedding are required" });
      }

      const matches = await computeAndStoreSimilarGoals(goalId, embedding, req.userId);
      res.json({ success: true, matches });
    } catch (error: any) {
      console.error("Precompute similarity error:", error);
      res.status(500).json({ error: "Failed to precompute similarity" });
    }
  });

  // Admin Reconcile Endpoint
  app.post("/api/admin/reconcile", authMiddleware, async (req: any, res) => {
    try {
      // Check if user is admin
      const userDoc = await db.collection('users').doc(req.userId).get();
      const isAdmin = userDoc.data()?.role === 'admin' || req.user.email === "mohamadriza987@gmail.com";
      
      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      const goalsSnap = await db.collection('goals').get();
      const results = [];

      for (const goalDoc of goalsSnap.docs) {
        const goal = { id: goalDoc.id, ...goalDoc.data() } as any;
        let updated = false;
        let currentEmbedding = goal.embedding;
        let currentNormalizedText = goal.normalizedMatchingText;

        try {
          // 1. Normalize if missing
          if (!currentNormalizedText) {
            currentNormalizedText = await normalizeGoal(goal, { age: null, locality: null });
            await goalDoc.ref.update({ normalizedMatchingText: currentNormalizedText });
            updated = true;
          }

          // 2. Embed if missing
          if (!currentEmbedding && currentNormalizedText) {
            currentEmbedding = await generateEmbedding(currentNormalizedText);
            await goalDoc.ref.update({ embedding: currentEmbedding, embeddingUpdatedAt: new Date().toISOString() });
            updated = true;
          }

          // 3. Precompute similarity
          if (currentEmbedding) {
            await computeAndStoreSimilarGoals(goal.id, currentEmbedding, goal.ownerId);
            updated = true;
          }

          results.push({ id: goal.id, title: goal.title, status: 'success', updated });
        } catch (goalErr: any) {
          console.error(`Error reconciling goal ${goal.id}:`, goalErr);
          results.push({ id: goal.id, title: goal.title, status: 'error', error: goalErr.message });
        }
      }

      res.json({ success: true, processed: results.length, results });
    } catch (error: any) {
      console.error("Reconcile error:", error);
      res.status(500).json({ error: "Failed to reconcile goals" });
    }
  });

  // Admin Hard Reset Groups Endpoint
  app.post("/api/admin/hard-reset-groups", authMiddleware, async (req: any, res) => {
    try {
      // Check if user is admin
      const userDoc = await db.collection('users').doc(req.userId).get();
      const isAdmin = userDoc.data()?.role === 'admin' || req.user.email === "mohamadriza987@gmail.com";
      
      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      // Run hard reset in background to avoid timeout
      hardResetGroups().catch(err => console.error("Background hard reset failed:", err));
      
      res.json({ success: true, message: "Hard reset and rebuild started in background." });
    } catch (error: any) {
      console.error("Hard reset error:", error);
      res.status(500).json({ error: "Failed to start hard reset" });
    }
  });

  // Group Assignment Endpoint
  app.post("/api/groups/assign", authMiddleware, async (req: any, res) => {
    try {
      const validation = GroupAssignSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goal } = validation.data;
      if (!goal.id) {
        return res.status(400).json({ error: "Goal ID is required" });
      }

      const result = await findOrCreateGroupForGoal(goal.id);
      if (result) {
        return res.json(result);
      }

      res.json({ action: 'none', reason: 'No suitable group or cluster found' });
    } catch (error: any) {
      console.error("Group assignment error:", error);
      res.status(500).json({ error: "Failed to assign group", details: error.message });
    }
  });

  // Panda Processing Endpoint (Legacy/Fallback)
  app.post("/api/process-audio", authMiddleware, async (req: any, res) => {
    try {
      if (!checkRateLimit(req.userId)) {
        return res.status(429).json({ error: "Too many requests. Please wait a minute." });
      }

      const { audioBase64, mimeType, userContext } = req.body;
      
      if (!audioBase64 || !mimeType) {
        return res.status(400).json({ error: "Missing audio data or mime type" });
      }

      const structuredGoal = await structureGoalFromAudio(audioBase64, mimeType, userContext);
      res.json(structuredGoal);
    } catch (error: any) {
      console.error("Error processing audio with Panda:", error);
      res.status(500).json({ 
        error: "Failed to process audio with Panda",
        details: error.message || String(error)
      });
    }
  });

  // Group Matching Logic (Placeholder for now, will be called from client)
  app.post("/api/groups/match", authMiddleware, async (req: any, res) => {
    const { goalId, category, lat, lng } = req.body;
    const userId = req.userId;
    // In a real app, this would query Firestore for nearby groups with similar themes
    // and return a groupId or create a new one.
    // For now, we'll return a mock success.
    res.json({ success: true, message: "Matching logic triggered" });
  });

  // Moderation Logic
  app.post("/api/moderation/signal", authMiddleware, async (req: any, res) => {
    const { actorId, targetId, type } = req.body;
    // Track trust signals internally
    res.json({ success: true });
  });

  app.get("/api/admin/reports", authMiddleware, async (req: any, res) => {
    try {
      const userDoc = await db.collection('users').doc(req.userId).get();
      const userData = userDoc.data();
      
      if (!userData || userData.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }

      res.json({ message: "Admin reports endpoint" });
    } catch (error) {
      console.error("Admin check error:", error);
      res.status(500).json({ error: "Internal server error during admin check" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Diagnostic Endpoint (Temporary)
  app.get("/api/debug/inspect-goals", async (req, res) => {
    try {
      const emails = ["mohamadriza987@gmail.com", "riza9987@gmail.com", "ai.riza71242704@gmail.com"];
      const goalsSnap = await db.collection('goals').get();
      const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      // We don't have user emails directly in goals, so we'll just return all goals
      // and filter them by the titles/descriptions you mentioned if possible, 
      // or just return the last 10 goals.
      const recentGoals = allGoals
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 15);

      res.json({ goals: recentGoals });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Diagnostic: Dump goals to a file
  (async () => {
    try {
      console.log("Startup diagnostic: Dumping goals and reconciling...");
      const goalsSnap = await getClientDocs(getClientCollection(clientDb, 'goals'));
      const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const recentGoals = allGoals
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 15);
      
      fs.writeFileSync("debug_goals.json", JSON.stringify(recentGoals, null, 2));
      console.log("Goals dumped to debug_goals.json");
      
      // ONE-TIME HARD RESET AS REQUESTED
      // Using client SDK for hard reset
      // await hardResetGroups();
      
    } catch (err: any) {
      console.error("Failed to dump or reconcile goals at startup:", err);
      fs.writeFileSync("debug_error.txt", `Startup Error: ${err.message}\nStack: ${err.stack}`);
    }
  })();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
