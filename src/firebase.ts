import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

console.log('Initializing Firestore with database ID:', firebaseConfig.firestoreDatabaseId);
export const db = getFirestore(app, 'ai-studio-a88ce025-f109-4cce-bf43-4c096c19e5dd');
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Connection test
async function testConnection() {
  try {
    console.log('Testing Firestore connection...');
    const testDoc = await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firestore connection test successful:', testDoc.exists());
  } catch (error: any) {
    console.error("Firestore connection test failed:", error);
    if (error.message?.includes('Missing or insufficient permissions')) {
      console.warn("Firestore permissions check: The 'test' collection might not be ready yet or rules are still propagating.");
    } else if (error.message?.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client appears to be offline.");
    }
  }
}
testConnection();
