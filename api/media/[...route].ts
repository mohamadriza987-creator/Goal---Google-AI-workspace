import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  const routeName = 'media';
  try {
    if (p.match(/\/api\/media\/open\/[^/]+$/)) return (await import('../../server_legacy/media/open/[mediaId]')).default(req, res);
    if (p.match(/\/api\/media\/?$/)) return (await import('../../server_legacy/media/upload')).default(req, res);
    return res.status(404).json({ error: 'Unknown route' });
  } catch {
    return res.status(500).json({ error: 'Internal server error', route: routeName });
  }
}
