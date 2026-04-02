import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function seed() {
  try {
    const groupRef = await addDoc(collection(db, 'groups'), {
      derivedGoalTheme: 'Learning & Growth',
      localityCenter: 'Global',
      memberCount: 1,
      maxMembers: 70,
      createdAt: new Date().toISOString(),
    });

    await addDoc(collection(db, 'groups', groupRef.id, 'messages'), {
      groupId: groupRef.id,
      userId: 'system',
      content: 'Welcome to the Learning & Growth group! Share your goals and progress here.',
      contentType: 'text',
      reactions: {},
      createdAt: new Date().toISOString(),
    });

    console.log('Seed completed successfully');
  } catch (err) {
    console.error('Seed failed:', err);
  }
}

seed();
