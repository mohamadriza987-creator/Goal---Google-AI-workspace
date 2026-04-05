import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

async function testDb(dbId: string | undefined) {
  const label = dbId || "(default)";
  console.log(`Testing Firestore database: ${label}...`);
  try {
    const db = dbId ? getFirestore(admin.app(), dbId) : getFirestore(admin.app());
    await db.collection("_health_test").doc("check").set({ lastCheck: new Date().toISOString() });
    console.log(`SUCCESS: Firestore database ${label} is accessible.`);
    return true;
  } catch (error: any) {
    console.error(`FAILURE: Firestore database ${label} error:`, error.message);
    return false;
  }
}

(async () => {
  await testDb(undefined);
  await testDb(firebaseConfig.firestoreDatabaseId);
})();
