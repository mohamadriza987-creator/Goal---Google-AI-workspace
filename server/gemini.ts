import { GoogleGenAI, Type } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.gemfree;
    
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      throw new Error("The 'gemfree' secret is missing or invalid. Please ensure it is configured in the Settings menu.");
    }
    
    console.log('Backend initializing Panda with "gemfree" secret path (prefix: ' + apiKey.substring(0, 4) + '...)');
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
  privacy: 'private' | 'group' | 'public';
  language: string;
}

export interface UserContext {
  age?: number;
  locality?: string;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
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
        let delay = initialDelay * Math.pow(2, i);
        
        // Try to extract retryDelay from the error message if it's a 429
        try {
          if (error.message?.includes("retryDelay")) {
            const match = error.message.match(/"retryDelay":\s*"(\d+)s"/);
            if (match && match[1]) {
              const apiDelay = parseInt(match[1], 10) * 1000;
              delay = Math.max(delay, apiDelay + 500); // Add a small buffer
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }

        console.log(`Panda is busy or rate limited. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
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
  
  if (!process.env.gemfree) {
    throw new Error("The 'gemfree' secret is not set in the environment");
  }

  const ai = getAI();

  const response = await withRetry(() => ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
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
  }));

  const text = response.text;
  if (!text) throw new Error("No transcription response from AI");
  return text.trim();
}

export async function generateGoalFromTranscript(transcript: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log(`Generating goal from transcript: "${transcript.substring(0, 50)}..."`);
  
  if (!process.env.gemfree) {
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
            text: `Analyze the following transcript and convert it into a structured goal. ${contextPrompt}
            
            Transcript: "${transcript}"`
          }
        ]
      },
      config: {
        systemInstruction: `You are a world-class life coach and productivity expert. 
        The user has spoken a personal goal or dream. Your job is to structure it into a clear, actionable plan.

        CRITICAL INSTRUCTIONS:
        1. Transcript: Use the provided transcript as the basis.
        2. Stay on subject: Do not drift off the user's actual subject. Do not invent facts or goals the user didn't mention.
        3. Strong Title: Generate a strong, short, and inspiring goal title (max 60 chars).
        4. Useful Description: Generate a concise and helpful description (max 200 chars).
        5. Practical Tasks: Generate 5-8 practical, non-generic suggested tasks. 
           - Tasks must be realistic first steps, not motivational fluff.
           - Avoid generic trash like "stay motivated", "work hard", or "believe in yourself".
           - Tasks should be specific (e.g., "Research 3 local photography courses" instead of "Learn photography").
           - Tasks should match the goal type and the user's likely situation (using age/locality context if provided).
        6. Language Consistency: The entire response (transcript, goalTitle, goalDescription, suggestedTasks, tags, timeHorizon) MUST be in the EXACT SAME LANGUAGE as the transcript.
        7. Strict JSON: Return ONLY a structured JSON object. Do not include any other text or markdown formatting.

        Structure:
        - transcript: The original transcript provided.
        - goalTitle: Short, clear, actionable title in the original language.
        - goalDescription: Concise summary in the original language.
        - suggestedTasks: A list of 5-8 specific, practical to-do items in the original language.
        - category: One of [health, finance, learning, business, personal, social, other].
        - tags: 3-5 relevant tags in the original language.
        - timeHorizon: Estimated duration (e.g., "1 week", "1 month") in the original language.
        - privacy: Default to 'private' unless the user implies otherwise.
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
              enum: ['private', 'group', 'public']
            },
            language: { type: Type.STRING }
          },
          required: ["transcript", "goalTitle", "goalDescription", "suggestedTasks", "category", "tags", "timeHorizon", "privacy", "language"]
        }
      }
    }));
  };

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
  return JSON.parse(text) as StructuredGoal;
}

export async function structureGoalFromAudio(audioBase64: string, mimeType: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log(`Processing audio: ${mimeType}, size: ${audioBase64.length}, prefix: ${audioBase64.substring(0, 50)}...`);
  
  if (!process.env.gemfree) {
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
        6. Language Consistency: The entire response (transcript, goalTitle, goalDescription, suggestedTasks, tags, timeHorizon) MUST be in the EXACT SAME LANGUAGE as the audio input.
        7. Strict JSON: Return ONLY a structured JSON object. Do not include any other text or markdown formatting.

        Structure:
        - transcript: The accurate transcription of the audio in the original language.
        - goalTitle: Short, clear, actionable title in the original language.
        - goalDescription: Concise summary in the original language.
        - suggestedTasks: A list of 5-8 specific, practical to-do items in the original language.
        - category: One of [health, finance, learning, business, personal, social, other].
        - tags: 3-5 relevant tags in the original language.
        - timeHorizon: Estimated duration (e.g., "1 week", "1 month") in the original language.
        - privacy: Default to 'private' unless the user implies otherwise.
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
              enum: ['private', 'group', 'public']
            },
            language: { type: Type.STRING }
          },
          required: ["transcript", "goalTitle", "goalDescription", "suggestedTasks", "category", "tags", "timeHorizon", "privacy", "language"]
        }
      }
    }));
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
    return JSON.parse(text) as StructuredGoal;
  } catch (error: any) {
    console.error("Panda API Error:", error);
    
    if (error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("API quota exceeded. Please try again later or check your billing plan.");
    }
    
    throw error;
  }
}
