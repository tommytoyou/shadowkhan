'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type SfxCue = 'played' | 'drawn' | 'banished' | 'shuffled';

/** Exact on-disk filenames under client/public/audio/ — referenced
 *  root-relative the same way /card-back.png is. */
const CUE_SRC: Record<SfxCue, string> = {
  played: '/audio/card-played.wav',
  drawn: '/audio/card-drawn.wav',
  banished: '/audio/card-banished.wav',
  shuffled: '/audio/card-shuffled.wav',
};

/** Background music playlist, played in this order when shuffle is off. */
const MUSIC_TRACKS: readonly string[] = ['/audio/theme-1.mp3', '/audio/theme-2.mp3', '/audio/theme-3.mp3'];
const DEFAULT_VOLUME = 0.5;

/** Next track index. Sequential when shuffle is off; random but never the
 *  same track twice in a row when shuffle is on. */
function pickNextIndex(current: number, shuffleOn: boolean, count: number): number {
  if (!shuffleOn) return (current + 1) % count;
  if (count <= 1) return current;
  let next = current;
  while (next === current) next = Math.floor(Math.random() * count);
  return next;
}

type AudioContextValue = {
  play: (cue: SfxCue) => void;
  muted: boolean;
  toggleMuted: () => void;
  // Background music — entirely independent of the SFX mute above: neither
  // toggle touches the other's state or audio element.
  musicPlaying: boolean;
  toggleMusicPlaying: () => void;
  nextTrack: () => void;
  shuffle: boolean;
  toggleShuffle: () => void;
  volume: number;
  setVolume: (v: number) => void;
};

const AudioCtx = createContext<AudioContextValue | null>(null);

/** No-op fallback so a component rendered outside the provider (e.g. an
 *  isolated test) never throws — it just plays nothing. */
const FALLBACK: AudioContextValue = {
  play: () => {},
  muted: true,
  toggleMuted: () => {},
  musicPlaying: false,
  toggleMusicPlaying: () => {},
  nextTrack: () => {},
  shuffle: false,
  toggleShuffle: () => {},
  volume: DEFAULT_VOLUME,
  setVolume: () => {},
};

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

  // --- Background music -----------------------------------------------
  // A single persistent <audio> element (unlike the SFX pool, which clones
  // per play): music needs one continuous, seekable stream that survives
  // across track changes, not overlapping one-shot triggers.
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);

  // Refs mirroring the above so the stable (empty-dep) callbacks below always
  // read the current value instead of one captured at creation time.
  const trackIndexRef = useRef(trackIndex);
  trackIndexRef.current = trackIndex;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const musicPlayingRef = useRef(musicPlaying);
  musicPlayingRef.current = musicPlaying;

  // Same render-time lazy init as the SFX pool, for the same reason: no
  // useEffect delay before the element exists. Starts on track 0, at the
  // default volume, and — critically — never has .play() called on it here.
  // Autoplay before a user gesture is rejected by every browser; the element
  // just sits loaded and paused until the user presses Play.
  const musicElRef = useRef<HTMLAudioElement | null>(null);
  const musicInitedRef = useRef(false);
  if (!musicInitedRef.current && typeof window !== 'undefined') {
    musicInitedRef.current = true;
    const el = new Audio(MUSIC_TRACKS[0]);
    el.preload = 'auto';
    el.volume = DEFAULT_VOLUME;
    musicElRef.current = el;
  }

  /** Switches the element to a new track, minted via pickNextIndex, and
   *  either leaves it paused or continues playing — used by both the manual
   *  "next" button (continues only if music was already playing) and the
   *  "ended" listener (always continues, which is what makes playback loop
   *  across the whole playlist instead of stopping after one track). */
  const advanceTrack = useCallback((keepPlaying: boolean) => {
    const next = pickNextIndex(trackIndexRef.current, shuffleRef.current, MUSIC_TRACKS.length);
    trackIndexRef.current = next;
    setTrackIndex(next);
    const el = musicElRef.current;
    if (!el) return;
    el.src = MUSIC_TRACKS[next];
    if (keepPlaying) {
      // el.paused flips to false the instant play() is called, synchronously
      // — well before the returned promise settles (which waits for enough
      // data to actually start producing sound). Reflecting that immediately
      // keeps the UI responsive to a play request regardless of buffering
      // latency; the promise is only used to revert on genuine rejection.
      setMusicPlaying(true);
      void el.play().catch(() => setMusicPlaying(false));
    }
  }, []);

  // Advancing on "ended" is what turns "play one track" into "play the
  // playlist on loop" — the element itself never has .loop set, since a
  // native loop would just repeat the same track forever.
  useEffect(() => {
    const el = musicElRef.current;
    if (!el) return;
    const handleEnded = () => advanceTrack(true);
    el.addEventListener('ended', handleEnded);
    return () => el.removeEventListener('ended', handleEnded);
  }, [advanceTrack]);

  const toggleMusicPlaying = useCallback(() => {
    const el = musicElRef.current;
    if (!el) return;
    if (el.paused) {
      // Same reasoning as advanceTrack: reflect the play request immediately
      // rather than waiting on the promise, and only revert on rejection
      // (no gesture yet, or a transient decode issue) — no console noise
      // either way.
      setMusicPlaying(true);
      void el.play().catch(() => setMusicPlaying(false));
    } else {
      el.pause();
      setMusicPlaying(false);
    }
  }, []);

  const nextTrack = useCallback(() => {
    advanceTrack(musicPlayingRef.current);
  }, [advanceTrack]);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    if (musicElRef.current) musicElRef.current.volume = clamped;
  }, []);

  const value = useMemo<AudioContextValue>(
    () => ({
      play,
      muted,
      toggleMuted,
      musicPlaying,
      toggleMusicPlaying,
      nextTrack,
      shuffle,
      toggleShuffle,
      volume,
      setVolume,
    }),
    [play, muted, toggleMuted, musicPlaying, toggleMusicPlaying, nextTrack, shuffle, toggleShuffle, volume, setVolume],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

export function useAudio(): AudioContextValue {
  return useContext(AudioCtx) ?? FALLBACK;
}
