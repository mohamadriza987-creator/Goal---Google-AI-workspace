export interface User {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
  age?: number;
  locality?: string;
  geohash?: string;
  lat?: number;
  lng?: number;
  preferredLanguage?: string;
  role?: 'admin' | 'user';
  hiddenUsers?: string[];
  blockedUsers?: string[];
  trustSignals?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export interface Goal {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  originalVoiceTranscript?: string;
  originalLanguage?: string;
  aiGeneratedTitle?: string;
  aiGeneratedDescription?: string;
  visibility: 'private' | 'public';
  publicFields?: string[];
  category?: string;
  status: 'active' | 'completed' | 'archived';
  progressPercent: number;
  likesCount: number;
  groupId?: string;
  groupJoined?: boolean;
  joinedAt?: string;
  eligibleAt?: string;
  createdAt: string;
  updatedAt?: string;
  savingStatus?: 'saving' | 'success' | 'error';
  draftData?: any;
  sourceText?: string;
  normalizedMatchingText?: string;
  timeHorizon?: string;
  tags?: string[];
  embedding?: number[];
  embeddingUpdatedAt?: string;
  similarGoals?: {
    goalId: string;
    userId: string;
    goalTitle: string;
    similarityScore: number;
    groupId?: string;
    description?: string;
  }[];
  matchingMetadata?: {
    age?: number;
    locality?: string;
    skillLevel?: string;
    subFocus?: string;
    [key: string]: any;
  };
}

export interface TaskNote {
  id: string;
  text: string;
  reminderAt?: string;
  createdAt: string;
}

export interface GoalTask {
  id: string;
  goalId: string;
  text: string;
  source: 'ai' | 'user' | 'manual';
  order: number;
  isDone: boolean;
  completedAt?: string;
  reminderAt?: string;
  notes?: TaskNote[];
  microSteps?: string[];
  createdAt: string;
}

export interface GoalNote {
  id: string;
  goalId: string;
  ownerId: string;
  sourceType: 'manual' | 'community_message' | 'ai_suggestion';
  sourceMessageId?: string;
  text: string;
  privateComment?: string;
  reminderAt?: string;
  createdAt: string;
}

export interface Group {
  id: string;
  derivedGoalTheme: string;
  localityCenter?: string;
  geohash?: string;
  lat?: number;
  lng?: number;
  radiusUsed?: number;
  targetRegion?: string;
  memberCount: number;
  maxMembers: number;
  members?: {
    goalId: string;
    userId: string;
    joinedAt: string;
  }[];
  representativeEmbedding?: number[];
  matchingCriteria?: {
    category?: string;
    timeHorizon?: string;
    privacy?: 'public' | 'private';
  };
  createdAt: string;
  updatedAt?: string;
}

export interface CommunityMessage {
  id: string;
  groupId: string;
  userId: string;
  content: string;
  contentType: 'text' | 'image' | 'video' | 'link' | 'poll';
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  viewOnce?: boolean;
  viewedBy?: string[]; // Array of user IDs who have viewed it
  replyToMessageId?: string;
  threadRootId?: string;
  reactions?: Record<string, number>;
  attachmentMetadata?: Record<string, any>;
  createdAt: string;
}

// ─────────────────────────────────────────────
// GOAL ROOM — structured threads
// ─────────────────────────────────────────────

export type ThreadBadge = 'help' | 'support' | 'together' | 'completed' | 'useful' | 'blocked';

export type ThreadReaction = 'useful' | 'proud' | 'me_too' | 'can_help';

export interface GoalRoomThread {
  id: string;
  goalId: string;
  badge: ThreadBadge;
  title: string;
  linkedTaskId?: string;
  linkedTaskText?: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  previewText: string;
  replyCount: number;
  usefulCount: number;
  reactions?: Partial<Record<ThreadReaction, number>>;
  isPinned?: boolean;
  createdAt: string;
  lastActivityAt: string;
}

export interface GoalRoomReply {
  id: string;
  threadId: string;
  goalId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  text: string;
  reactions?: Partial<Record<ThreadReaction, number>>;
  myReactions?: ThreadReaction[];
  savedToNotes?: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────
// PEOPLE — suggested rooms & person cards
// ─────────────────────────────────────────────

export interface SuggestedRoom {
  groupId: string;
  roomTitle: string;
  similarityPercent: number;
  memberCount: number;
  activityLevel: 'low' | 'medium' | 'high';
  completedCurrentTask: number;
}

export interface PersonCard {
  userId: string;
  firstName: string;
  avatarUrl?: string;
  sharedTaskCount: number;
  localityBand: string;
  helpfulnessScore: number;
}

// ─────────────────────────────────────────────
// NOTES — personal + saved from room
// ─────────────────────────────────────────────

export type NotePrivacy = 'private' | 'shared';
export type NoteSource = 'manual' | 'saved_from_room' | 'ai_suggestion';

export interface Note {
  id: string;
  goalId: string;
  ownerId: string;
  title?: string;
  text: string;
  privacy: NotePrivacy;
  source: NoteSource;
  linkedTaskId?: string;
  linkedTaskText?: string;
  savedFromAuthorName?: string;
  savedFromReplyId?: string;
  createdAt: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────────
// ACTIVITY
// ─────────────────────────────────────────────

export type ActivityItemType =
  | 'reply_to_my_thread'
  | 'someone_helped_me'
  | 'useful_response'
  | 'stuck_on_my_task'
  | 'help_request_match'
  | 'new_thread'
  | 'new_useful_resource'
  | 'together_session'
  | 'local_opportunity';

export interface ActivityItem {
  id: string;
  type: ActivityItemType;
  goalId?: string;
  goalTitle?: string;
  threadId?: string;
  actorName: string;
  actorAvatar?: string;
  previewText: string;
  createdAt: string;
  isRead: boolean;
}