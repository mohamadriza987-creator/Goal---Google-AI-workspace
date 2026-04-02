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

export async function structureGoalFromAudio(audioBase64: string, mimeType: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log('Calling backend to process audio...', { mimeType, size: audioBase64.length, userContext });
  const response = await fetch("/api/process-audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audioBase64, mimeType, userContext }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error('Backend error:', errorData);
    throw new Error(errorData.error || "Failed to process audio with Panda");
  }

  const result = await response.json();
  console.log('Backend result received:', result);
  return result as StructuredGoal;
}
