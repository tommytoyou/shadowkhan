'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import HowToPlayDialog from '../components/HowToPlayDialog';
import { BTN_FOCUS, BTN_PRIMARY, BTN_SECONDARY, EYEBROW } from '../lib/ui';

/** 32 unambiguous characters — no 0/o or 1/l, since these ids get read aloud
 *  and retyped. 256 is a whole multiple of 32, so the modulo below is unbiased. */
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_LENGTH = 7;

function makeMatchID(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

/** Accepts a bare match id or a full invite URL. A pasted link carries its own
 *  seat, so honour it — someone pasting their own seat-0 link is rejoining, not
 *  taking the other chair. */
function parseJoinInput(raw: string): { match: string; player: string } | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    const url = new URL(text, window.location.origin);
    const match = url.searchParams.get('match');
    if (match) {
      return { match, player: url.searchParams.get('player') === '0' ? '0' : '1' };
    }
  } catch {
    // Not a URL — fall through and treat the input as a bare id.
  }

  // A bare id must not smuggle in query or path separators.
  if (/[\s/?#&=]/.test(text)) return null;
  return { match: text, player: '1' };
}

const seatURL = (player: string, match: string) =>
  `/play?player=${player}&match=${encodeURIComponent(match)}`;

export default function Home() {
  const router = useRouter();
  const [matchID, setMatchID] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Built from the live origin so the same code produces a working link on
  // localhost and on the deployed domain.
  const inviteURL = matchID ? `${window.location.origin}${seatURL('1', matchID)}` : '';

  function handleCreate() {
    setMatchID(makeMatchID());
    setCopied(false);
    setCopyFailed(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteURL);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseJoinInput(joinInput);
    if (!parsed) {
      setJoinError('Enter a match id or paste an invite link.');
      return;
    }
    setJoinError(null);
    router.push(seatURL(parsed.player, parsed.match));
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="font-[family-name:var(--font-heading)] text-6xl tracking-wide text-white">
          Shadow&apos;Khan
        </h1>
        <span className="mt-4 block h-1 w-24 bg-sk-red" aria-hidden="true" />

        <p className="mt-6 text-sm text-sk-slate">
          A two-player online card game. Drain your opponent&apos;s deck until they have nothing
          left to draw.
        </p>

        <section className="mt-10" aria-labelledby="start-heading">
          <h2 id="start-heading" className={EYEBROW}>
            Start a game
          </h2>

          <button type="button" onClick={handleCreate} className={`${BTN_PRIMARY} mt-2`}>
            {matchID ? 'Create a different match' : 'Create match'}
          </button>

          {matchID && (
            <div className="mt-5 rounded-lg border border-sk-slate/40 px-4 py-4">
              <p className="text-sm text-white">
                Send this link to your opponent. They join as Player 2.
              </p>

              <label htmlFor="invite-url" className={`${EYEBROW} mt-3 block`}>
                Invite link
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  id="invite-url"
                  readOnly
                  value={inviteURL}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`min-w-0 flex-1 rounded border border-sk-slate/40 bg-black px-2 py-1.5 text-xs text-white ${BTN_FOCUS}`}
                />
                <button type="button" onClick={handleCopy} className={BTN_SECONDARY}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p aria-live="polite" className="mt-2 text-xs text-sk-slate">
                {copied ? 'Invite link copied to your clipboard.' : ''}
                {copyFailed ? 'Copy failed — select the link above and copy it manually.' : ''}
              </p>

              <a href={seatURL('0', matchID)} className={`${BTN_PRIMARY} mt-3 inline-block`}>
                Enter match as Player 1
              </a>
            </div>
          )}
        </section>

        <section className="mt-10" aria-labelledby="join-heading">
          <h2 id="join-heading" className={EYEBROW}>
            Or join one
          </h2>
          <form onSubmit={handleJoin} className="mt-2">
            <label htmlFor="join-input" className="block text-sm text-sk-slate">
              Paste an invite link, or type a match id.
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="join-input"
                value={joinInput}
                onChange={(e) => {
                  setJoinInput(e.target.value);
                  setJoinError(null);
                }}
                aria-invalid={joinError !== null}
                aria-describedby={joinError ? 'join-error' : undefined}
                placeholder="k7dqm2p"
                className={`min-w-0 flex-1 rounded border border-sk-slate bg-black px-2 py-1.5 text-sm text-white placeholder:text-sk-slate/60 ${BTN_FOCUS}`}
              />
              <button type="submit" className={BTN_SECONDARY}>
                Join
              </button>
            </div>
            <p id="join-error" aria-live="polite" className="mt-2 text-xs text-sk-slate">
              {joinError ?? ''}
            </p>
          </form>
        </section>

        <div className="mt-10">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className={`rounded border border-sk-slate/50 px-3 py-1.5 text-xs text-sk-slate transition hover:border-sk-slate hover:text-white ${BTN_FOCUS}`}
          >
            How to play
          </button>
        </div>
      </div>

      <HowToPlayDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
