import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface StructuredGoal {
  title: string;
  description: string;
  tasks: string[];
  category: string;
  language: string;
}

export async function structureGoal(transcript: string, previousGoal?: StructuredGoal): Promise<StructuredGoal> {
  const context = previousGoal 
    ? `Previous Goal Context:
       Title: ${previousGoal.title}
       Description: ${previousGoal.description}
       Existing Tasks: ${previousGoal.tasks.join(', ')}
       
       New Input to refine/add: ${transcript}`
    : transcript;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: context,
    config: {
      systemInstruction: `You are a world-class life coach and productivity expert. 
      Analyze the user's spoken intent and convert it into a highly actionable, specific goal structure.
      
      Guidelines for Tasks:
      - Make them concrete and measurable (e.g., "Research 3 local gyms" instead of "Look for gyms").
      - Ensure variety: Include preparation, execution, and review/maintenance steps.
      - Avoid generic fillers like "Get started" or "Stay consistent".
      - Break down complex actions into small, manageable steps (max 15 mins each).
      - Use strong action verbs (e.g., "Draft", "Calculate", "Schedule", "Install").
      - For learning goals, include specific resources or topics (e.g., "Complete the first 3 modules of the React course").
      - For fitness goals, include specific exercises or durations (e.g., "Run for 20 minutes at a moderate pace").
      - For business goals, include specific metrics or deliverables (e.g., "Send 10 cold emails to potential clients").
      
      Structure:
      - Title: Short, clear, actionable (max 60 chars).
      - Description: Concise, motivating summary (max 200 chars).
      - Tasks: A list of 5-8 specific to-do items.
      - Category: One of [health, finance, learning, business, personal, social, other].
      - Language: Detect the language of the input.
      
      Return the result as JSON.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          tasks: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          category: { type: Type.STRING },
          language: { type: Type.STRING }
        },
        required: ["title", "description", "tasks", "category", "language"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text) as StructuredGoal;
}
