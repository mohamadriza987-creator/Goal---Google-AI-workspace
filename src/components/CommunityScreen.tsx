import React, { useState, useEffect } from 'react';
import { collection, query, limit, getDocs, orderBy, onSnapshot, addDoc, doc, updateDoc, arrayUnion, where, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { CommunityMessage, Group, User } from '../types';
import { User as FirebaseUser } from 'firebase/auth';
import { motion } from 'motion/react';
import { Filter, MoreHorizontal, MessageSquare, Heart, MessageCircle, Plus, Mic, Send, Eye, EyeOff, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface CommunityScreenProps {
  user: FirebaseUser;
  dbUser: User | null;
  handleFirestoreError: (error: unknown, operationType: any, path: string | null) => void;
  reportUser: (reportedUserId: string, messageId: string, reason: string) => Promise<void>;
}

import { useTranslation } from '../contexts/LanguageContext';

export function CommunityScreen({ user, dbUser, handleFirestoreError, reportUser }: CommunityScreenProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [userGroups, setUserGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'link' | 'thread'>('all');
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [mediaUrl, setMediaUrl] = useState('');
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [replyingTo, setReplyingTo] = useState<CommunityMessage | null>(null);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [selectedMsgForNote, setSelectedMsgForNote] = useState<CommunityMessage | null>(null);
  const [noteComment, setNoteComment] = useState('');

  // Auto-resize textareas
  useEffect(() => {
    const adjustHeights = () => {
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight) + 'px';
      });
    };
    
    const timeoutId = setTimeout(adjustHeights, 50);
    
    window.addEventListener('resize', adjustHeights);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', adjustHeights);
    };
  }, [messageInput, isMediaModalOpen]);

  useEffect(() => {
    // 1. Find all goals of the user to get their groupIds
    const gq = query(collection(db, 'goals'), where('ownerId', '==', user.uid));
    const unsubscribeGoals = onSnapshot(gq, async (snap) => {
      const groupIds = Array.from(new Set(snap.docs.map(d => d.data().groupId).filter(Boolean)));
      
      if (groupIds.length > 0) {
        const grpsSnap = await getDocs(collection(db, 'groups'));
        const grps = grpsSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Group))
          .filter(g => groupIds.includes(g.id));
        
        setUserGroups(grps);
        if (!activeGroup && grps.length > 0) {
          setActiveGroup(grps[0]);
        }
      } else {
        setUserGroups([]);
        setActiveGroup(null);
      }
    });

    return () => unsubscribeGoals();
  }, [user.uid]);

  useEffect(() => {
    if (!activeGroup || !user.uid) return;

    // Ensure user is in the members subcollection for security rules
    const checkMembership = async () => {
      try {
        const memberRef = doc(db, 'groups', activeGroup.id, 'members', user.uid);
        const snap = await getDocs(query(collection(db, 'groups', activeGroup.id, 'members'), where('userId', '==', user.uid)));
        
        if (snap.empty) {
          await setDoc(memberRef, {
            userId: user.uid,
            joinedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error("Error ensuring membership:", err);
      }
    };

    checkMembership();

    const mq = query(collection(db, 'groups', activeGroup.id, 'messages'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(mq, (msnap) => {
      const m = msnap.docs.map(d => ({ id: d.id, ...d.data() } as CommunityMessage));
      setMessages(m);
    }, (err) => handleFirestoreError(err, 'get', `groups/${activeGroup.id}/messages`));

    return () => unsubscribe();
  }, [activeGroup?.id]);

  const filteredMessages = React.useMemo(() => {
    return messages
      .filter(msg => {
        if (filterType === 'all') return true;
        if (filterType === 'image') return msg.contentType === 'image' || msg.mediaType === 'image';
        if (filterType === 'video') return msg.contentType === 'video' || msg.mediaType === 'video';
        if (filterType === 'link') return msg.contentType === 'link';
        if (filterType === 'thread') return !msg.replyToMessageId;
        return true;
      })
      .filter(msg => !dbUser?.blockedUsers?.includes(msg.userId))
      .filter(msg => !dbUser?.hiddenUsers?.includes(msg.userId));
  }, [messages, filterType, dbUser?.blockedUsers, dbUser?.hiddenUsers]);

  const handleSendMessage = async (content: string) => {
    if (!activeGroup) return;
    const trimmedContent = content.trim();
    if (!trimmedContent && !mediaUrl) return;
    if (trimmedContent.length > 2000) {
      alert("Message is too long (max 2000 characters)");
      return;
    }

    try {
      const msgData: any = {
        groupId: activeGroup.id,
        userId: user.uid,
        content: trimmedContent,
        contentType: mediaUrl ? mediaType : 'text',
        mediaUrl: mediaUrl || undefined,
        mediaType: mediaUrl ? mediaType : undefined,
        viewOnce: isViewOnce,
        viewedBy: [],
        createdAt: new Date().toISOString(),
        reactions: {},
      };
      
      if (replyingTo) {
        msgData.replyToMessageId = replyingTo.id;
      }

      await addDoc(collection(db, 'groups', activeGroup.id, 'messages'), msgData);
      setMediaUrl('');
      setIsMediaModalOpen(false);
      setIsViewOnce(false);
      setReplyingTo(null);
    } catch (err) {
      handleFirestoreError(err, 'write', `groups/${activeGroup.id}/messages`);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    // ... existing logic ...
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeGroup) return;
    if (!window.confirm("Are you sure you want to delete this message?")) return;
    try {
      const msgRef = doc(db, 'groups', activeGroup.id, 'messages', messageId);
      await deleteDoc(msgRef);
    } catch (err) {
      handleFirestoreError(err, 'delete', `groups/${activeGroup.id}/messages/${messageId}`);
    }
  };

  const handleHideUser = async (targetUserId: string) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        hiddenUsers: arrayUnion(targetUserId)
      });
      alert("User hidden. You will no longer see their messages.");
    } catch (err) {
      handleFirestoreError(err, 'update', 'users');
    }
  };

  const handleBlockUser = async (targetUserId: string) => {
    if (!user) return;
    if (!window.confirm("Block this user? They will not be able to interact with you.")) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        blockedUsers: arrayUnion(targetUserId)
      });
      alert("User blocked.");
    } catch (err) {
      handleFirestoreError(err, 'update', 'users');
    }
  };

  const handleSaveToNotes = async () => {
    if (!selectedMsgForNote || !activeGroup) return;
    try {
      // Find the goal associated with this group for the user
      const gq = query(collection(db, 'goals'), where('ownerId', '==', user.uid), where('groupId', '==', activeGroup.id), limit(1));
      const gsnap = await getDocs(gq);
      if (gsnap.empty) {
        alert("No active goal found for this community.");
        return;
      }
      const goalId = gsnap.docs[0].id;

      await addDoc(collection(db, 'goals', goalId, 'notes'), {
        goalId,
        ownerId: user.uid,
        sourceType: 'community_message',
        sourceMessageId: selectedMsgForNote.id,
        text: selectedMsgForNote.content,
        privateComment: noteComment,
        createdAt: new Date().toISOString()
      });

      setIsNoteModalOpen(false);
      setSelectedMsgForNote(null);
      setNoteComment('');
      alert("Saved to notes!");
    } catch (err) {
      handleFirestoreError(err, 'write', 'notes');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl mx-auto p-6 pt-12 pb-32"
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('community')}</h1>
          <div className="flex items-center gap-2 mt-1">
            {userGroups.length > 1 ? (
              <select 
                value={activeGroup?.id} 
                onChange={(e) => setActiveGroup(userGroups.find(g => g.id === e.target.value) || null)}
                className="bg-transparent border-none text-zinc-500 text-sm p-0 focus:ring-0 font-medium cursor-pointer hover:text-white transition-colors"
              >
                {userGroups.map(g => (
                  <option key={g.id} value={g.id} className="bg-zinc-900 text-white">
                    {g.derivedGoalTheme}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-zinc-500 text-sm">{t('goalGroup')}: {activeGroup?.derivedGoalTheme || t('matching') + "..."}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative group">
            <button className="p-2 text-zinc-500 hover:text-white"><Filter size={20} /></button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-50 p-2">
              {(['all', 'image', 'video', 'link', 'thread'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={cn(
                    "w-full text-left px-4 py-2 rounded-xl text-xs capitalize",
                    filterType === f ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-800"
                  )}
                >
                  {f}s
                </button>
              ))}
            </div>
          </div>
          <button className="p-2 text-zinc-500 hover:text-white"><MoreHorizontal size={20} /></button>
        </div>
      </div>

      <div className="space-y-6">
        {!activeGroup && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin mb-4" />
            <p className="text-zinc-500">Finding your goal group...</p>
          </div>
        )}

        {activeGroup && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-zinc-800">
              <MessageSquare size={24} className="text-zinc-700" />
            </div>
            <p className="text-zinc-500 font-medium">{t('noMessages')}</p>
            <p className="text-zinc-600 text-xs mt-2">{t('beFirst')}</p>
          </div>
        )}

        {filteredMessages.map(msg => {
          const isViewOnceMedia = msg.viewOnce && (msg.mediaType === 'image' || msg.mediaType === 'video');
          const hasViewed = msg.viewedBy?.includes(user.uid);
          
          return (
            <div key={msg.id} className="flex gap-4 group/msg">
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">User {msg.userId.slice(0, 4)}</span>
                    <span className="text-zinc-600 text-[10px]">{formatDistanceToNow(new Date(msg.createdAt))} ago</span>
                  </div>
                  <div className="relative opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <button className="p-1 text-zinc-600 hover:text-white"><MoreHorizontal size={14} /></button>
                    <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl hidden group-hover:block z-50 p-1">
                      {msg.userId === user.uid ? (
                        <button 
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="w-full text-left px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-500/10 rounded-lg mb-1"
                        >
                          Delete Message
                        </button>
                      ) : (
                        <>
                          <button 
                            onClick={() => handleHideUser(msg.userId)}
                            className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 rounded-lg mb-1"
                          >
                            Hide User
                          </button>
                          <button 
                            onClick={() => handleBlockUser(msg.userId)}
                            className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 rounded-lg mb-1"
                          >
                            Block User
                          </button>
                          <button 
                            onClick={() => reportUser(msg.userId, msg.id, 'Inappropriate content')}
                            className="w-full text-left px-3 py-1.5 text-[10px] text-red-500 hover:bg-red-500/10 rounded-lg mb-1"
                          >
                            Report Content
                          </button>
                        </>
                      )}
                      <button 
                        onClick={() => {
                          setSelectedMsgForNote(msg);
                          setIsNoteModalOpen(true);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 rounded-lg"
                      >
                        Save to Notes
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-none space-y-3">
                  {msg.replyToMessageId && (
                    <div className="p-2 bg-zinc-800/50 border-l-2 border-white/20 rounded-lg mb-2 text-[10px] opacity-60">
                      {messages.find(m => m.id === msg.replyToMessageId)?.content || "Original message deleted"}
                    </div>
                  )}
                  {msg.content && <p className="text-zinc-300 leading-relaxed">{msg.content}</p>}
                  
                  {msg.mediaUrl && (
                    <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
                      {isViewOnceMedia && hasViewed ? (
                        <div className="text-center p-6">
                          <EyeOff className="mx-auto mb-2 text-zinc-600" size={24} />
                          <p className="text-xs text-zinc-600 uppercase tracking-widest">Media viewed</p>
                        </div>
                      ) : (
                        <>
                          {msg.mediaType === 'image' ? (
                            <img 
                              src={msg.mediaUrl} 
                              className="w-full h-full object-cover select-none pointer-events-none" 
                              referrerPolicy="no-referrer"
                              onContextMenu={(e) => e.preventDefault()}
                              onClick={async () => {
                                if (isViewOnceMedia) {
                                  await updateDoc(doc(db, 'groups', activeGroup.id, 'messages', msg.id), {
                                    viewedBy: arrayUnion(user.uid)
                                  });
                                }
                              }}
                            />
                          ) : (
                            <video 
                              src={msg.mediaUrl} 
                              className="w-full h-full object-cover select-none"
                              controls
                              onContextMenu={(e) => e.preventDefault()}
                              onPlay={async () => {
                                if (isViewOnceMedia) {
                                  setTimeout(async () => {
                                    await updateDoc(doc(db, 'groups', activeGroup.id, 'messages', msg.id), {
                                      viewedBy: arrayUnion(user.uid)
                                    });
                                  }, 10000); // 10s limit
                                }
                              }}
                            />
                          )}
                          {isViewOnceMedia && (
                            <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 backdrop-blur-md rounded text-[8px] uppercase tracking-widest text-white flex items-center gap-1">
                              <Eye size={10} /> View Once
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 px-1">
                  <div className="flex items-center gap-1">
                    {['❤️', '🔥', '👏', '💡'].map(emoji => (
                      <button 
                        key={emoji}
                        onClick={() => handleReaction(msg.id, emoji)}
                        className="text-zinc-600 hover:text-white flex items-center gap-1 text-[10px] bg-zinc-900/50 px-2 py-1 rounded-full border border-zinc-800 hover:border-zinc-700 transition-all"
                      >
                        {emoji} {msg.reactions?.[emoji] || 0}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={() => setReplyingTo(msg)}
                    className="text-zinc-600 hover:text-white flex items-center gap-1 text-xs"
                  >
                    <MessageCircle size={14} /> Reply
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-24 left-6 right-6 max-w-2xl mx-auto">
        {replyingTo && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2 p-3 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-between"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-1 h-8 bg-white/20 rounded-full flex-shrink-0" />
              <div className="truncate">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Replying to User {replyingTo.userId.slice(0, 4)}</p>
                <p className="text-xs text-zinc-400 truncate">{replyingTo.content}</p>
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1 text-zinc-500 hover:text-white"><X size={14} /></button>
          </motion.div>
        )}
        {isMediaModalOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-6 bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center">
              <h4 className="text-xs uppercase tracking-widest text-zinc-500">Attach Media</h4>
              <button onClick={() => setIsMediaModalOpen(false)}><X size={16} /></button>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setMediaType('image')}
                className={cn("flex-1 py-2 rounded-xl text-xs", mediaType === 'image' ? "bg-white text-black" : "bg-zinc-800")}
              >
                Image
              </button>
              <button 
                onClick={() => setMediaType('video')}
                className={cn("flex-1 py-2 rounded-xl text-xs", mediaType === 'video' ? "bg-white text-black" : "bg-zinc-800")}
              >
                Video (10s)
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="relative h-32 border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center hover:border-zinc-700 transition-all cursor-pointer overflow-hidden">
                {mediaUrl ? (
                  mediaType === 'image' ? (
                    <img src={mediaUrl} className="w-full h-full object-cover" />
                  ) : (
                    <video src={mediaUrl} className="w-full h-full object-cover" />
                  )
                ) : (
                  <>
                    <Plus className="text-zinc-600 mb-2" />
                    <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Upload {mediaType}</p>
                  </>
                )}
                <input 
                  type="file" 
                  accept={mediaType === 'image' ? "image/*" : "video/*"}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 800000) { // ~800KB limit for base64 in Firestore
                        alert("File too large. Please choose a file under 800KB.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = (ev) => setMediaUrl(ev.target?.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="viewOnce" 
                  checked={isViewOnce}
                  onChange={(e) => setIsViewOnce(e.target.checked)}
                  className="w-4 h-4 rounded bg-zinc-800 border-zinc-700"
                />
                <label htmlFor="viewOnce" className="text-xs text-zinc-400">View Once</label>
              </div>
            </div>
          </motion.div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-2 flex items-center gap-2 shadow-2xl">
          <button 
            onClick={() => setIsMediaModalOpen(true)}
            className="p-3 text-zinc-500 hover:text-white"
          >
            <Plus size={20} />
          </button>
          <textarea 
            placeholder={t('messageGroup') + "..."}
            value={messageInput}
            onChange={(e) => {
              setMessageInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = target.scrollHeight + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (messageInput.trim() || mediaUrl) {
                  handleSendMessage(messageInput);
                  setMessageInput('');
                }
              }
            }}
            rows={1}
            className="flex-1 bg-transparent border-none focus:ring-0 py-3 text-sm resize-none overflow-hidden"
          />
          <button className="p-3 text-zinc-500 hover:text-white"><Mic size={20} /></button>
          <button 
            onClick={() => {
              if (messageInput.trim() || mediaUrl) {
                handleSendMessage(messageInput);
                setMessageInput('');
              }
            }}
            className="p-3 bg-white text-black rounded-2xl"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      <NoteModal 
        isOpen={isNoteModalOpen}
        onClose={() => setIsNoteModalOpen(false)}
        onSave={handleSaveToNotes}
        comment={noteComment}
        setComment={setNoteComment}
        message={selectedMsgForNote}
      />
    </motion.div>
  );
}

function NoteModal({ isOpen, onClose, onSave, comment, setComment, message }: { isOpen: boolean, onClose: () => void, onSave: () => void, comment: string, setComment: (v: string) => void, message: CommunityMessage | null }) {
  if (!isOpen || !message) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md p-6 space-y-6 shadow-2xl"
      >
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold">Save to Notes</h3>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:text-white"><X size={20} /></button>
        </div>
        
        <div className="p-4 bg-zinc-800/50 rounded-2xl border border-zinc-800">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Message Content</p>
          <p className="text-sm text-zinc-300 italic">"{message.content}"</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Personal Comment (Optional)</label>
          <textarea 
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why is this message useful?"
            className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-sm focus:ring-1 focus:ring-white/20 min-h-[100px] resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-4 rounded-2xl bg-zinc-800 font-semibold hover:bg-zinc-700 transition-colors">Cancel</button>
          <button onClick={onSave} className="flex-1 py-4 rounded-2xl bg-white text-black font-semibold hover:bg-zinc-200 transition-colors">Save Note</button>
        </div>
      </motion.div>
    </div>
  );
}
