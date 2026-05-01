import { createContext, useContext } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { User } from '../types';

interface UserContextValue {
  user: SupabaseUser | null;
  dbUser: User | null;
}

export const UserContext = createContext<UserContextValue>({ user: null, dbUser: null });

export function useUserContext() {
  return useContext(UserContext);
}
