import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv } from './env.js';

const supabaseUrl = getRequiredEnv('SUPABASE_URL');
const supabaseServiceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
