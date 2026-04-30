// Firebase replaced by Supabase. This file is kept as a re-export shim so
// imports in components continue to compile during the migration.
export { supabase as db, supabase as auth, supabase as storage } from './lib/supabase';
export { googleProvider } from './lib/authProviders';
