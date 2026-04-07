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

export interface StructuredGoal {
  transcript: string;
  goalTitle: string;
  goalDescription: string;
  suggestedTasks: string[];
  category: string;
  tags: string[];
  timeHorizon: string;
  privacy: 'private' | 'public';
  language: string;
  normalizedMatchingText: string;
}

export interface UserContext {
  age?: number;
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

export async function generateGoalFromTranscript(transcript: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log(`Generating goal from transcript: "${transcript.substring(0, 50)}..."`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' or 'GEMINI_API_KEY' secret is not set in the environment");
  }

  const ai = getAI();

  const contextPrompt = userContext ? `
  User Context:
  - Age: ${userContext.age || 'Not provided'}
  - Locality: ${userContext.locality || 'Not provided'}
  Use this context to make suggested tasks more relevant and practical for the user's specific situation.
  ` : '';

  const generateWithModel = async (modelName: string) => {
    return await withRetry(() => ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            text: `Analyze the following transcript and convert it into a structured goal. ${contextPrompt}
            
            Transcript: "${transcript}"`
          }
        ]
      },
      config: {
        systemInstruction: `You are a world-class life coach and productivity expert. 
        The user has provided a personal goal or dream. Your job is to structure it into a clear, actionable plan.

        CRITICAL INSTRUCTIONS:
        1. Transcript: Use the provided transcript as the basis. If the user has provided multiple refinements or added details, use the full combined context.
        2. Stay on subject: Do not drift off the user's actual subject. Do not invent facts or goals the user didn't mention.
        3. Strong Title: Generate a strong, short, and inspiring goal title (max 60 chars).
        4. Useful Description: Generate a concise and helpful description (max 200 chars).
        5. Practical Tasks: Generate exactly 5-8 practical, non-generic suggested tasks. 
           - PRIORITY ORDER: Tasks MUST be ordered from most important/foundational (first) to least urgent/later-stage (last).
           - Tasks must be realistic first steps, not motivational fluff.
           - Avoid generic trash like "stay motivated", "work hard", or "believe in yourself".
           - Tasks should be specific (e.g., "Research 3 local photography courses" instead of "Learn photography").
           - Tasks should match the goal type and the user's likely situation (using age/locality context if provided).
        6. Language Consistency: The entire response (transcript, goalTitle, goalDescription, suggestedTasks, tags, timeHorizon, normalizedMatchingText) MUST be in the EXACT SAME LANGUAGE as the transcript.
        7. Normalized Matching Text: Create one clean, comma-separated string for backend matching. 
           - Format: "Goal: [intent], [category], [sub-focus], [time horizon], [skill level if relevant], [locality if provided], [age if relevant], [privacy]"
           - Remove filler words. Keep only core meaning.
           - Do not invent facts. If age/locality aren't in the provided context, ignore them.
        8. Strict JSON: Return ONLY a structured JSON object. Do not include any other text or markdown formatting.

        Structure:
        - transcript: The original transcript provided.
        - goalTitle: Short, clear, actionable title in the original language.
        - goalDescription: Concise summary in the original language.
        - suggestedTasks: A list of 5-8 specific, practical to-do items in the original language, ordered by priority.
        - category: One of [health, finance, learning, business, personal, social, other].
        - tags: 3-5 relevant tags in the original language.
        - timeHorizon: Estimated duration (e.g., "1 week", "1 month") in the original language.
        - privacy: Default to 'public' unless the user explicitly wants it private.
        - language: Detect the language of the input (e.g., "English", "Spanish", "Hindi").`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcript: { type: Type.STRING },
            goalTitle: { type: Type.STRING },
            goalDescription: { type: Type.STRING },
            suggestedTasks: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            category: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            timeHorizon: { type: Type.STRING },
            privacy: { 
              type: Type.STRING,
              enum: ['private', 'public']
            },
            language: { type: Type.STRING },
            normalizedMatchingText: { type: Type.STRING }
          },
          required: ["transcript", "goalTitle", "goalDescription", "suggestedTasks", "category", "tags", "timeHorizon", "privacy", "language", "normalizedMatchingText"]
        }
      }
    }), 2, 1000); // Reduce retries for goal generation
  };

  let response;
  const models = ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"];
  let lastError: any;

  for (const model of models) {
    try {
      console.log(`Attempting goal generation with model: ${model}`);
      response = await generateWithModel(model);
      if (response) break;
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      if (isQuotaError) {
        console.warn(`${model} quota exceeded. Falling back...`);
        continue;
      } else {
        throw error;
      }
    }
  }

  if (!response) throw lastError;

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  try {
    const cleaned = cleanJson(text);
    return JSON.parse(cleaned) as StructuredGoal;
  } catch (parseError) {
    console.error("Failed to parse AI response as JSON:", text);
    throw new Error("AI returned an invalid response format. Please try again.");
  }
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

export async function structureGoalFromAudio(audioBase64: string, mimeType: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log(`Processing audio: ${mimeType}, size: ${audioBase64.length}, prefix: ${audioBase64.substring(0, 50)}...`);
  
  if (!process.env.gemfree && !process.env.GEMINI_API_KEY) {
    throw new Error("The 'gemfree' secret is not set in the environment");
  }

  const ai = getAI();

  const contextPrompt = userContext ? `
  User Context:
  - Age: ${userContext.age || 'Not provided'}
  - Locality: ${userContext.locality || 'Not provided'}
  Use this context to make suggested tasks more relevant and practical for the user's specific situation.
  ` : '';

  const generateWithModel = async (modelName: string) => {
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
            text: `Analyze the provided audio and convert it into a structured goal. ${contextPrompt}`
          }
        ]
      },
      config: {
        systemInstruction: `You are a world-class life coach and productivity expert. 
        The user is speaking one personal goal or dream. Your job is to transcribe it accurately and structure it into a clear, actionable plan.

        CRITICAL INSTRUCTIONS:
        1. Transcribe accurately: Capture exactly what the user said in the 'transcript' field.
        2. Stay on subject: Do not drift off the user's actual subject. Do not invent facts or goals the user didn't mention.
        3. Strong Title: Generate a strong, short, and inspiring goal title (max 60 chars).
        4. Useful Description: Generate a concise and helpful description (max 200 chars).
        5. Practical Tasks: Generate 5-8 practical, non-generic suggested tasks. 
           - Tasks must be realistic first steps, not motivational fluff.
           - Avoid generic trash like "stay motivated", "work hard", or "believe in yourself".
           - Tasks should be specific (e.g., "Research 3 local photography courses" instead of "Learn photography").
           - Tasks should match the goal type and the user's likely situation (using age/locality context if provided).
        6. Language Consistency: The entire response (transcript, goalTitle, goalDescription, suggestedTasks, tags, timeHorizon, normalizedMatchingText) MUST be in the EXACT SAME LANGUAGE as the audio input.
        7. Normalized Matching Text: Create one clean, comma-separated string for backend matching. 
           - Format: "Goal: [intent], [category], [sub-focus], [time horizon], [skill level if relevant], [locality if provided], [age if relevant], [privacy]"
           - Remove filler words. Keep only core meaning.
           - Do not invent facts. If age/locality aren't in the provided context, ignore them.
        8. Strict JSON: Return ONLY a structured JSON object. Do not include any other text or markdown formatting.

        Structure:
        - transcript: The accurate transcription of the audio in the original language.
        - goalTitle: Short, clear, actionable title in the original language.
        - goalDescription: Concise summary in the original language.
        - suggestedTasks: A list of 5-8 specific, practical to-do items in the original language.
        - category: One of [health, finance, learning, business, personal, social, other].
        - tags: 3-5 relevant tags in the original language.
        - timeHorizon: Estimated duration (e.g., "1 week", "1 month") in the original language.
        - privacy: Default to 'public' unless the user explicitly wants it private.
        - language: Detect the language of the input (e.g., "English", "Spanish", "Hindi").`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transcript: { type: Type.STRING },
            goalTitle: { type: Type.STRING },
            goalDescription: { type: Type.STRING },
            suggestedTasks: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            category: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            timeHorizon: { type: Type.STRING },
            privacy: { 
              type: Type.STRING,
              enum: ['private', 'public']
            },
            language: { type: Type.STRING },
            normalizedMatchingText: { type: Type.STRING }
          },
          required: ["transcript", "goalTitle", "goalDescription", "suggestedTasks", "category", "tags", "timeHorizon", "privacy", "language", "normalizedMatchingText"]
        }
      }
    }), 2, 1000); // Reduce retries for audio processing
  };

  try {
    let response;
    const models = ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"];
    let lastError: any;

    for (const model of models) {
      try {
        console.log(`Attempting with model: ${model}`);
        response = await generateWithModel(model);
        if (response) break;
      } catch (error: any) {
        lastError = error;
        const isQuotaError = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
        if (isQuotaError) {
          console.warn(`${model} quota exceeded. Falling back...`);
          continue;
        } else {
          throw error;
        }
      }
    }

    if (!response) throw lastError;

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    try {
      const cleaned = cleanJson(text);
      return JSON.parse(cleaned) as StructuredGoal;
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", text);
      throw new Error("AI returned an invalid response format. Please try again.");
    }
  } catch (error: any) {
    console.error("Panda API Error:", error);

    if (error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("API quota exceeded. Please try again later or check your billing plan.");
    }

    throw error;
  }
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
