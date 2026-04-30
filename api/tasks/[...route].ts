import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  return (await import('../../api_legacy/tasks/micro-steps')).default(req, res);
}
