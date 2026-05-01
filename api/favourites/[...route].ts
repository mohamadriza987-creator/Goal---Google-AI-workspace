import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  const routeName = 'favourites';
  try {
    if (p.match(/\/api\/favourites\/[^/]+$/)) return (await import('../../server_legacy/favourites/[targetUserId]')).default(req, res);
    if (p.match(/\/api\/favourites\/?$/)) return (await import('../../server_legacy/favourites/index')).default(req, res);
    return res.status(404).json({ error: 'Unknown route' });
  } catch {
    return res.status(500).json({ error: 'Internal server error', route: routeName });
  }
}
