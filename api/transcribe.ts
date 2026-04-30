import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { transcribeAudio } from '../server/gemini.js';
import { z } from 'zod';

const TranscribeSchema = z.object({
  audioBase64: z.string().min(1).max(50 * 1024 * 1024),
  mimeType: z.string().min(1).max(100),
});

const ALLOWED_AUDIO_MIME = new Set<string>([
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav',
  'audio/x-wav', 'audio/mp3', 'audio/aac', 'audio/flac', 'audio/m4a',
  'audio/x-m4a', 'video/webm',
]);

function detectAudioFormat(b64: string): string | null {
  let header: Buffer;
  try { header = Buffer.from(b64.slice(0, 64), 'base64'); } catch { return null; }
  if (header.length < 8) return null;
  const [b0, b1, b2, b3] = [header[0], header[1], header[2], header[3]];
  if (b0 === 0x1A && b1 === 0x45 && b2 === 0xDF && b3 === 0xA3) return 'webm';
  if (b0 === 0x4F && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return 'ogg';
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'wav';
  if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return 'mp3';
  if (b0 === 0xFF && (b1 & 0xE0) === 0xE0) return 'mp3';
  if (b0 === 0x66 && b1 === 0x4C && b2 === 0x61 && b3 === 0x43) return 'flac';
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return 'mp4';
  return null;
}

function validateAudioMime(mimeType: string, b64: string): { ok: boolean; reason?: string } {
  if (!mimeType) return { ok: false, reason: 'Missing MIME type' };
  const m = mimeType.toLowerCase().split(';')[0].trim();
  if (!ALLOWED_AUDIO_MIME.has(m)) return { ok: false, reason: `Unsupported MIME: ${mimeType}` };
  const detected = detectAudioFormat(b64);
  if (!detected) return { ok: false, reason: 'Could not recognise audio content' };
  const compatible =
    (detected === 'webm' && m.includes('webm')) ||
    (detected === 'ogg'  && m.includes('ogg')) ||
    (detected === 'wav'  && (m.includes('wav') || m.includes('x-wav'))) ||
    (detected === 'mp3'  && (m.includes('mp3') || m.includes('mpeg'))) ||
    (detected === 'flac' && m.includes('flac')) ||
    (detected === 'mp4'  && (m.includes('mp4') || m.includes('m4a') || m.includes('aac')));
  if (!compatible) return { ok: false, reason: `Declared MIME (${mimeType}) does not match content (${detected})` };
  return { ok: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (!(await checkRateLimit(auth.userId))) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  const v = TranscribeSchema.safeParse(req.body);
  if (!v.success) return res.status(400).json({ error: 'Invalid payload', details: v.error.format() });

  const { audioBase64, mimeType } = v.data;
  const mimeCheck = validateAudioMime(mimeType, audioBase64);
  if (!mimeCheck.ok) return res.status(415).json({ error: mimeCheck.reason });

  try {
    const transcript = await transcribeAudio(audioBase64, mimeType);
    res.json({ transcript });
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to transcribe audio', details: e.message });
  }
}
