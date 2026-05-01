import type { VercelRequest, VercelResponse } from '@vercel/node';
const routes: Record<string,string> = {
  '/backfill-index':'backfill-index','/reports':'reports','/bootstrap':'bootstrap','/index-data':'index-data','/gemini-model-order':'gemini-model-order','/hard-reset-groups':'hard-reset-groups','/index-status':'index-status','/reconcile':'reconcile','/force-rebuild-index':'force-rebuild-index','/gemini-model-stats':'gemini-model-stats'
};
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const p = ((req.url || '').split('?')[0]).replace('/api/admin','');
  const name = routes[p];
  if (!name) return res.status(404).json({error:'Unknown admin route'});
  return (await import(`../../server_legacy/admin/${name}`)).default(req,res);
}
