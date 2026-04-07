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

export async function generateGoalFromTranscript(transcript: string, idToken: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log('Calling backend to generate goal from transcript...', { transcript: transcript.substring(0, 50) + '...', userContext });
  const response = await fetch("/api/generate-goal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({ transcript, userContext }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error('Goal generation error:', errorData);
    throw new Error(errorData.error || "Failed to generate goal from transcript");
  }

  const result = await response.json().catch(() => ({}));
  return result as StructuredGoal;
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

export async function structureGoalFromAudio(audioBase64: string, mimeType: string, idToken: string, userContext?: UserContext): Promise<StructuredGoal> {
  console.log('Calling backend to process audio...', { mimeType, size: audioBase64.length, userContext });
  const response = await fetch("/api/process-audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({ audioBase64, mimeType, userContext }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error('Backend error:', errorData);
    throw new Error(errorData.error || "Failed to process audio with Panda");
  }

  const result = await response.json().catch(() => ({}));
  console.log('Backend result received:', result);
  return result as StructuredGoal;
}
