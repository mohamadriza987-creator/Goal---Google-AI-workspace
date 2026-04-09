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

export async function transcribeAudio(audioBase64: string, mimeType: string, idToken: string): Promise<string> {
  console.log('Calling backend to transcribe audio...', { mimeType, size: audioBase64.length });
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({ audioBase64, mimeType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error('Transcription error:', errorData);
    throw new Error(errorData.error || "Failed to transcribe audio");
  }

  const result = await response.json().catch(() => ({}));
  return result.transcript || "";
}

export async function generateGoal(
  input: { text: string } | { audioBase64: string; mimeType: string },
  idToken: string,
  userContext?: UserContext,
): Promise<StructuredGoal> {
  const body = "text" in input
    ? { text: input.text, userContext }
    : { audioBase64: input.audioBase64, mimeType: input.mimeType, userContext };

  const response = await fetch("/api/generate-goal", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || "Failed to generate goal");
  }

  return response.json();
}

export async function generateMicroSteps(taskText: string, idToken: string): Promise<string[]> {
  const response = await fetch("/api/tasks/micro-steps", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ taskText }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown" }));
    throw new Error(err.error || "Failed to generate micro-steps");
  }
  const result = await response.json();
  return result.steps ?? [];
}

