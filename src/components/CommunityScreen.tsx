import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { Users, Loader2, ChevronDown } from 'lucide-react';
import { StreamChat } from 'stream-chat';
import {
  Chat,
  Channel,
  MessageList,
  MessageInput,
  Thread,
  Window,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/v2/index.css';
import { useTranslation } from '../contexts/LanguageContext';

interface CommunityScreenProps {
  user: FirebaseUser;
  dbUser: User | null;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  reportUser: (reportedUserId: string, messageId: string, reason: string) => Promise<void>;
}

interface JoinedGroup {
  groupId: string;
  goalId: string;
  goalTitle: string;
  joinedAt: string;
  memberCount: number;
}

export function CommunityScreen({ user, dbUser }: CommunityScreenProps) {
  const { t } = useTranslation();
  const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [chatClient, setChatClient] = useState<StreamChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const fetchJoined = async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/groups/joined', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!res.ok) throw new Error('Failed to fetch joined groups');
        const data = await res.json();
        const groups = data.joinedGroups || [];
        setJoinedGroups(groups);
        if (groups.length > 0) setActiveGroupId(groups[0].groupId);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchJoined();
  }, [user]);

  useEffect(() => {
    let activeClient: StreamChat | null = null;

    const initChat = async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/stream/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          }
        });
        if (!res.ok) throw new Error('Failed to get chat token');
        const { token, apiKey } = await res.json();

        const client = StreamChat.getInstance(apiKey);
        if (!client.userID) {
          await client.connectUser(
            {
              id: user.uid,
              name: dbUser?.displayName || user.displayName || `User ${user.uid.slice(0, 4)}`,
              image: user.photoURL || undefined,
            },
            token
          );
        }
        activeClient = client;
        setChatClient(client);
      } catch (err) {
        console.error('Stream init error:', err);
      }
    };

    if (user && dbUser) initChat();

    return () => {
      if (activeClient) {
        activeClient.disconnectUser().catch(console.error);
        activeClient = null;
      }
    };
  }, [user, dbUser]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <Loader2 className="animate-spin mb-4 text-white" size={32} />
        <p className="text-zinc-500">Loading communities...</p>
      </div>
    );
  }

  if (joinedGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center px-6">
        <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800">
          <Users size={24} className="text-zinc-700" />
        </div>
        <h2 className="text-xl font-bold mb-2">No Communities Joined</h2>
        <p className="text-zinc-500 max-w-xs">
          Join a community from your goal cards to start collaborating with others.
        </p>
      </div>
    );
  }

  if (!chatClient) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <Loader2 className="animate-spin mb-4 text-white" size={32} />
        <p className="text-zinc-500">Connecting to chat...</p>
      </div>
    );
  }

  const activeGroup = joinedGroups.find(g => g.groupId === activeGroupId);
  const channel = activeGroupId ? chatClient.channel('messaging', activeGroupId) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col"
      style={{ height: 'calc(100dvh - 80px)' }}
    >
      {/* Sticky header with group switcher */}
      <div className="flex-shrink-0 px-4 pt-12 pb-3 border-b border-zinc-800 bg-black sticky top-0 z-10 relative">
        <button
          onClick={() => setShowDropdown(v => !v)}
          className="flex items-center gap-2 mx-auto"
        >
          <div className="text-center">
            <h1 className="text-lg font-bold leading-tight">{activeGroup?.goalTitle || 'Community'}</h1>
            <p className="text-xs text-zinc-500">{activeGroup?.memberCount || 0} members</p>
          </div>
          {joinedGroups.length > 1 && (
            <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          )}
        </button>

        {showDropdown && joinedGroups.length > 1 && (
          <div className="absolute top-full left-4 right-4 z-50 mt-1 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
            {joinedGroups.map(g => (
              <button
                key={g.groupId}
                onClick={() => { setActiveGroupId(g.groupId); setShowDropdown(false); }}
                className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                  g.groupId === activeGroupId ? 'bg-white/10 text-white font-medium' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                <div className="font-medium">{g.goalTitle}</div>
                <div className="text-xs text-zinc-600">{g.memberCount} members</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat area — fills remaining height exactly, no overflow under nav */}
      <div className="flex-1 min-h-0">
        {channel ? (
          <Chat client={chatClient} theme="str-chat__theme-dark">
            <Channel channel={channel}>
              <Window>
                <MessageList />
                <MessageInput
                  audioRecordingEnabled
                  focus
                />
              </Window>
              <Thread />
            </Channel>
          </Chat>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Select a community above
          </div>
        )}
      </div>
    </motion.div>
  );
}
