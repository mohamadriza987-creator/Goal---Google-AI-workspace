export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAdminEmailOrNull(): string | null {
  const raw = process.env.ADMIN_EMAIL;
  if (!raw || !raw.trim()) return null;
  return raw.trim().toLowerCase();
}

export function getGeminiApiKey(): string {
  const gemfree = process.env.gemfree;
  if (gemfree && gemfree.trim() && gemfree !== 'MY_GEMINI_API_KEY') return gemfree;
  const key = getRequiredEnv('GEMINI_API_KEY');
  if (key === 'MY_GEMINI_API_KEY') {
    throw new Error('Missing required environment variable: GEMINI_API_KEY');
  }
  return key;
}
