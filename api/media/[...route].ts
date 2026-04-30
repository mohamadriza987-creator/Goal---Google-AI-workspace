import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  if (p.includes('/api/media/open/')) return (await import('../../api_legacy/media/open/[mediaId]')).default(req, res);
  return (await import('../../api_legacy/media/upload')).default(req, res);
}
