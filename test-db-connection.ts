import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

async function listDatabases() {
  try {
    const db = getFirestore();
    // There isn't a direct listDatabases in the Admin SDK, but we can try to list collections in the default one
    console.log("Listing collections in (default)...");
    const collections = await db.listCollections();
    console.log("Collections in (default):", collections.map(c => c.id));
  } catch (error: any) {
    console.error("Error listing collections in (default):", error.message);
  }

  try {
    const namedDb = getFirestore(firebaseConfig.firestoreDatabaseId);
    console.log(`Listing collections in ${firebaseConfig.firestoreDatabaseId}...`);
    const collections = await namedDb.listCollections();
    console.log(`Collections in ${firebaseConfig.firestoreDatabaseId}:`, collections.map(c => c.id));
  } catch (error: any) {
    console.error(`Error listing collections in ${firebaseConfig.firestoreDatabaseId}:`, error.message);
  }
}

listDatabases();
