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
  visibility: 'private' | 'group' | 'public';
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
    privacy?: 'public' | 'group';
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
