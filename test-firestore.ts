import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId)
  : getFirestore(admin.app());

(async () => {
  try {
    console.log("Testing Firestore connection...");
    await db.collection("_health").doc("check").set({ lastCheck: new Date().toISOString() });
    console.log("Firestore connection test successful.");
  } catch (error) {
    console.error("Firestore connection test failed:", error);
  }
})();
