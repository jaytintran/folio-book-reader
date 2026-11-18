import {useCallback, useEffect, useRef, useState} from 'react';
import type {NarrationSentence} from '../lib/narrationText';
import type {BookVoiceOverride, NarratorTone, SleepTimerMode} from '../types/library';

export type NarrationStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

interface UseAudiobookNarratorOptions {
  bookId: string;
  unitIndex: number;
  sentences: NarrationSentence[];
  settings: BookVoiceOverride & {skipNoise: boolean; tapToRead: boolean};
  onAdvanceUnit: (dir: 'prev' | 'next') => boolean;
  onNotify: (title: string, tone?: 'info' | 'success' | 'error') => void;
}

const PREVIEW_SAMPLE_BY_TONE: Record<NarratorTone, string> = {
  calm: 'The afternoon light drifted quietly across the open pages as the story began.',
  storyteller: 'At the edge of the lantern light, a door clicked open—and everything changed.',
  crisp: 'Clear pacing and crisp articulation keep every detail effortless to follow.',
};

function getPitchForTone(tone: NarratorTone): number {
  if (tone === 'calm') return 0.94;
  if (tone === 'storyteller') return 1.06;
  return 1.0;
}

export function useAudiobookNarrator({
  bookId,
  unitIndex,
  sentences,
  settings,
  onAdvanceUnit,
  onNotify,
}: UseAudiobookNarratorOptions) {
  const [status, setStatus] = useState<NarrationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number>(0);
  const [activeWordIndex, setActiveWordIndex] = useState<number>(-1);
  const [sleepTimerMode, setSleepTimerMode] = useState<SleepTimerMode>('off');
  const [sleepSecondsLeft, setSleepSecondsLeft] = useState<number | null>(null);
  const [previewingVoiceUri, setPreviewingVoiceUri] = useState<string | null>(null);

  // Refs to avoid stale closures across SpeechSynthesis callbacks
  const sentencesRef = useRef<NarrationSentence[]>(sentences);
  sentencesRef.current = sentences;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const sleepModeRef = useRef<SleepTimerMode>(sleepTimerMode);
  sleepModeRef.current = sleepTimerMode;

  const activeSentenceRef = useRef<number>(activeSentenceIndex);
  activeSentenceRef.current = activeSentenceIndex;

  const statusRef = useRef<NarrationStatus>(status);
  statusRef.current = status;

  const sessionIdRef = useRef<number>(0);
  const deviceFallbackTimerRef = useRef<number | null>(null);
  const pendingAutoResumeRef = useRef<'start' | 'end' | null>(null);

  // Load offline device SpeechSynthesis voices reactively
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) {
        const sorted = [...list].sort((a, b) => {
          // Prefer offline local voices first, then English, then alphabetical
          const aLocal = a.localService ? 0 : 1;
          const bLocal = b.localService ? 0 : 1;
          if (aLocal !== bLocal) return aLocal - bLocal;
          const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
          const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
          if (aEn !== bEn) return aEn - bEn;
          return a.name.localeCompare(b.name);
        });
        setDeviceVoices(sorted);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
    };
  }, []);

  const clearSyncTimers = useCallback(() => {
    if (deviceFallbackTimerRef.current !== null) {
      window.clearInterval(deviceFallbackTimerRef.current);
      deviceFallbackTimerRef.current = null;
    }
  }, []);

  const stopUnderlyingSpeech = useCallback(() => {
    clearSyncTimers();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }, [clearSyncTimers]);

  const stopPreview = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (statusRef.current !== 'playing') {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    }
    setPreviewingVoiceUri(null);
  }, []);

  // Stop speech cleanly on unmount
  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      stopUnderlyingSpeech();
      stopPreview();
    };
  }, [stopUnderlyingSpeech, stopPreview]);

  // Stop playback when switching books
  useEffect(() => {
    sessionIdRef.current += 1;
    pendingAutoResumeRef.current = null;
    stopUnderlyingSpeech();
    setStatus('idle');
    setActiveSentenceIndex(0);
    setActiveWordIndex(-1);
    setErrorMessage(null);
  }, [bookId, stopUnderlyingSpeech]);

  // Compute active word index from 0..1 progress weighted by word pronunciation weights
  const resolveWeightedWordIndex = (sentence: NarrationSentence, ratio: number): number => {
    const words = sentence.words;
    if (words.length === 0) return -1;
    const clamped = Math.min(0.9999, Math.max(0, ratio));
    const totalWeight = words.reduce((acc, w) => acc + w.weight, 0) || 1;
    const targetWeight = clamped * totalWeight;
    let acc = 0;
    for (let i = 0; i < words.length; i++) {
      acc += words[i].weight;
      if (acc >= targetWeight) return i;
    }
    return words.length - 1;
  };

  const speakSentenceAtRef = useRef<(index: number) => void>(() => {});

  const handleSentenceCompleted = useCallback(
    (completedIndex: number, session: number) => {
      if (session !== sessionIdRef.current) return;
      const list = sentencesRef.current;
      if (completedIndex + 1 < list.length) {
        speakSentenceAtRef.current(completedIndex + 1);
        return;
      }

      // End of current chapter / PDF page
      if (sleepModeRef.current === 'chapter') {
        clearSyncTimers();
        setStatus('paused');
        setActiveWordIndex(-1);
        setSleepTimerMode('off');
        setSleepSecondsLeft(null);
        onNotify('Sleep timer paused at end of chapter', 'info');
        return;
      }

      const advanced = onAdvanceUnit('next');
      if (advanced) {
        pendingAutoResumeRef.current = 'start';
        setStatus('buffering');
        setActiveWordIndex(-1);
      } else {
        clearSyncTimers();
        setStatus('idle');
        setActiveWordIndex(-1);
        onNotify('Finished reading book', 'success');
      }
    },
    [clearSyncTimers, onAdvanceUnit, onNotify]
  );

  const speakSentenceAt = useCallback(
    (index: number) => {
      const list = sentencesRef.current;
      if (list.length === 0) {
        setStatus('idle');
        return;
      }
      const safeIndex = Math.min(list.length - 1, Math.max(0, index));
      const sentence = list[safeIndex];
      const currSettings = settingsRef.current;

      sessionIdRef.current += 1;
      const session = sessionIdRef.current;
      stopPreview();
      stopUnderlyingSpeech();

      setErrorMessage(null);
      setActiveSentenceIndex(safeIndex);
      setActiveWordIndex(0);

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setStatus('error');
        setErrorMessage('This browser does not support offline device speech synthesis.');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(sentence.spokenText);
      utterance.rate = currSettings.rate;
      utterance.pitch = getPitchForTone(currSettings.tone);

      const availableVoices = window.speechSynthesis.getVoices();
      if (currSettings.deviceVoiceUri) {
        const match = availableVoices.find((v) => v.voiceURI === currSettings.deviceVoiceUri);
        if (match) utterance.voice = match;
      } else if (availableVoices.length > 0) {
        const preferredDefault =
          availableVoices.find((v) => v.default && v.localService) ??
          availableVoices.find((v) => v.localService && v.lang.toLowerCase().startsWith('en')) ??
          availableVoices.find((v) => v.default) ??
          availableVoices[0];
        if (preferredDefault) utterance.voice = preferredDefault;
      }

      let receivedBoundary = false;
      const startTime = performance.now();
      const estMs = (sentence.estimatedSec / Math.max(0.5, currSettings.rate)) * 1000;

      // Map utterance charIndex to sentence word index
      utterance.onboundary = (event) => {
        if (session !== sessionIdRef.current) return;
        if (event.name === 'word' || event.charIndex >= 0) {
          receivedBoundary = true;
          const charIdx = event.charIndex;
          const spokenRatio = Math.min(
            0.999,
            Math.max(0, charIdx / Math.max(1, sentence.spokenText.length))
          );
          let wordIdx = sentence.words.findIndex(
            (w) => charIdx >= w.startInSentence && charIdx <= w.endInSentence + 1
          );
          if (wordIdx === -1) {
            wordIdx = resolveWeightedWordIndex(sentence, spokenRatio);
          }
          setActiveWordIndex(wordIdx);
        }
      };

      utterance.onstart = () => {
        if (session !== sessionIdRef.current) return;
        setStatus('playing');
      };

      utterance.onend = () => {
        if (session !== sessionIdRef.current) return;
        clearSyncTimers();
        handleSentenceCompleted(safeIndex, session);
      };

      utterance.onerror = (e) => {
        if (session !== sessionIdRef.current) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return;
        clearSyncTimers();
        setStatus('error');
        setErrorMessage('Offline device voice could not speak this sentence.');
      };

      setStatus('playing');
      window.speechSynthesis.speak(utterance);

      // Smooth cadence fallback if the device voice omits onboundary events
      deviceFallbackTimerRef.current = window.setInterval(() => {
        if (session !== sessionIdRef.current) return;
        if (receivedBoundary) return;
        const elapsed = performance.now() - startTime;
        if (elapsed < 280) return;
        const ratio = Math.min(0.98, elapsed / Math.max(600, estMs));
        const nextWord = resolveWeightedWordIndex(sentence, ratio);
        setActiveWordIndex((prev) => (prev === nextWord ? prev : nextWord));
      }, 90);
    },
    [clearSyncTimers, handleSentenceCompleted, stopPreview, stopUnderlyingSpeech]
  );

  speakSentenceAtRef.current = speakSentenceAt;

  // Auto-resume cleanly when a new chapter / PDF page delivers its sentences after auto-advance
  useEffect(() => {
    const mode = pendingAutoResumeRef.current;
    if (!mode || sentences.length === 0) return;
    pendingAutoResumeRef.current = null;
    const targetIdx = mode === 'end' ? sentences.length - 1 : 0;
    speakSentenceAt(targetIdx);
  }, [unitIndex, sentences, speakSentenceAt]);

  // Restart current sentence smoothly when rate, voice, or tone changes during active playback
  useEffect(() => {
    if (statusRef.current === 'playing' || statusRef.current === 'buffering') {
      speakSentenceAt(activeSentenceRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rate, settings.deviceVoiceUri, settings.tone]);

  // Sleep Timer countdown
  useEffect(() => {
    if (sleepTimerMode === 'off' || sleepTimerMode === 'chapter') {
      setSleepSecondsLeft(null);
      return;
    }

    const totalSec =
      sleepTimerMode === '15m' ? 15 * 60 : sleepTimerMode === '30m' ? 30 * 60 : 45 * 60;
    setSleepSecondsLeft(totalSec);

    const interval = window.setInterval(() => {
      if (statusRef.current !== 'playing') return;
      setSleepSecondsLeft((prev) => {
        if (prev === null) return null;
        const next = prev - 1;
        if (next <= 0) {
          sessionIdRef.current += 1;
          stopUnderlyingSpeech();
          setStatus('paused');
          setSleepTimerMode('off');
          onNotify('Sleep timer finished — playback paused', 'info');
          return null;
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [sleepTimerMode, stopUnderlyingSpeech, onNotify]);

  // Public transport methods
  const playFrom = useCallback(
    (sentenceIndex?: number) => {
      const target = sentenceIndex !== undefined ? sentenceIndex : activeSentenceRef.current;
      speakSentenceAt(target);
    },
    [speakSentenceAt]
  );

  const pause = useCallback(() => {
    sessionIdRef.current += 1;
    stopUnderlyingSpeech();
    setStatus('paused');
  }, [stopUnderlyingSpeech]);

  const resume = useCallback(() => {
    speakSentenceAt(activeSentenceRef.current);
  }, [speakSentenceAt]);

  const togglePlay = useCallback(
    (fallbackStartSentence = 0) => {
      if (statusRef.current === 'playing' || statusRef.current === 'buffering') {
        pause();
      } else if (statusRef.current === 'paused') {
        resume();
      } else {
        playFrom(fallbackStartSentence);
      }
    },
    [pause, resume, playFrom]
  );

  const stop = useCallback(() => {
    sessionIdRef.current += 1;
    pendingAutoResumeRef.current = null;
    stopUnderlyingSpeech();
    stopPreview();
    setStatus('idle');
    setActiveWordIndex(-1);
    setErrorMessage(null);
  }, [stopUnderlyingSpeech, stopPreview]);

  const stepSentence = useCallback(
    (delta: -1 | 1) => {
      const list = sentencesRef.current;
      if (list.length === 0) return;
      const next = activeSentenceRef.current + delta;
      if (next >= 0 && next < list.length) {
        if (statusRef.current === 'playing' || statusRef.current === 'buffering') {
          speakSentenceAt(next);
        } else {
          setActiveSentenceIndex(next);
          setActiveWordIndex(0);
        }
      } else if (delta === 1) {
        const moved = onAdvanceUnit('next');
        if (moved && (statusRef.current === 'playing' || statusRef.current === 'buffering')) {
          pendingAutoResumeRef.current = 'start';
          setStatus('buffering');
        }
      } else if (delta === -1) {
        const moved = onAdvanceUnit('prev');
        if (moved && (statusRef.current === 'playing' || statusRef.current === 'buffering')) {
          pendingAutoResumeRef.current = 'end';
          setStatus('buffering');
        }
      }
    },
    [onAdvanceUnit, speakSentenceAt]
  );

  const skipSeconds = useCallback(
    (deltaSec: number) => {
      const list = sentencesRef.current;
      if (list.length === 0) return;
      const rate = Math.max(0.7, settingsRef.current.rate);
      const isActive = statusRef.current === 'playing' || statusRef.current === 'buffering';

      let remaining = Math.abs(deltaSec) * rate;
      let idx = activeSentenceRef.current;
      const dir = deltaSec > 0 ? 1 : -1;

      while (remaining > 0) {
        const nextIdx = idx + dir;
        if (nextIdx < 0 || nextIdx >= list.length) {
          const moved = onAdvanceUnit(dir > 0 ? 'next' : 'prev');
          if (moved && isActive) {
            pendingAutoResumeRef.current = dir > 0 ? 'start' : 'end';
            setStatus('buffering');
            return;
          }
          break;
        }
        idx = nextIdx;
        remaining -= list[idx].estimatedSec;
      }

      if (isActive) {
        speakSentenceAt(idx);
      } else {
        setActiveSentenceIndex(idx);
        setActiveWordIndex(0);
      }
    },
    [onAdvanceUnit, speakSentenceAt]
  );

  // Live offline voice sample preview inside the Voice Picker
  const previewVoice = useCallback(
    (voiceUri: string, tone: NarratorTone, rate: number) => {
      if (previewingVoiceUri === voiceUri) {
        stopPreview();
        return;
      }

      if (statusRef.current === 'playing' || statusRef.current === 'buffering') {
        pause();
      }
      stopPreview();

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }

      setPreviewingVoiceUri(voiceUri);
      const sampleText = PREVIEW_SAMPLE_BY_TONE[tone] ?? PREVIEW_SAMPLE_BY_TONE.calm;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(sampleText);
      u.rate = rate;
      u.pitch = getPitchForTone(tone);
      const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceUri);
      if (match) u.voice = match;
      u.onend = () => setPreviewingVoiceUri((curr) => (curr === voiceUri ? null : curr));
      u.onerror = () => setPreviewingVoiceUri((curr) => (curr === voiceUri ? null : curr));
      window.speechSynthesis.speak(u);
    },
    [previewingVoiceUri, pause, stopPreview]
  );

  // Resolve display name of the currently active offline device voice
  const activeVoiceName = (() => {
    if (deviceVoices.length === 0) return 'Device Voice';
    if (settings.deviceVoiceUri) {
      const matched = deviceVoices.find((v) => v.voiceURI === settings.deviceVoiceUri);
      if (matched) return matched.name;
    }
    const def =
      deviceVoices.find((v) => v.default && v.localService) ??
      deviceVoices.find((v) => v.default) ??
      deviceVoices[0];
    return def?.name ?? 'Device Voice';
  })();

  return {
    status,
    errorMessage,
    deviceVoices,
    activeVoiceName,
    activeSentenceIndex,
    activeWordIndex,
    sleepTimerMode,
    sleepSecondsLeft,
    previewingVoiceUri,
    playFrom,
    pause,
    resume,
    togglePlay,
    stop,
    stepSentence,
    skipSeconds,
    setSleepTimerMode,
    previewVoice,
    stopPreview,
    setActiveSentenceIndex,
  };
}
