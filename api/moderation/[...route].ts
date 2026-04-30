import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  if (p.endsWith('/api/moderation/signal')) return (await import('../../api_legacy/moderation/signal')).default(req, res);
  return (await import('../../api_legacy/moderation/report')).default(req, res);
}
