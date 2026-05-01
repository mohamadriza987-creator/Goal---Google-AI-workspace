import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  if (p.match(/\/api\/favourites\/[^/]+$/)) return (await import('../../server_legacy/favourites/[targetUserId]')).default(req, res);
  return (await import('../../server_legacy/favourites/index')).default(req, res);
}
