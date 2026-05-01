import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = (req.url || '').split('?')[0];
  if (p.match(/\/api\/goals\/[^/]+\/tasks$/)) return (await import('../../server_legacy/goals/[goalId]/tasks')).default(req, res);
  if (p.match(/\/api\/goals\/[^/]+\/people-tasks$/)) return (await import('../../server_legacy/goals/[goalId]/people-tasks')).default(req, res);
  if (p.endsWith('/api/goals/precompute')) return (await import('../../server_legacy/goals/precompute')).default(req, res);
  if (p.endsWith('/api/goals/post-save')) return (await import('../../server_legacy/goals/post-save')).default(req, res);
  return (await import('../../server_legacy/goals/index-new')).default(req, res);
}
