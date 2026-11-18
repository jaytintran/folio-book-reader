import {useCallback, useEffect, useState} from 'react';
import type {BookVoiceOverride, NarratorTone, VoicePreferences} from '../types/library';

const VOICE_PREFS_STORAGE_KEY = 'folio_voice_preferences_v1';

export const NARRATOR_TONES: Array<{
  id: NarratorTone;
  label: string;
  description: string;
}> = [
  {id: 'calm', label: 'Calm', description: 'Warm, relaxed pitch & cadence'},
  {id: 'storyteller', label: 'Storyteller', description: 'Livelier, expressive delivery'},
  {id: 'crisp', label: 'Crisp', description: 'Clear, neutral articulation'},
];

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  deviceVoiceUri: null,
  tone: 'calm',
  rate: 1.0,
  skipNoise: true,
  tapToRead: true,
  perBookOverrides: {},
};

function clampRate(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 1.0;
  return Math.min(2.5, Math.max(0.7, Math.round(val * 20) / 20));
}

function sanitizeTone(val: unknown): NarratorTone {
  return val === 'storyteller' || val === 'crisp' ? val : 'calm';
}

function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<VoicePreferences>;
    const rawOverrides = parsed.perBookOverrides ?? {};
    const sanitizedOverrides: Record<string, BookVoiceOverride> = {};
    for (const [id, entry] of Object.entries(rawOverrides)) {
      if (entry && typeof entry === 'object') {
        sanitizedOverrides[id] = {
          deviceVoiceUri: typeof entry.deviceVoiceUri === 'string' ? entry.deviceVoiceUri : null,
          tone: sanitizeTone(entry.tone),
          rate: clampRate(entry.rate),
        };
      }
    }
    return {
      deviceVoiceUri: typeof parsed.deviceVoiceUri === 'string' ? parsed.deviceVoiceUri : null,
      tone: sanitizeTone(parsed.tone),
      rate: clampRate(parsed.rate),
      skipNoise: typeof parsed.skipNoise === 'boolean' ? parsed.skipNoise : true,
      tapToRead: typeof parsed.tapToRead === 'boolean' ? parsed.tapToRead : true,
      perBookOverrides: sanitizedOverrides,
    };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function useVoicePreferences(bookId: string) {
  const [voicePrefs, setVoicePrefs] = useState<VoicePreferences>(loadVoicePreferences);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(voicePrefs));
    } catch {
      // Ignore storage quota issues
    }
  }, [voicePrefs]);

  const bookOverride = voicePrefs.perBookOverrides[bookId];
  const hasBookOverride = Boolean(bookOverride);

  const effectiveSettings: BookVoiceOverride & {
    skipNoise: boolean;
    tapToRead: boolean;
  } = {
    deviceVoiceUri:
      bookOverride !== undefined ? bookOverride.deviceVoiceUri : voicePrefs.deviceVoiceUri,
    tone: bookOverride?.tone ?? voicePrefs.tone,
    rate: clampRate(bookOverride?.rate ?? voicePrefs.rate),
    skipNoise: voicePrefs.skipNoise,
    tapToRead: voicePrefs.tapToRead,
  };

  // Updates both the book's remembered voice/tone/speed and global defaults
  const updateBookVoice = useCallback(
    (patch: Partial<BookVoiceOverride>) => {
      setVoicePrefs((prev) => {
        const currentBook = prev.perBookOverrides[bookId] ?? {
          deviceVoiceUri: prev.deviceVoiceUri,
          tone: prev.tone,
          rate: prev.rate,
        };
        const nextBook: BookVoiceOverride = {
          ...currentBook,
          ...patch,
          rate: clampRate(patch.rate ?? currentBook.rate),
        };
        return {
          ...prev,
          ...patch,
          rate: clampRate(patch.rate ?? prev.rate),
          perBookOverrides: {
            ...prev.perBookOverrides,
            [bookId]: nextBook,
          },
        };
      });
    },
    [bookId]
  );

  const updateGlobalVoiceOption = useCallback(
    (patch: {skipNoise?: boolean; tapToRead?: boolean}) => {
      setVoicePrefs((prev) => ({
        ...prev,
        ...patch,
      }));
    },
    []
  );

  const clearBookOverride = useCallback(() => {
    setVoicePrefs((prev) => {
      const next = {...prev.perBookOverrides};
      delete next[bookId];
      return {...prev, perBookOverrides: next};
    });
  }, [bookId]);

  return {
    voicePrefs,
    effectiveSettings,
    hasBookOverride,
    updateBookVoice,
    updateGlobalVoiceOption,
    clearBookOverride,
  };
}
