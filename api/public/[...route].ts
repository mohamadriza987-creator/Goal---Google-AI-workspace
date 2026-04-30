import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  return res.status(404).json({ error: 'No public routes configured' });
}
