import type { VercelRequest, VercelResponse } from '@vercel/node';
const map: Record<string,string> = {'/health':'health','/silence':'silence','/poke':'poke','/debug/inspect-goals':'debug/inspect-goals'};
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = ((req.url || '').split('?')[0]).replace('/api/system','');
  const file = map[p];
  if (!file) return res.status(404).json({error:'Unknown system route'});
  return (await import(`../../server_legacy/${file}`)).default(req,res);
}
