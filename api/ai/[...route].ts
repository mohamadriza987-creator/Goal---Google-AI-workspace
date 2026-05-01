import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = ((req.url || '').split('?')[0]).replace('/api/ai', '');
  if (p === '/generate-goal')      return (await import('../../server_legacy/generate-goal')).default(req, res);
  if (p === '/generate-embedding') return (await import('../../server_legacy/generate-embedding')).default(req, res);
  if (p === '/transcribe')         return (await import('../../server_legacy/transcribe')).default(req, res);
  if (p === '/normalize-goal')     return (await import('../../server_legacy/normalize-goal')).default(req, res);
  if (p === '/ask-for-help')       return (await import('../../server_legacy/ask-for-help')).default(req, res);
  return res.status(404).json({ error: 'Unknown AI route' });
}
