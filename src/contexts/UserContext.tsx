import { createContext, useContext } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { User } from '../types';

// SupabaseUser mirrors the shape App.tsx previously used from Firebase:
//   .uid → .id
//   .displayName → via user_metadata.full_name
//   .photoURL → via user_metadata.avatar_url
//   .email
//   .getIdToken() → replaced by supabase.auth.getSession() in call sites

interface UserContextValue {
  user: SupabaseUser | null;
  dbUser: User | null;
}

export const UserContext = createContext<UserContextValue>({ user: null, dbUser: null });

export function useUserContext() {
  return useContext(UserContext);
}
