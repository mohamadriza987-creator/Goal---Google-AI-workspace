import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  if (p.endsWith('/api/groups/join')) return (await import('../../server_legacy/groups/join')).default(req, res);
  if (p.endsWith('/api/groups/assign')) return (await import('../../server_legacy/groups/assign')).default(req, res);
  if (p.endsWith('/api/groups/joined')) return (await import('../../server_legacy/groups/joined')).default(req, res);
  return (await import('../../server_legacy/groups/[groupId]')).default(req, res);
}
