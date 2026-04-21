import { useState, useRef, useCallback } from 'react';

export interface AudioRecorder {
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  cancelRecording: () => void;
  error: string | null;
}

export function useAudioRecorder(): AudioRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Determine supported mime type — webm preferred, mp4 for Safari fallback.
      let mimeType: string | undefined;
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else {
        // SAFARI polish: neither codec works — surface a clear error and bail
        // cleanly (release the mic) instead of letting MediaRecorder throw.
        stream.getTracks().forEach(track => track.stop());
        setError('Audio recording is not supported in this browser. Try Safari, Chrome, or Firefox.');
        setIsRecording(false);
        return;
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstart = () => {
        setIsRecording(true);
      };

      mediaRecorder.onerror = (e) => {
        setError('Recording error: ' + (e as any).error?.message || 'Unknown error');
        setIsRecording(false);
      };

      mediaRecorder.start();
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Could not access microphone. Please check permissions.');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType });
        
        // Stop all tracks in the stream
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
        
        mediaRecorderRef.current = null;
        setIsRecording(false);
        resolve(blob);
      };

      mediaRecorderRef.current.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null; // Prevent the onstop handler from firing
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
      setIsRecording(false);
      chunksRef.current = [];
    }
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    cancelRecording,
    error
  };
}
