import { supabaseAdmin } from './supabaseAdmin.js';
import { nowIso } from './auth.js';
import {
  generateGroupName,
  generateEmbedding,
  normalizeGoal,
} from '../server/gemini.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GoalRow = {
  id: string;
  owner_id?: string;
  title?: string;
  description?: string;
  category?: string;
  time_horizon?: string;
  visibility?: string;
  group_id?: string | null;
  group_joined?: boolean;
  joined_at?: string;
  eligible_at?: string;
  normalized_matching_text?: string;
  embedding?: number[];
  matching_metadata?: { locality?: string };
  tags?: string[];
  created_at?: string;
  [key: string]: any;
};

export type GroupRow = {
  id: string;
  derived_goal_theme?: string;
  representative_embedding?: number[];
  locality_center?: string;
  max_members?: number;
  member_count?: number;
  members?: Array<{ goalId: string; userId: string; joinedAt: string }>;
  member_ids?: string[];
  eligible_goal_ids?: string[];
  matching_criteria?: { category?: string; timeHorizon?: string; privacy?: string };
  created_at?: string;
};

export type GroupIndexEntry = {
  group_id: string;
  member_goal_ids: string[];
  member_user_ids: string[];
  member_count: number;
  categories: string[];
  languages: string[];
  age_categories: string[];
  locations: string[];
  nationalities: string[];
  representative_embedding: number[];
  updated_at: string;
};

export type UnassignedGoalIndexEntry = {
  goal_id: string;
  user_id: string;
  embedding: number[];
  age_category: string;
  current_location: string;
  nationality: string;
  languages: string[];
  categories: string[];
  last_logged_in_at: string;
  activity_status: 'active' | 'inactive';
  updated_at: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function computeAgeCategory(age?: number | null): string {
  if (!age || age < 13) return '';
  if (age <= 17) return '13-17';
  if (age <= 30) return '18-30';
  if (age <= 45) return '31-45';
  return '45+';
}

const IDX_ACTIVE_DAYS = 30;
export function isActiveUser(lastLoggedInAt?: string): boolean {
  if (!lastLoggedInAt) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - IDX_ACTIVE_DAYS);
  return new Date(lastLoggedInAt) >= cutoff;
}

export function isPrivateGoal(goal: GoalRow): boolean {
  return goal.visibility === 'private';
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

// ─────────────────────────────────────────────────────────────────────────────
// Index maintenance
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertGroupIndex(groupId: string): Promise<void> {
  const { data: group } = await supabaseAdmin
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (!group || !group.representative_embedding) return;

  const memberGoalIds: string[] = (group.members || []).map((m: any) => m.goalId);
  const memberUserIds: string[] = group.member_ids ?? uniqueStrings((group.members || []).map((m: any) => m.userId));

  const categories = new Set<string>();
  const languages = new Set<string>();
  const ageCategories = new Set<string>();
  const locations = new Set<string>();
  const nationalities = new Set<string>();

  if (group.matching_criteria?.category) categories.add(group.matching_criteria.category);
  if (group.locality_center && group.locality_center !== 'Global') locations.add(group.locality_center);

  if (memberGoalIds.length > 0) {
    const { data: goalRows } = await supabaseAdmin
      .from('goals')
      .select('category, matching_metadata, owner_id')
      .in('id', memberGoalIds);

    const userIds = new Set<string>();
    for (const g of (goalRows || [])) {
      if (g.category) categories.add(g.category);
      if (g.matching_metadata?.locality) locations.add(g.matching_metadata.locality);
      if (g.owner_id) userIds.add(g.owner_id);
    }

    if (userIds.size > 0) {
      const { data: userRows } = await supabaseAdmin
        .from('users')
        .select('id, locality, nationality, age, languages, preferred_language')
        .in('id', [...userIds]);

      for (const u of (userRows || [])) {
        if (u.locality) locations.add(u.locality);
        if (u.nationality) nationalities.add(u.nationality);
        const ageCat = computeAgeCategory(u.age);
        if (ageCat) ageCategories.add(ageCat);
        const langs: string[] = u.languages || (u.preferred_language ? [u.preferred_language] : []);
        langs.forEach((l: string) => languages.add(l));
      }
    }
  }

  await supabaseAdmin.from('group_index').upsert({
    group_id: groupId,
    member_goal_ids: memberGoalIds,
    member_user_ids: memberUserIds,
    member_count: typeof group.member_count === 'number' ? group.member_count : memberGoalIds.length,
    categories: [...categories],
    languages: [...languages],
    age_categories: [...ageCategories],
    locations: [...locations],
    nationalities: [...nationalities],
    representative_embedding: group.representative_embedding,
    updated_at: nowIso(),
  });
}

export async function removeGroupIndex(groupId: string): Promise<void> {
  await supabaseAdmin.from('group_index').delete().eq('group_id', groupId);
}

export async function upsertGoalToUnassignedIndex(
  goalId: string,
  opts: { stampNow?: boolean } = {},
): Promise<void> {
  const { data: goal } = await supabaseAdmin
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (!goal) return;
  if (goal.group_id) {
    await supabaseAdmin.from('goals_unassigned_index').delete().eq('goal_id', goalId);
    return;
  }
  if (!goal.embedding) return;

  const userId = goal.owner_id;
  if (!userId) return;

  const { data: u } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
  const user: any = u || {};

  const ageCategory = computeAgeCategory(user.age);
  const currentLocation: string = user.locality || goal.matching_metadata?.locality || '';
  const nationality: string = user.nationality || '';
  const languages: string[] = user.languages || (user.preferred_language ? [user.preferred_language] : []);

  const now = nowIso();
  let lastLoggedInAt: string = user.last_logged_in_at || '';
  if (opts.stampNow || !lastLoggedInAt) {
    lastLoggedInAt = now;
    await supabaseAdmin
      .from('users')
      .update({ last_logged_in_at: lastLoggedInAt })
      .eq('id', userId);
  }

  const activityStatus = isActiveUser(lastLoggedInAt) ? 'active' : 'inactive';

  await supabaseAdmin.from('goals_unassigned_index').upsert({
    goal_id: goalId,
    user_id: userId,
    embedding: goal.embedding,
    age_category: ageCategory,
    current_location: currentLocation,
    nationality,
    languages,
    categories: goal.category ? [goal.category] : [],
    last_logged_in_at: lastLoggedInAt,
    activity_status: activityStatus,
    updated_at: now,
  });
}

export async function removeGoalFromUnassignedIndex(goalId: string): Promise<void> {
  await supabaseAdmin.from('goals_unassigned_index').delete().eq('goal_id', goalId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core matching: find or create group (legacy full-scan path, kept for fallback)
// ─────────────────────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD_EXISTING = 0.78;
const SIMILARITY_THRESHOLD_NEW = 0.72;
const GROUP_SCAN_CAP = 500;
const GOAL_SCAN_CAP = 1000;

export async function findOrCreateGroupForGoal(goalId: string) {
  const { data: goalRow } = await supabaseAdmin
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (!goalRow) return null;
  const goal = goalRow as GoalRow;

  if (!goal.embedding || goal.group_id) return null;

  const goalIsPrivate = isPrivateGoal(goal);

  // Use pgvector RPC for group matching
  const { data: groupMatches } = await supabaseAdmin.rpc('match_group_index', {
    query_embedding: goal.embedding,
    match_threshold: SIMILARITY_THRESHOLD_EXISTING,
    match_count: 1,
    exclude_user_id: goal.owner_id,
  });

  if (groupMatches && groupMatches.length > 0) {
    const best = groupMatches[0];
    const joinedAt = nowIso();

    // Fetch current group data for transaction-like update
    const { data: gData } = await supabaseAdmin
      .from('groups')
      .select('*')
      .eq('id', best.group_id)
      .single();

    if (!gData) return null;

    const members: any[] = gData.members || [];
    const memberIds: string[] = gData.member_ids || [];
    const alreadyMember = members.some((m: any) => m.goalId === goalId);

    // Update goal
    await supabaseAdmin.from('goals').update({
      group_id: best.group_id,
      group_joined: true,
      joined_at: joinedAt,
      eligible_at: joinedAt,
    }).eq('id', goalId);

    if (!alreadyMember) {
      const newMembers = [...members, { goalId, userId: goal.owner_id, joinedAt }];
      const newMemberIds = memberIds.includes(goal.owner_id!)
        ? memberIds
        : [...memberIds, goal.owner_id!];
      await supabaseAdmin.from('groups').update({
        members: newMembers,
        member_ids: newMemberIds,
        member_count: newMemberIds.length,
        eligible_goal_ids: [...(gData.eligible_goal_ids || []), goalId],
      }).eq('id', best.group_id);
    }

    await Promise.all([
      removeGoalFromUnassignedIndex(goalId).catch(console.error),
      upsertGroupIndex(best.group_id).catch(console.error),
    ]);

    return { action: 'assigned', groupId: best.group_id, groupName: gData.derived_goal_theme };
  }

  // Find ungrouped goals to form a new group
  const { data: unassignedMatches } = await supabaseAdmin.rpc('match_unassigned_goals', {
    query_embedding: goal.embedding,
    match_threshold: SIMILARITY_THRESHOLD_NEW,
    match_count: 5,
    exclude_goal_id: goalId,
    exclude_user_id: goal.owner_id,
  });

  if (unassignedMatches && unassignedMatches.length >= 1) {
    const clusterGoalIds = [goalId, ...unassignedMatches.map((m: any) => m.goal_id)];

    const { data: clusterRows } = await supabaseAdmin
      .from('goals')
      .select('id, title, description, owner_id')
      .in('id', clusterGoalIds);

    const clusterGoals = clusterRows || [];
    const groupName = await generateGroupName(
      clusterGoals.map((g: any) => ({ title: g.title, description: g.description }))
    );

    const joinedAt = nowIso();
    const initialMemberIds = uniqueStrings(clusterGoals.map((g: any) => g.owner_id));

    const { data: newGroup } = await supabaseAdmin
      .from('groups')
      .insert({
        derived_goal_theme: groupName,
        representative_embedding: goal.embedding,
        locality_center: goal.matching_metadata?.locality || 'Global',
        max_members: 70,
        members: clusterGoals.map((g: any) => ({ goalId: g.id, userId: g.owner_id, joinedAt })),
        member_ids: initialMemberIds,
        eligible_goal_ids: clusterGoalIds,
        member_count: initialMemberIds.length,
        matching_criteria: {
          category: goal.category,
          privacy: goalIsPrivate ? 'private' : 'public',
        },
        created_at: joinedAt,
      })
      .select('id')
      .single();

    if (!newGroup) throw new Error('Failed to create group');

    // Update all cluster goals to point to new group
    await supabaseAdmin
      .from('goals')
      .update({ group_id: newGroup.id, group_joined: true, joined_at: joinedAt, eligible_at: joinedAt })
      .in('id', clusterGoalIds);

    // Remove from unassigned index
    await supabaseAdmin.from('goals_unassigned_index').delete().in('goal_id', clusterGoalIds);

    upsertGroupIndex(newGroup.id).catch(console.error);

    return { action: 'create', groupId: newGroup.id, groupName };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexed matching (replaces Firestore-based runIndexedMatching)
// ─────────────────────────────────────────────────────────────────────────────

const IDX_COSINE_EXISTING = 0.78;
const IDX_COSINE_NEW_GROUP = 0.90;

export type IndexedMatchResult =
  | { action: 'assigned-existing'; groupId: string }
  | { action: 'created-new-group'; groupId: string }
  | { action: 'placed-unassigned'; activityStatus: 'active' | 'inactive' };

export async function runIndexedMatching(goalId: string): Promise<IndexedMatchResult> {
  const { data: goalRow } = await supabaseAdmin
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .single();

  if (!goalRow) throw new Error(`Goal ${goalId} not found`);
  const goal = goalRow as GoalRow;

  if (goal.group_id) {
    upsertGroupIndex(goal.group_id).catch(console.error);
    await removeGoalFromUnassignedIndex(goalId);
    return { action: 'assigned-existing', groupId: goal.group_id };
  }

  if (!goal.embedding) {
    await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
    return { action: 'placed-unassigned', activityStatus: 'active' };
  }

  const userId = goal.owner_id || '';

  // Step 1: match existing groups via pgvector
  const { data: groupMatches } = await supabaseAdmin.rpc('match_group_index', {
    query_embedding: goal.embedding,
    match_threshold: IDX_COSINE_EXISTING,
    match_count: 1,
    exclude_user_id: userId,
  });

  if (groupMatches && groupMatches.length > 0) {
    const best = groupMatches[0];
    const joinedAt = nowIso();

    const { data: gData } = await supabaseAdmin.from('groups').select('*').eq('id', best.group_id).single();
    if (!gData) throw new Error('Group not found');

    const members: any[] = gData.members || [];
    const memberIds: string[] = gData.member_ids || [];
    const alreadyMember = members.some((m: any) => m.goalId === goalId);

    await supabaseAdmin.from('goals').update({
      group_id: best.group_id,
      group_joined: true,
      joined_at: joinedAt,
      eligible_at: joinedAt,
    }).eq('id', goalId);

    if (!alreadyMember) {
      const newMembers = [...members, { goalId, userId, joinedAt }];
      const newMemberIds = memberIds.includes(userId) ? memberIds : [...memberIds, userId];
      await supabaseAdmin.from('groups').update({
        members: newMembers,
        member_ids: newMemberIds,
        member_count: newMemberIds.length,
        eligible_goal_ids: [...(gData.eligible_goal_ids || []), goalId],
      }).eq('id', best.group_id);
    }

    await removeGoalFromUnassignedIndex(goalId);
    upsertGroupIndex(best.group_id).catch(console.error);
    return { action: 'assigned-existing', groupId: best.group_id };
  }

  // Step 2: match active unassigned goals via pgvector
  const { data: unassignedMatches } = await supabaseAdmin.rpc('match_unassigned_goals', {
    query_embedding: goal.embedding,
    match_threshold: IDX_COSINE_NEW_GROUP,
    match_count: 5,
    exclude_goal_id: goalId,
    exclude_user_id: userId,
  });

  if (unassignedMatches && unassignedMatches.length >= 1) {
    const clusterUserIds = uniqueStrings([userId, ...unassignedMatches.map((m: any) => m.user_id)]);
    if (clusterUserIds.length < 2) {
      await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
      return { action: 'placed-unassigned', activityStatus: 'active' };
    }

    const clusterGoalIds = [goalId, ...unassignedMatches.map((m: any) => m.goal_id)];
    const { data: clusterRows } = await supabaseAdmin
      .from('goals')
      .select('id, title, description, owner_id')
      .in('id', clusterGoalIds);

    const clusterGoals = (clusterRows || []).filter((g: any) => g);
    const groupName = await generateGroupName(
      clusterGoals.map((g: any) => ({ title: g.title, description: g.description }))
    );

    const joinedAt = nowIso();
    const initialMemberIds = uniqueStrings(clusterGoals.map((g: any) => g.owner_id));

    const { data: newGroup } = await supabaseAdmin
      .from('groups')
      .insert({
        derived_goal_theme: groupName,
        representative_embedding: goal.embedding,
        locality_center: goal.matching_metadata?.locality || 'Global',
        max_members: 70,
        members: clusterGoals.map((g: any) => ({ goalId: g.id, userId: g.owner_id, joinedAt })),
        member_ids: initialMemberIds,
        eligible_goal_ids: clusterGoalIds,
        member_count: initialMemberIds.length,
        matching_criteria: { category: goal.category, privacy: isPrivateGoal(goal) ? 'private' : 'public' },
        created_at: joinedAt,
      })
      .select('id')
      .single();

    if (!newGroup) throw new Error('Failed to create group');

    await supabaseAdmin
      .from('goals')
      .update({ group_id: newGroup.id, group_joined: true, joined_at: joinedAt, eligible_at: joinedAt })
      .in('id', clusterGoalIds);

    await supabaseAdmin.from('goals_unassigned_index').delete().in('goal_id', clusterGoalIds);

    upsertGroupIndex(newGroup.id).catch(console.error);
    return { action: 'created-new-group', groupId: newGroup.id };
  }

  // Step 3: no match — place in unassigned index
  await upsertGoalToUnassignedIndex(goalId, { stampNow: true });
  return { action: 'placed-unassigned', activityStatus: 'active' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute and store similar goals (uses pgvector RPC)
// ─────────────────────────────────────────────────────────────────────────────

export async function computeAndStoreSimilarGoals(
  goalId: string,
  embedding: number[],
  ownerId: string,
) {
  const { data: matches } = await supabaseAdmin.rpc('match_similar_goals', {
    query_embedding: embedding,
    match_threshold: 0.7,
    match_count: 5,
    exclude_goal_id: goalId,
    exclude_owner_id: ownerId,
  });

  const similarGoals = (matches || []).map((m: any) => ({
    goalId: m.id,
    userId: m.owner_id,
    goalTitle: m.title,
    similarityScore: m.similarity,
    groupId: m.group_id,
    description: m.description,
  }));

  await supabaseAdmin.from('goals').update({
    similar_goals: similarGoals,
    similarity_computed_at: nowIso(),
  }).eq('id', goalId);

  // Attempt auto-group assignment if not already grouped
  const { data: currentGoal } = await supabaseAdmin
    .from('goals')
    .select('group_id')
    .eq('id', goalId)
    .single();

  if (currentGoal && !currentGoal.group_id) {
    await findOrCreateGroupForGoal(goalId);
  }

  return similarGoals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: reconcile all goals
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcileAllGoals() {
  const { data: goals } = await supabaseAdmin.from('goals').select('*');

  for (const goal of (goals || [])) {
    let normalized = goal.normalized_matching_text;
    if (!normalized) {
      normalized = await normalizeGoal({
        title: goal.title || 'Untitled Goal',
        description: goal.description || '',
        category: goal.category || 'other',
        tags: goal.tags || [],
        timeHorizon: goal.time_horizon || 'unknown',
        privacy: goal.visibility || 'public',
        sourceText: '',
      }, { age: null, locality: null });
      await supabaseAdmin.from('goals').update({ normalized_matching_text: normalized }).eq('id', goal.id);
    }

    let embedding = goal.embedding;
    if (!embedding && normalized) {
      embedding = await generateEmbedding(normalized);
      await supabaseAdmin.from('goals').update({
        embedding,
        embedding_updated_at: nowIso(),
      }).eq('id', goal.id);
    }

    if (embedding) {
      await computeAndStoreSimilarGoals(goal.id, embedding, goal.owner_id || '');
    }

    if (embedding && !goal.group_id) {
      await findOrCreateGroupForGoal(goal.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: backfill index
// ─────────────────────────────────────────────────────────────────────────────

const BACKFILL_FLAG = 'backfillIndexV1';

export async function backfillIndexIfNeeded(): Promise<{ ran: boolean; goals: number; groups: number }> {
  const { data: flagDoc } = await supabaseAdmin
    .from('admin_flags')
    .select('completed')
    .eq('id', BACKFILL_FLAG)
    .single();

  if (flagDoc?.completed) return { ran: false, goals: 0, groups: 0 };

  let goalCount = 0;
  let groupCount = 0;

  const { data: groups } = await supabaseAdmin.from('groups').select('id');
  for (const g of (groups || [])) {
    try { await upsertGroupIndex(g.id); groupCount++; } catch (e) { console.error(e); }
  }

  const { data: goalsWithEmbedding } = await supabaseAdmin
    .from('goals')
    .select('id')
    .is('group_id', null)
    .not('embedding', 'is', null);

  for (const g of (goalsWithEmbedding || [])) {
    try { await upsertGoalToUnassignedIndex(g.id); goalCount++; } catch (e) { console.error(e); }
  }

  await supabaseAdmin.from('admin_flags').upsert({
    id: BACKFILL_FLAG,
    completed: true,
    completed_at: nowIso(),
    stats: { goals: goalCount, groups: groupCount },
  });

  return { ran: true, goals: goalCount, groups: groupCount };
}

export async function backfillMissingLastLoggedIn(): Promise<{ fixed: number }> {
  const { data: rows } = await supabaseAdmin
    .from('goals_unassigned_index')
    .select('goal_id, user_id')
    .is('last_logged_in_at', null);

  if (!rows || rows.length === 0) return { fixed: 0 };

  const now = nowIso();
  for (const row of rows) {
    await supabaseAdmin.from('goals_unassigned_index').update({
      last_logged_in_at: now,
      activity_status: 'active',
      updated_at: now,
    }).eq('goal_id', row.goal_id);

    if (row.user_id) {
      await supabaseAdmin.from('users').upsert({ id: row.user_id, last_logged_in_at: now });
    }
  }

  return { fixed: rows.length };
}

export { BACKFILL_FLAG };
