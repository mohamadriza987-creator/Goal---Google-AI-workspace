import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

admin.initializeApp();

const db = getFirestore();

(async () => {
  try {
    console.log("Testing Firestore (default) connection with default app...");
    await db.collection("_health").doc("check").set({ lastCheck: new Date().toISOString() });
    console.log("Firestore (default) connection test successful.");
  } catch (error) {
    console.error("Firestore (default) connection test failed:", error);
  }
})();
