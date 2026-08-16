'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type SfxCue = 'played' | 'drawn' | 'banished' | 'shuffled';

/** Exact on-disk filenames under client/public/audio/ — referenced
 *  root-relative the same way /card-back.png is. */
const CUE_SRC: Record<SfxCue, string> = {
  played: '/audio/card-played.wav',
  drawn: '/audio/card-drawn.wav',
  banished: '/audio/card-banished.wav',
  shuffled: '/audio/card-shuffled.wav',
};

type AudioContextValue = {
  play: (cue: SfxCue) => void;
  muted: boolean;
  toggleMuted: () => void;
};

const AudioCtx = createContext<AudioContextValue | null>(null);

/** No-op fallback so a component rendered outside the provider (e.g. an
 *  isolated test) never throws — it just plays nothing. */
const FALLBACK: AudioContextValue = { play: () => {}, muted: true, toggleMuted: () => {} };

/**
 * Mount once, above everything (see app/layout.tsx), so it is shared across
 * every route and every boardgame.io Client instance a route happens to
 * mount — playback state lives here, not per-Board.
 */
export default function AudioProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState(false);
  // A ref mirror of `muted` so `play` can stay referentially stable (empty
  // dep array) instead of being recreated — and effects that call it —
  // every time the mute state flips.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Deliberately populated during render (guarded to run exactly once), not
  // in a useEffect: React fires child effects before parent effects on
  // mount, and Board's own mount effect fires the "shuffled" cue for the
  // initial deck shuffle the instant it mounts. A useEffect here would still
  // be pending when that happens, and Board's cue would silently no-op.
  // Render-time lazy init (same idea as useState(() => ...)) guarantees the
  // pool exists before any descendant's effects run.
  const poolRef = useRef<Partial<Record<SfxCue, HTMLAudioElement>>>({});
  const preloadedRef = useRef(false);
  if (!preloadedRef.current && typeof window !== 'undefined') {
    preloadedRef.current = true;
    (Object.keys(CUE_SRC) as SfxCue[]).forEach((cue) => {
      const el = new Audio(CUE_SRC[cue]);
      el.preload = 'auto';
      poolRef.current[cue] = el;
    });
  }

  const play = useCallback((cue: SfxCue) => {
    if (mutedRef.current) return;
    const base = poolRef.current[cue];
    if (!base) return;
    // Clone rather than reuse the single preloaded node, so two triggers of
    // the same cue in quick succession (e.g. two cards played back to back)
    // both play in full instead of the second restarting/cutting off the
    // first. cloneNode(true) carries the already-resolved `src`, so this
    // does not re-fetch the file.
    const node = base.cloneNode(true) as HTMLAudioElement;
    // Browsers reject play() before the first user gesture (autoplay
    // policy) — that rejection is expected and must never surface as an
    // unhandled promise rejection or a console error.
    void node.play().catch(() => {});
  }, []);

  const toggleMuted = useCallback(() => setMuted((m) => !m), []);

  const value = useMemo<AudioContextValue>(
    () => ({ play, muted, toggleMuted }),
    [play, muted, toggleMuted],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

export function useAudio(): AudioContextValue {
  return useContext(AudioCtx) ?? FALLBACK;
}
