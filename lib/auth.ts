import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './supabaseAdmin.js';
import { getAdminEmailOrNull } from './env.js';

export interface AuthedRequest extends VercelRequest {
  userId: string;
  userEmail: string | undefined;
}

export function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ userId: string; userEmail: string | undefined } | null> {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return null;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
    return null;
  }

  return { userId: data.user.id, userEmail: data.user.email };
}

export async function isAdmin(userId: string, userEmail?: string): Promise<boolean> {
  const adminEmail = getAdminEmailOrNull();
  if (!adminEmail) return false;

  if (userEmail?.toLowerCase() === adminEmail) return true;

  const { data } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  return data?.role === 'admin';
}

export const nowIso = () => new Date().toISOString();
