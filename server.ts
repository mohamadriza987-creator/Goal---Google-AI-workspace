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

// Load Firebase config for Admin SDK
const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json", "utf-8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId || '(default)');

import { loadEnv } from "vite";

// Helper for cosine similarity
function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
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

  // Find Similar Goals Endpoint
  app.post("/api/goals/similar", authMiddleware, async (req: any, res) => {
    try {
      const validation = SimilarGoalsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Invalid payload", details: validation.error.format() });
      }

      const { goalId, embedding } = validation.data;
      
      // Fetch all goals from Firestore (Admin SDK bypasses security rules)
      const goalsSnap = await db.collection('goals').get();
      const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const matches = allGoals
        .filter((g: any) => g.id !== goalId && g.embedding)
        .map((g: any) => {
          const score = cosineSimilarity(embedding, g.embedding);
          return {
            id: g.id,
            ownerId: g.ownerId,
            goalTitle: g.title,
            normalizedMatchingText: g.normalizedMatchingText,
            similarityScore: score,
            category: g.category,
            timeHorizon: g.timeHorizon,
            locality: g.matchingMetadata?.locality,
            privacy: g.visibility
          };
        })
        .sort((a: any, b: any) => b.similarityScore - a.similarityScore)
        .slice(0, 5);

      res.json({ matches });
    } catch (error: any) {
      console.error("Similarity matching error:", error);
      res.status(500).json({ 
        error: "Failed to find similar goals",
        details: error.message || String(error)
      });
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
      if (!goal.embedding) {
        return res.status(400).json({ error: "Goal embedding is required" });
      }

      // Fetch all goals and groups from Firestore (Admin SDK bypasses security rules)
      const goalsSnap = await db.collection('goals').get();
      const allGoals = goalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      const groupsSnap = await db.collection('groups').get();
      const allGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const SIMILARITY_THRESHOLD_EXISTING = 0.85;
      const SIMILARITY_THRESHOLD_NEW = 0.80;

      // 1. Try to find an existing group
      let bestGroup = null;
      let maxScore = -1;

      for (const group of allGroups) {
        if (!group.representativeEmbedding) continue;
        
        // Filter by privacy
        if (goal.visibility === 'private' && group.matchingCriteria?.privacy !== 'private') continue;
        if (goal.visibility !== 'private' && group.matchingCriteria?.privacy === 'private') continue;

        const score = cosineSimilarity(goal.embedding, group.representativeEmbedding);
        if (score > maxScore) {
          maxScore = score;
          bestGroup = group;
        }
      }

      if (bestGroup && maxScore >= SIMILARITY_THRESHOLD_EXISTING) {
        return res.json({ 
          action: 'assigned', 
          groupId: bestGroup.id, 
          groupName: bestGroup.derivedGoalTheme,
          score: maxScore 
        });
      }

      // 2. Try to find a cluster of goals to form a new group
      const ungroupedGoals = allGoals.filter(g => !g.groupId && g.id !== goal.id && g.embedding);
      const potentialMatches = ungroupedGoals
        .map(g => ({ goal: g, score: cosineSimilarity(goal.embedding, g.embedding) }))
        .filter(m => m.score >= SIMILARITY_THRESHOLD_NEW)
        .sort((a, b) => b.score - a.score);

      if (potentialMatches.length >= 1) { // Cluster of 2 (new goal + at least 1 other)
        const clusterGoals = [goal, ...potentialMatches.slice(0, 4).map(m => m.goal)];
        const groupName = await generateGroupName(clusterGoals.map(g => ({ title: g.title, description: g.description })));
        
        return res.json({ 
          action: 'create', 
          groupName, 
          memberGoalIds: clusterGoals.map(g => g.id),
          representativeEmbedding: goal.embedding,
          matchingCriteria: {
            category: goal.category,
            timeHorizon: goal.timeHorizon,
            privacy: goal.visibility === 'private' ? 'private' : 'public'
          }
        });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
