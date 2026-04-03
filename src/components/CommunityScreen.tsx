import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Group, User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { MoreHorizontal, X, Users, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { StreamChat } from 'stream-chat';
import {
  Chat,
  Channel,
  ChannelHeader,
  MessageList,
  MessageInput,
  Thread,
  Window,
  ChannelList,
  ChannelPreviewUIComponentProps,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/v2/index.css';

interface CommunityScreenProps {
  user: FirebaseUser;
  dbUser: User | null;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  reportUser: (reportedUserId: string, messageId: string, reason: string) => Promise<void>;
}

import { useTranslation } from '../contexts/LanguageContext';

interface JoinedGroup {
  groupId: string;
  goalId: string;
  goalTitle: string;
  joinedAt: string;
  memberCount: number;
}

export function CommunityScreen({ user, dbUser, handleFirestoreError, reportUser }: CommunityScreenProps) {
  const { t } = useTranslation();
  const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [chatClient, setChatClient] = useState<StreamChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch joined groups from backend
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
        if (groups.length > 0 && !activeGroupId) {
          setActiveGroupId(groups[0].groupId);
        }
      } catch (err) {
        console.error(err);
        setError('Could not load your communities.');
      } finally {
        setLoading(false);
      }
    };
    fetchJoined();
  }, [user]);

  // 2. Initialize Stream Chat
  useEffect(() => {
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
        await client.connectUser(
          {
            id: user.uid,
            name: dbUser?.displayName || user.displayName || `User ${user.uid.slice(0, 4)}`,
            image: user.photoURL || undefined,
          },
          token
        );
        setChatClient(client);
      } catch (err) {
        console.error('Stream init error:', err);
        setError('Chat service unavailable.');
      }
    };

    if (user && dbUser) {
      initChat();
    }

    return () => {
      if (chatClient) {
        chatClient.disconnectUser();
      }
    };
  }, [user, dbUser]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Loader2 className="animate-spin mb-4 text-white" size={32} />
        <p className="text-zinc-500">Loading communities...</p>
      </div>
    );
  }

  if (joinedGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800">
          <Users size={24} className="text-zinc-700" />
        </div>
        <h2 className="text-xl font-bold mb-2">No Communities Joined</h2>
        <p className="text-zinc-500 max-w-xs mx-auto mb-8">
          Join a community from your goal cards to start collaborating with others.
        </p>
      </div>
    );
  }

  if (!chatClient) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Loader2 className="animate-spin mb-4 text-white" size={32} />
        <p className="text-zinc-500">Connecting to chat...</p>
      </div>
    );
  }

  const activeGroup = joinedGroups.find(g => g.groupId === activeGroupId);

  // Custom Channel Preview to use the user's goal title
  const CustomChannelPreview = (props: ChannelPreviewUIComponentProps) => {
    const { channel, setActiveChannel } = props;
    const group = joinedGroups.find(g => g.groupId === channel.id);
    const title = group?.goalTitle || (channel.data as any)?.name || 'Community';
    const isActive = channel.id === activeGroupId;

    return (
      <button
        onClick={() => {
          setActiveChannel?.(channel);
          setActiveGroupId(channel.id);
        }}
        className={cn(
          "w-full text-left p-4 rounded-2xl border transition-all mb-2",
          isActive ? "bg-white/10 border-white/20" : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
        )}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold truncate">{title}</h3>
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
            {group?.memberCount || 0} members
          </span>
        </div>
        <p className="text-[10px] text-zinc-600 truncate">
          {channel.state.messages[channel.state.messages.length - 1]?.text || 'No messages yet'}
        </p>
      </button>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto p-6 pt-12 pb-32 h-screen flex flex-col"
    >
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('community')}</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {activeGroup?.goalTitle || 'Select a community'}
          </p>
        </div>
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Sidebar / Switcher */}
        <div className="w-64 flex-shrink-0 overflow-y-auto custom-scrollbar pr-2">
          <div className="flex items-center gap-2 mb-4">
            <Users size={14} className="text-zinc-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Your Communities</span>
          </div>
          <Chat client={chatClient} theme="str-chat__theme-dark">
            <ChannelList
              filters={{ id: { $in: joinedGroups.map(g => g.groupId) } }}
              Preview={CustomChannelPreview}
              sort={{ last_message_at: -1 }}
            />
          </Chat>
        </div>

        {/* Chat Area */}
        <div className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] overflow-hidden flex flex-col">
          {activeGroupId ? (
            <Chat client={chatClient} theme="str-chat__theme-dark">
              <Channel channel={chatClient.channel('messaging', activeGroupId)}>
                <Window>
                  <ChannelHeader />
                  <MessageList />
                  <MessageInput />
                </Window>
                <Thread />
              </Channel>
            </Chat>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-6">
                <MessageCircle size={24} className="text-zinc-600" />
              </div>
              <h3 className="text-lg font-bold mb-2">Select a Community</h3>
              <p className="text-zinc-500 text-sm max-w-xs">
                Pick a community from the sidebar to start chatting with other goal-seekers.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
