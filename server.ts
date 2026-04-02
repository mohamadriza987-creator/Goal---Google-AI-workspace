import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import session from "express-session";
import cookieParser from "cookie-parser";
import { structureGoalFromAudio } from "./server/gemini";

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
  const PORT = 3000;

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

  // Panda Processing Endpoint
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
