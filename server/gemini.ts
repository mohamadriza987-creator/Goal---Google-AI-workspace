import { GoogleGenAI, Type } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.gemfree || process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      console.error("Gemini API key is missing. Checked 'gemfree' and 'GEMINI_API_KEY' environment variables.");
      throw new Error("Gemini API key is missing. Please ensure it is configured in the Settings menu as 'gemfree' or 'GEMINI_API_KEY'.");
    }
    
    const keySource = process.env.gemfree ? "gemfree" : "GEMINI_API_KEY";
    console.log(`Backend initializing Panda with "${keySource}" secret (prefix: ${apiKey.substring(0, 4)}...)`);
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export interface GoalTask {
  text: string;
  microSteps: string[];
}

export interface StructuredGoal {
  transcript: string;
  title: string;
  description: string;
  categories: string[];
  languages: string[];
  tasks: GoalTask[];
  tags: string[];
  timeHorizon: string;
  privacy: 'private' | 'public';
  normalizedMatchingText: string;
}

export interface UserContext {
  age?: number;
  nationality?: string;
  locality?: string;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 6, initialDelay = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable = error.message?.includes("503") || 
                          error.message?.includes("429") ||
                          error.message?.includes("high demand") ||
                          error.message?.includes("overloaded") ||
                          error.message?.includes("RESOURCE_EXHAUSTED");
      
      if (isRetryable && i < maxRetries - 1) {
        // Exponential backoff with jitter
        let delay = initialDelay * Math.pow(2.5, i) + Math.random() * 1500;
        
        // Try to extract retryDelay from the error message if it's a 429
        try {
          if (error.message?.includes("retryDelay")) {
            const match = error.message.match(/"retryDelay":\s*"(\d+)s"/);
            if (match && match[1]) {
              const apiDelay = parseInt(match[1], 10) * 1000;
              delay = Math.max(delay, apiDelay + 2000); // Add a buffer
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }

        console.log(`Panda is busy or rate limited. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  console.log(`Transcribing audio: ${mimeType}, size: ${audioBase64.length}`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' or 'GEMINI_API_KEY' secret is not set in the environment");
  }

  const ai = getAI();

  const transcribeWithModel = async (modelName: string) => {
    return await withRetry(() => ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioBase64,
            },
          },
          {
            text: "Transcribe the provided audio accurately. Return ONLY the transcription text in the original language. Do not add any commentary or formatting."
          }
        ]
      },
      config: {
        systemInstruction: "You are a fast and accurate transcription engine. Your only job is to convert audio to text in the original language spoken.",
      }
    }), 2, 1000); // Reduce retries and delay for transcription to avoid proxy timeouts
  };

  let response;
  const models = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
  let lastError: any;

  for (const model of models) {
    try {
      console.log(`Attempting transcription with model: ${model}`);
      response = await transcribeWithModel(model);
      if (response) break;
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      if (isQuotaError) {
        console.warn(`${model} transcription quota exceeded. Falling back...`);
        continue;
      } else {
        throw error;
      }
    }
  }

  if (!response) throw lastError;

  const text = response.text;
  if (!text) throw new Error("No transcription response from AI");
  return text.trim();
}

function cleanJson(text: string): string {
  // Remove markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

// ── Unified goal generation ───────────────────────────────────────────────────
// Accepts either typed text or raw audio. Primary: Flash-Lite. Fallback: Flash.

const GOAL_PRIMARY  = "gemini-2.5-flash-lite";
const GOAL_FALLBACK = "gemini-2.5-flash";

export const GOAL_CATEGORIES = [
  "Career & Jobs",
  "Professional Qualification & Certifications",
  "Education & Exams",
  "Language Learning",
  "Finance & Wealth",
  "Business & Entrepreneurship",
  "Health & Fitness",
  "Weight Loss & Body Transformation",
  "Mental Health & Emotional Wellbeing",
  "Habits & Self Discipline",
  "Productivity & Time Management",
  "Communication & Public Speaking",
  "Relationships & Dating",
  "Marriage & Family",
  "Parenting",
  "Spirituality & Religion",
  "Technology & Coding",
  "Creativity & Art",
  "Music & Performance",
  "Content Creation & Personal Branding",
  "Travel & Relocation",
  "Home & Lifestyle",
  "Sports & Athletic Training",
  "Community & Social Impact",
  "Hobbies & Leisure",
] as const;

export type GoalCategory = typeof GOAL_CATEGORIES[number];

const GOAL_TASK_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    text:       { type: Type.STRING },
    microSteps: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 3, maxItems: 5 },
  },
  required: ["text", "microSteps"],
};

const GOAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript:             { type: Type.STRING },
    title:                  { type: Type.STRING },
    description:            { type: Type.STRING },
    categories:             { type: Type.ARRAY, items: { type: Type.STRING, enum: GOAL_CATEGORIES as unknown as string[] }, minItems: 1 },
    languages:              { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 1 },
    tasks:                  { type: Type.ARRAY, items: GOAL_TASK_SCHEMA, minItems: 1 },
    tags:                   { type: Type.ARRAY, items: { type: Type.STRING } },
    timeHorizon:            { type: Type.STRING },
    privacy:                { type: Type.STRING, enum: ['private', 'public'] },
    normalizedMatchingText: { type: Type.STRING },
  },
  required: ["transcript", "title", "description", "categories", "languages", "tasks", "tags", "timeHorizon", "privacy", "normalizedMatchingText"],
};

const CATEGORIES_PROMPT = GOAL_CATEGORIES.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

function buildGoalSystemInstruction(userContext?: UserContext): string {
  const parts: string[] = [];
  if (userContext?.age)         parts.push(`age: ${userContext.age}`);
  if (userContext?.nationality)  parts.push(`nationality: ${userContext.nationality}`);
  const ctx = parts.length ? ` User: ${parts.join(", ")}.` : "";
  return `Goal generation.${ctx} Return ONE valid JSON object. No markdown, no code fences, no text outside JSON.

Fields:
- transcript: verbatim input or audio transcription
- title: clear specific goal title ≤60 chars
- description: short practical outcome ≤200 chars
- categories: all applicable from this fixed list (exact strings, ≥1, include every relevant one):
${CATEGORIES_PROMPT}
- languages: all relevant languages (≥1; language-learning goals include native + target)
- tasks: 5–8 ordered actionable steps, most impactful first, no vague filler. Each task: { text: actionable step, microSteps: 3–5 short concrete sub-actions 5–8 words each }
- tags: 3–5 lowercase keywords
- timeHorizon: realistic estimate
- privacy: "public" unless user says private
- normalizedMatchingText: "Goal: [intent], [categories], [sub-focus], [time horizon]"`;
}

/** Validate the parsed Gemini output against all required rules.
 *  Returns an array of error strings; empty array means valid. */
function validateGoalOutput(g: any): string[] {
  const errors: string[] = [];
  if (!g || typeof g !== "object")          { errors.push("output is not an object"); return errors; }
  if (!g.title || typeof g.title !== "string" || !g.title.trim())
                                             errors.push("title is missing or empty");
  if (!g.description || typeof g.description !== "string" || !g.description.trim())
                                             errors.push("description is missing or empty");
  if (!Array.isArray(g.categories) || g.categories.length === 0)
                                             errors.push("categories must be a non-empty array");
  else {
    const invalid = g.categories.filter((c: any) => !(GOAL_CATEGORIES as readonly string[]).includes(c));
    if (invalid.length > 0) errors.push(`categories contain invalid values: ${invalid.join(", ")}`);
  }
  if (!Array.isArray(g.languages) || g.languages.length === 0)
                                             errors.push("languages must be a non-empty array");
  if (!Array.isArray(g.tasks) || g.tasks.length === 0)
                                             errors.push("tasks must be a non-empty array");
  else {
    g.tasks.forEach((task: any, i: number) => {
      if (!task || typeof task !== "object")  { errors.push(`task[${i}] is not an object`); return; }
      if (!task.text || !task.text.trim())    errors.push(`task[${i}].text is missing or empty`);
      if (!Array.isArray(task.microSteps))    errors.push(`task[${i}].microSteps is not an array`);
      else if (task.microSteps.length < 3)    errors.push(`task[${i}].microSteps has ${task.microSteps.length} items — minimum 3 required`);
      else if (task.microSteps.length > 5)    errors.push(`task[${i}].microSteps has ${task.microSteps.length} items — maximum 5 allowed`);
    });
  }
  return errors;
}

export async function generateGoal(
  input: { text: string } | { audioBase64: string; mimeType: string },
  userContext?: UserContext,
): Promise<StructuredGoal> {
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not set");
  }

  const ai = getAI();

  const contentParts: object[] =
    "audioBase64" in input
      ? [
          { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
          { text: "Transcribe and structure this goal from the audio." },
        ]
      : [{ text: `Structure this goal: "${input.text}"` }];

  const call = (model: string) =>
    withRetry(
      () =>
        ai.models.generateContent({
          model,
          contents: { parts: contentParts },
          config: {
            systemInstruction: buildGoalSystemInstruction(userContext),
            responseMimeType: "application/json",
            responseSchema: GOAL_SCHEMA,
          },
        }),
      2,
      800,
    );

  /** Parse raw text → object and run validation. Returns the object if valid, null otherwise. */
  const parseAndValidate = (raw: string | null | undefined, label: string): StructuredGoal | null => {
    if (!raw) { console.warn(`[generateGoal] ${label} returned empty response`); return null; }
    let obj: any;
    try {
      obj = JSON.parse(cleanJson(raw));
    } catch {
      console.warn(`[generateGoal] ${label} returned invalid JSON`);
      return null;
    }
    const errors = validateGoalOutput(obj);
    if (errors.length > 0) {
      console.warn(`[generateGoal] ${label} failed validation: ${errors.join("; ")}`);
      return null;
    }
    return obj as StructuredGoal;
  };

  let parsed: StructuredGoal | null = null;

  // Try primary (Flash-Lite)
  try {
    console.log(`[generateGoal] primary: ${GOAL_PRIMARY}`);
    const res = await call(GOAL_PRIMARY);
    parsed = parseAndValidate(res.text, "primary");
  } catch (err: any) {
    console.warn(`[generateGoal] primary threw: ${err.message}`);
  }

  // Fallback (Flash) if primary failed, returned invalid JSON, or failed validation
  if (!parsed) {
    console.log(`[generateGoal] fallback: ${GOAL_FALLBACK}`);
    let res: any;
    try {
      res = await call(GOAL_FALLBACK);
    } catch (err: any) {
      throw new Error(`AI unavailable: ${err.message}`);
    }
    parsed = parseAndValidate(res?.text, "fallback");
    if (!parsed) throw new Error("AI returned an invalid response format. Please try again.");
  }

  // For typed input always preserve the original text as transcript
  if ("text" in input) parsed.transcript = input.text;

  return parsed;
}

export async function normalizeGoal(goalData: { title: string, description: string, category: string, tags: string[], timeHorizon: string, privacy: string, sourceText?: string }, userContext?: UserContext): Promise<string> {
  console.log(`Normalizing goal: "${goalData.title}"`);
  console.log(`User Context: ${JSON.stringify(userContext)}`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' secret is not set in the environment");
  }

  const ai = getAI();

  const contextPrompt = userContext ? `
  User Context:
  - Age: ${userContext.age || 'Not provided'}
  - Locality: ${userContext.locality || 'Not provided'}
  ` : '';

  const generateWithModel = async (modelName: string) => {
    return await withRetry(() => ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            text: `Create a normalized matching text for the following goal. 
            
            Goal Data:
            - Title: ${goalData.title}
            - Description: ${goalData.description}
            - Category: ${goalData.category}
            - Tags: ${goalData.tags.join(', ')}
            - Time Horizon: ${goalData.timeHorizon}
            - Privacy: ${goalData.privacy}
            ${goalData.sourceText ? `- Source Text: ${goalData.sourceText}` : ''}
            
            ${contextPrompt}
            
            Return ONLY a clean, comma-separated string for backend matching. 
            Format: "Goal: [intent], [category], [sub-focus], [time horizon], [skill level if relevant], [locality if provided], [age if relevant], [privacy]"
            Remove filler words. Keep only core meaning.
            Do not invent facts. If age/locality aren't in the provided context, ignore them.`
          }
        ]
      },
      config: {
        systemInstruction: "You are a data normalization engine. Your job is to extract the core meaning of a goal into a standardized format for similarity matching.",
      }
    }), 2, 1000); // Reduce retries for normalization
  };

  let response;
  const models = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-3.1-pro-preview"];
  let lastError: any;

  for (const model of models) {
    try {
      console.log(`Attempting normalization with model: ${model}`);
      response = await generateWithModel(model);
      if (response) break;
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      if (isQuotaError) {
        console.warn(`${model} normalization quota exceeded. Falling back...`);
        continue;
      } else {
        throw error;
      }
    }
  }

  if (!response) throw lastError;

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return text.trim();
}

export async function generateEmbedding(text: string): Promise<number[]> {
  console.log(`Generating embedding for text: "${text.substring(0, 50)}..."`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' secret is not set in the environment");
  }

  const ai = getAI();
  const result = await withRetry(() => ai.models.embedContent({
    model: 'gemini-embedding-2-preview',
    contents: [text],
  }));

  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error("No embeddings returned from AI");
  }

  return result.embeddings[0].values;
}

export async function generateGroupName(goals: { title: string, description: string }[]): Promise<string> {
  console.log(`Generating group name for ${goals.length} goals...`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' secret is not set in the environment");
  }

  const ai = getAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: {
      parts: [
        {
          text: `Create a highly specific, clean, and natural community name for a group of users with these similar goals:
          
          ${goals.map((g, i) => `${i+1}. ${g.title}: ${g.description}`).join('\n')}
          
          CRITICAL INSTRUCTIONS:
          1. Be Specific: The name must reflect the EXACT shared theme of these goals. 
          2. Avoid Generic Trash: Do NOT use generic category names like "Learning & Growth", "Personal Development", "General Goals", or "Global".
          3. Natural & Human: Use 2-4 words maximum. Make it sound like a real club or community.
          4. Examples: "Marathon Finishers", "React Developers", "Urban Gardeners", "Early Risers Club", "Budget Travelers".
          
          Return ONLY the name string.`
        }
      ]
    }
  }));

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return text.trim().replace(/["']/g, '');
}


export async function generateMicroSteps(taskText: string): Promise<string[]> {
  const ai = getAI();
  const models = ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];
  let lastError: any;

  for (const model of models) {
    try {
      const result = await withRetry(() => ai.models.generateContent({
        model,
        contents: `Break this task into 3 to 5 very short action steps. Each step must be 2 to 5 words. No bullets, no numbering, no explanation.
Task: "${taskText}"
Return ONLY a valid JSON array of strings. Example: ["Research online options","Pick one course","Sign up today","Complete first module"]`,
        config: { responseMimeType: 'application/json' },
      }), 2, 800);

      const text = result.text ?? '[]';
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.trim());
      } catch {
        // try to extract array from text
        const match = text.match(/\[[\s\S]*\]/);
        parsed = match ? JSON.parse(match[0]) : [];
      }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty');
      return (parsed as string[]).slice(0, 5).map((s: string) => String(s).trim());
    } catch (e: any) {
      lastError = e;
      if (e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) continue;
      throw e;
    }
  }
  throw lastError;
}
