import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { cors } from '../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  try {
    const { error } = await supabaseAdmin.from('admin_flags').select('id').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', supabase: 'connected' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', supabase: 'error', details: e.message });
  }
}
