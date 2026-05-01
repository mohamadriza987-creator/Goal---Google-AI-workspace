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
  // Extended matching metadata — enriches the goal index layer
  nationality?: string;
  ageCategory?: '13-17' | '18-30' | '31-45' | '45+';
  languages?: string[];
  lastLoggedInAt?: string;
  role?: 'admin' | 'user';
  hiddenUsers?: string[];
  blockedUsers?: string[];
  trustSignals?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export interface DraftData {
  structuredGoal: {
    transcript: string;
    title: string;
    description: string;
    categories: string[];
    languages: string[];
    tasks: { text: string; microSteps: string[] }[];
    tags: string[];
    timeHorizon: string;
    privacy: 'private' | 'public';
    normalizedMatchingText: string;
  };
  manualTasks: string[];
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
  categories?: string[];
  status: 'active' | 'completed' | 'archived';
  progressPercent: number;
  likesCount: number;
  groupId?: string;
  groupJoined?: boolean;
  joinedAt?: string;
  eligibleAt?: string;
  createdAt: string;
  updatedAt?: string;
  savingStatus?: 'saving' | 'success' | 'partial' | 'error';
  saveErrorMessage?: string;
  // Client-generated temp ID written into the saved doc so the realtime
  // listener can deduplicate optimistic copies without title+timestamp
  // heuristics that mis-fire on duplicate titles.
  tempId?: string;
  draftData?: DraftData;
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
  ownerId?: string;
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

export interface CalendarNote {
  id: string;    // YYYY-MM-DD date key
  date: string;  // YYYY-MM-DD
  text: string;
  createdAt: string;
  updatedAt?: string;
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

export type NotePrivacy = 'private' | 'shared';

export interface Note {
  id: string;
  goalId: string;
  ownerId: string;
  text: string;
  title?: string | null;
  privacy: NotePrivacy;
  source: 'manual' | 'saved_from_room';
  savedFromAuthorName?: string;
  linkedTaskText?: string;
  createdAt: string;
  updatedAt?: string;
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

