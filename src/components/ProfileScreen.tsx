import React from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Shield, MoreHorizontal, LogOut, Plus } from 'lucide-react';

interface ProfileScreenProps {
  user: FirebaseUser | null;
}

export function ProfileScreen({ user }: ProfileScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto p-6 pt-12"
    >
      <div className="flex flex-col items-center text-center mb-12">
        <div className="w-24 h-24 rounded-full bg-zinc-800 mb-4" />
        <h2 className="text-2xl font-bold">{user?.displayName}</h2>
        <p className="text-zinc-500 text-sm">@{user?.email?.split('@')[0]}</p>
      </div>

      <div className="space-y-4">
        {user?.email === 'mohamadriza987@gmail.com' && (
          <button 
            onClick={async () => {
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
              alert('Demo group created!');
            }}
            className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-white hover:bg-zinc-800 transition-colors"
          >
            <Plus />
            <span className="font-semibold">Create Demo Group</span>
          </button>
        )}
        <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Shield className="text-zinc-500" />
            <div>
              <p className="font-semibold">Privacy & Safety</p>
              <p className="text-xs text-zinc-500">Manage blocked and hidden users</p>
            </div>
          </div>
          <button className="text-zinc-500 hover:text-white"><MoreHorizontal /></button>
        </div>
        <button 
          onClick={() => auth.signOut()}
          className="w-full p-6 bg-zinc-900/50 border border-zinc-800 rounded-3xl flex items-center gap-4 text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <LogOut />
          <span className="font-semibold">Sign Out</span>
        </button>
      </div>
    </motion.div>
  );
}
