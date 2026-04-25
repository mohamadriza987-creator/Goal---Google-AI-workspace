import { createContext, useContext } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { User } from '../types';

interface UserContextValue {
  user: FirebaseUser | null;
  dbUser: User | null;
}

export const UserContext = createContext<UserContextValue>({ user: null, dbUser: null });

export function useUserContext() {
  return useContext(UserContext);
}
