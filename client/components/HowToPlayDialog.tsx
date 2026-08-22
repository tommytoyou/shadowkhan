'use client';

import { useEffect, useRef } from 'react';
import { BTN_PRIMARY, EYEBROW } from '../lib/ui';

/** The single source of truth for the how-to-play copy — rendered from the
 *  board and from the homepage. Every claim in here is derived from the rules
 *  in game/: the deck-out loss in turn.onBegin, the attack guards in the
 *  attack moves, resolveBattleOutcome's BP comparison and its tie case, and
 *  discardOwnHandCard pushing face-up to the owner's own pile. */
export default function HowToPlayDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnToRef = useRef<HTMLElement | null>(null);

  // Remembering whatever was focused when this opened keeps focus restoration
  // self-contained, so callers do not have to hand down a trigger ref.
  useEffect(() => {
    if (!open) return;
    returnToRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => returnToRef.current?.focus();
  }, [open]);

  if (!open) return null;

  /** Escape closes; Tab cycles within the panel so focus cannot wander onto
   *  whatever is behind it. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const root = dialogRef.current;
    if (!root) return;
    const stops = root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (stops.length === 0) return;

    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/80 px-4 py-8 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-xl border-2 border-sk-slate bg-black px-7 py-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <h2
          id="help-title"
          className="font-[family-name:var(--font-heading)] text-3xl uppercase tracking-[0.15em] text-white"
        >
          How to play
        </h2>
        <span className="mt-4 block h-1 w-16 bg-sk-red" aria-hidden="true" />

        <section className="mt-7">
          <h3 className={EYEBROW}>The goal</h3>
          <p className="mt-1.5 text-sm text-white">
            Your deck is your life. You lose the moment one of your turns starts and your deck
            has no card left to draw — so win by stripping your opponent&apos;s deck before they
            strip yours.
          </p>
        </section>

        <section className="mt-6">
          <h3 className={EYEBROW}>Your turn</h3>
          {/* Numbered because the turn genuinely is a sequence. */}
          <ol className="mt-1.5 space-y-1 text-sm text-sk-slate">
            <li>
              <span className="text-white">1.</span> A card is drawn for you automatically at the
              start of every turn, including your first, whenever you hold fewer than 5 cards.
              There&apos;s no manual draw.
            </li>
            <li>
              <span className="text-white">2.</span> Play cards to your field and make up to one
              attack.
            </li>
            <li>
              <span className="text-white">3.</span> Click{' '}
              <span className="text-white">End turn</span>.
            </li>
          </ol>
        </section>

        <section className="mt-6">
          <h3 className={EYEBROW}>Playing a card</h3>
          <p className="mt-1.5 text-sm text-sk-slate">
            Click a card in your hand, then click one of your three empty field slots. You may
            play only one Battle Card per turn, unless a card effect allows more — Action and
            Power cards have no such limit.
          </p>
        </section>

        <section className="mt-6">
          <h3 className={EYEBROW}>Attacking</h3>
          <p className="mt-1.5 text-sm text-sk-slate">
            One attack per turn, and never on your first turn. Click one of your field cards, then
            pick a target:
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-sk-slate">
            <li>
              <span className="text-white">Their field card.</span> Higher BP wins and the
              loser&apos;s card is removed. On a tie, both players lose their top deck card
              face-down.
            </li>
            <li>
              <span className="text-white">Attack hand.</span> Hits a card in their hand at
              random. To aim at a position instead, click one of their face-down hand cards.
            </li>
            <li>
              <span className="text-white">Attack deck.</span> Hits the top card of their deck.
            </li>
          </ul>
        </section>

        <section className="mt-6">
          <h3 className={EYEBROW}>The other controls</h3>
          <dl className="mt-1.5 space-y-1.5 text-sm text-sk-slate">
            <div>
              <dt className="inline text-white">Bottom-up. </dt>
              <dd className="inline">
                Moves the bottom card of your deck to the top. Once per game, and only with 10 or
                fewer cards left.
              </dd>
            </div>
            <div>
              <dt className="inline text-white">Banish. </dt>
              <dd className="inline">
                Sends the selected hand card to your own banished pile, face up.
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6">
          <h3 className={EYEBROW}>Reading the board</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-sk-slate">
            <li>
              The number on a field card is its <span className="text-white">BP</span> — what
              battles are decided by.
            </li>
            <li>
              <span className="text-white">Banished</span> counts cards removed face up, so both
              players know them. <span className="text-white">Face-down</span> counts cards
              removed without being revealed — you only get the number.
            </li>
            <li>
              <span className="text-white">A, B, C and D</span> on a card are its printed
              abilities.
            </li>
          </ul>
        </section>

        <div className="mt-8 flex justify-end">
          <button type="button" onClick={onClose} className={BTN_PRIMARY}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
