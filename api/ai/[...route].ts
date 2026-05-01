import type { VercelRequest, VercelResponse } from '@vercel/node';
const map: Record<string,string> = {
  '/generate-goal':'generate-goal','/generate-embedding':'generate-embedding','/transcribe':'transcribe','/normalize-goal':'normalize-goal','/ask-for-help':'ask-for-help'
};
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = ((req.url || '').split('?')[0]).replace('/api/ai','');
  const file = map[p];
  if (!file) return res.status(404).json({error:'Unknown AI route'});
  return (await import(`../../server_legacy/${file}`)).default(req,res);
}
