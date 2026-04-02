import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import session from "express-session";
import cookieParser from "cookie-parser";
import { structureGoalFromAudio, transcribeAudio, generateGoalFromTranscript } from "./server/gemini.ts";

import fs from "fs";

import { loadEnv } from "vite";

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
  const PORT = Number(process.env.PORT) || 8080;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());
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
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body;
      if (!audioBase64 || !mimeType) {
        return res.status(400).json({ error: "Missing audio data or mime type" });
      }
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
  app.post("/api/generate-goal", async (req, res) => {
    try {
      const { transcript, userContext } = req.body;
      if (!transcript) {
        return res.status(400).json({ error: "Missing transcript" });
      }
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

  // Panda Processing Endpoint (Legacy/Fallback)
  app.post("/api/process-audio", async (req, res) => {
    try {
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
  app.post("/api/groups/match", async (req, res) => {
    const { userId, goalId, category, lat, lng } = req.body;
    // In a real app, this would query Firestore for nearby groups with similar themes
    // and return a groupId or create a new one.
    // For now, we'll return a mock success.
    res.json({ success: true, message: "Matching logic triggered" });
  });

  // Moderation Logic
  app.post("/api/moderation/signal", async (req, res) => {
    const { actorId, targetId, type } = req.body;
    // Track trust signals internally
    res.json({ success: true });
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
