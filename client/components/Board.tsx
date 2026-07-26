'use client';

import { useEffect, useRef, useState } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { ShadowkhanG, FieldCard, PendingChoice, PendingChoiceKind } from '@shadowkhan/game';
import { cardImageSrc } from '../lib/cardImage';
import CardBack from './CardBack';

type Props = BoardProps<ShadowkhanG>;

const OPP_HAND_CAP = 8;

/** One footprint for every field slot, empty or filled, so a removal never
 *  collapses the row and shifts its neighbours. Sizing only — the slot's own
 *  content fills it. */
const SLOT_BOX = 'aspect-[2.5/3.5] w-44 shrink-0';

const LOG_CAP = 50;
/** Kept in step with the .sk-slot-vanish animation in globals.css. */
const GHOST_MS = 300;

type Side = 'own' | 'opp';
const SIDES: readonly Side[] = ['own', 'opp'];
const WHO: Record<Side, string> = { own: 'You', opp: 'Opponent' };
const THEIR: Record<Side, string> = { own: 'your', opp: 'their' };
const other = (side: Side): Side => (side === 'own' ? 'opp' : 'own');
const plural = (n: number) => (n === 1 ? '' : 's');

/** Everything the log and the removal cue are derived from — all of it public
 *  state, so it reads the same on both clients. */
type Snapshot = {
  field: Record<Side, (string | null)[]>;
  banished: Record<Side, string[]>;
  faceDown: Record<Side, number>;
  deck: Record<Side, number>;
  hand: Record<Side, number>;
  turns: Record<Side, number>;
  loser: string | null;
};

type Vanished = { side: Side; slot: number; label: string };

function takeSnapshot(G: ShadowkhanG, pid: string, opp: string): Snapshot {
  const per = <T,>(read: (p: string) => T): Record<Side, T> => ({
    own: read(pid),
    opp: read(opp),
  });
  return {
    field: per((p) => (G.public.field[p] ?? [null, null, null]).map((c) => c?.label ?? null)),
    banished: per((p) => [...(G.public.banished[p] ?? [])]),
    faceDown: per((p) => G.public.banishedFaceDown[p] ?? 0),
    deck: per((p) => G.public.deckCounts[p] ?? 0),
    hand: per((p) => G.public.handCounts[p] ?? 0),
    turns: per((p) => G.public.turnsTaken[p] ?? 0),
    loser: G.public.loser ?? null,
  };
}

/** Banished piles are mostly append-only but some effects splice cards back
 *  out, so compare as multisets rather than trusting order or length. */
function multisetDiff(before: string[], after: string[]) {
  const counts = new Map<string, number>();
  for (const label of before) counts.set(label, (counts.get(label) ?? 0) + 1);
  const added: string[] = [];
  for (const label of after) {
    const n = counts.get(label) ?? 0;
    if (n > 0) counts.set(label, n - 1);
    else added.push(label);
  }
  const removed: string[] = [];
  for (const [label, n] of counts) for (let i = 0; i < n; i++) removed.push(label);
  return { added, removed };
}

function consume(pool: string[], label: string): boolean {
  const at = pool.indexOf(label);
  if (at === -1) return false;
  pool.splice(at, 1);
  return true;
}

/** Turns two snapshots into log lines plus the slots that need an exit cue.
 *  Every claim here is something public state actually supports; where it does
 *  not (why a card left, what a hand card was) the wording stays coarse. */
function diffSnapshots(
  prev: Snapshot,
  next: Snapshot,
  pid: string,
): { events: string[]; vanished: Vanished[] } {
  const events: string[] = [];
  const vanished: Vanished[] = [];

  const pile: Record<Side, ReturnType<typeof multisetDiff>> = {
    own: multisetDiff(prev.banished.own, next.banished.own),
    opp: multisetDiff(prev.banished.opp, next.banished.opp),
  };
  const faceDown: Record<Side, number> = {
    own: next.faceDown.own - prev.faceDown.own,
    opp: next.faceDown.opp - prev.faceDown.opp,
  };
  const arrivals: Record<Side, number> = { own: 0, opp: 0 };

  /** Where a card that just left the field ended up. Owner's pile first, then
   *  the opponent's (several effects banish into the attacker's pile). */
  function destination(label: string, side: Side): string {
    if (consume(pile[side].added, label)) return `banished to ${THEIR[side]} pile`;
    const away = other(side);
    if (consume(pile[away].added, label)) return `banished to ${THEIR[away]} pile`;
    if (faceDown[side] > 0) {
      faceDown[side] -= 1;
      return 'banished face-down';
    }
    return 'removed';
  }

  for (const side of SIDES) {
    for (let slot = 0; slot < 3; slot++) {
      const before = prev.field[side][slot];
      const after = next.field[side][slot];
      if (before === after) continue;

      if (before === null && after !== null) {
        arrivals[side] += 1;
        events.push(`${WHO[side]} played ${after} to slot ${slot + 1}.`);
      } else if (before !== null && after === null) {
        vanished.push({ side, slot, label: before });
        events.push(`${before} left ${THEIR[side]} slot ${slot + 1} — ${destination(before, side)}.`);
      } else if (before !== null && after !== null) {
        arrivals[side] += 1;
        vanished.push({ side, slot, label: before });
        events.push(
          `${THEIR[side]} slot ${slot + 1}: ${after} replaced ${before} — ${destination(before, side)}.`,
        );
      }
    }
  }

  // Pile movement the field diff did not already account for — a hand card
  // banished, a deck card milled, or a card recovered back out of the pile.
  for (const side of SIDES) {
    for (const label of pile[side].added) {
      events.push(`${label} was added to ${THEIR[side]} banished pile.`);
    }
    for (const label of pile[side].removed) {
      events.push(`${label} left ${THEIR[side]} banished pile.`);
    }
    if (faceDown[side] > 0) {
      events.push(`${WHO[side]} banished ${faceDown[side]} card${plural(faceDown[side])} face-down.`);
    }
  }

  for (const side of SIDES) {
    const deckDelta = next.deck[side] - prev.deck[side];
    const handDelta = next.hand[side] - prev.hand[side];

    let drawn = 0;
    if (deckDelta < 0) {
      const lost = -deckDelta;
      // A deck card that shows up in hand is a draw; one that does not was
      // milled or attacked off the top.
      drawn = Math.min(lost, Math.max(0, handDelta));
      if (drawn > 0) events.push(`${WHO[side]} drew ${drawn} card${plural(drawn)}.`);
      const milled = lost - drawn;
      if (milled > 0) {
        events.push(`${WHO[side]} lost ${milled} card${plural(milled)} off the top of ${THEIR[side]} deck.`);
      }
    } else if (deckDelta > 0) {
      events.push(`${deckDelta} card${plural(deckDelta)} went back into ${THEIR[side]} deck.`);
    }

    // Whatever the hand lost beyond the cards it spent on the field.
    const residual = handDelta - drawn + arrivals[side];
    if (residual < 0) {
      events.push(`${WHO[side]} lost ${-residual} card${plural(-residual)} from hand.`);
    }
  }

  for (const side of SIDES) {
    if (next.turns[side] > prev.turns[side]) events.push(`${WHO[side]} ended ${THEIR[side]} turn.`);
  }

  if (prev.loser === null && next.loser !== null) {
    events.push(next.loser === pid ? 'Game over — you lose.' : 'Game over — you win.');
  }

  return { events, vanished };
}

const BTN_FOCUS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white';

/** Disabled controls drop the white label and let the slate outline fade out,
 *  rather than dimming the whole button with opacity alone — at opacity-50 a
 *  thin slate outline on black stayed close enough to the enabled state to be
 *  misread. Disabled controls are exempt from the WCAG contrast minimums, so
 *  the low ratio here is the signal, not a regression. */
const BTN_DISABLED =
  'disabled:cursor-not-allowed disabled:border-sk-slate/25 disabled:bg-transparent disabled:text-sk-slate/60';

const BTN_SECONDARY = `rounded border border-sk-slate px-3 py-1.5 text-sm text-white transition enabled:hover:bg-sk-slate/15 ${BTN_FOCUS} ${BTN_DISABLED}`;

/** End turn stays the primary action, but the emphasis is carried by the white
 *  fill (black-on-white, 21:1); sk-red is only the frame around it. */
const BTN_PRIMARY = `rounded border-2 border-sk-red bg-white px-4 py-1.5 text-sm font-bold text-black transition enabled:hover:bg-white/85 ${BTN_FOCUS} ${BTN_DISABLED}`;

// End-screen actions are links, not buttons: they navigate, and being copyable
// / openable in a new tab matters when both seats have to reach the same URL.
const LINK_PRIMARY = `inline-block rounded border-2 border-sk-red bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-white/85 ${BTN_FOCUS}`;
const LINK_SECONDARY = `inline-block rounded border border-sk-slate px-5 py-2 text-sm text-white transition hover:bg-sk-slate/15 ${BTN_FOCUS}`;

/** Next match id, derived deterministically from the current one so BOTH seats
 *  compute the identical value and land in the same game — a rematch with no
 *  server-side protocol, just a URL. dev-match -> dev-match-r2 -> dev-match-r3. */
function nextMatchID(current: string): string {
  const seen = /^(.*)-r(\d+)$/.exec(current);
  return seen ? `${seen[1]}-r${Number(seen[2]) + 1}` : `${current}-r2`;
}

export default function Board({ G, moves, playerID, matchID, isActive }: Props) {
  const [selectedHandIndex, setSelectedHandIndex] = useState<number | null>(null);
  const [selectedFieldSlot, setSelectedFieldSlot] = useState<number | null>(null);

  const pid = playerID ?? '0';
  const opp = pid === '0' ? '1' : '0';

  const ownHand = G.secret.hands[pid] ?? [];
  const ownField = G.public.field[pid] ?? [null, null, null];
  const oppField = G.public.field[opp] ?? [null, null, null];
  const ownDeckCount = G.public.deckCounts[pid] ?? 0;
  const oppDeckCount = G.public.deckCounts[opp] ?? 0;
  const oppHandCount = G.public.handCounts[opp] ?? 0;
  const ownBanished = G.public.banished[pid] ?? [];
  const oppBanished = G.public.banished[opp] ?? [];
  const ownBanishedFaceDown = G.public.banishedFaceDown[pid] ?? 0;
  const oppBanishedFaceDown = G.public.banishedFaceDown[opp] ?? 0;
  const bottomUpUsed = G.public.bottomUpUsed[pid] ?? false;
  const attackedThisTurn = G.public.attackedThisTurn;

  const pendingChoice: PendingChoice | null = G.public.pendingChoice ?? null;
  const choiceActive = pendingChoice !== null;
  const myChoice = pendingChoice && pendingChoice.pid === pid ? pendingChoice : null;
  const waitingForOpponentChoice = pendingChoice !== null && pendingChoice.pid !== pid;

  const canAttack = isActive && !choiceActive && !attackedThisTurn && selectedFieldSlot !== null;

  const turnsReady = (G.public.turnsTaken[pid] ?? 0) >= 1;
  const selectedFieldCard = selectedFieldSlot !== null ? ownField[selectedFieldSlot] : null;
  const selectedCardCanAttack = selectedFieldCard ? selectedFieldCard.canAttack !== false : false;

  const canAttackHandOrDeck =
    isActive &&
    !choiceActive &&
    selectedFieldSlot !== null &&
    !attackedThisTurn &&
    turnsReady &&
    selectedCardCanAttack;

  function attackDisabledReason(resourceEmpty: boolean, resourceName: string): string | undefined {
    if (!isActive) return 'Not your turn';
    if (choiceActive) return 'Resolve the pending choice first';
    if (selectedFieldSlot === null) return 'Select one of your field cards first';
    if (attackedThisTurn) return 'You have already attacked this turn';
    if (!turnsReady) return 'You cannot attack on your first turn';
    if (!selectedCardCanAttack) return 'Selected card cannot attack';
    if (resourceEmpty) return `Opponent's ${resourceName} is empty`;
    return undefined;
  }

  const attackHandDisabled = !canAttackHandOrDeck || oppHandCount === 0;
  const attackHandTitle = attackDisabledReason(oppHandCount === 0, 'hand');
  const attackDeckDisabled = !canAttackHandOrDeck || oppDeckCount === 0;
  const attackDeckTitle = attackDisabledReason(oppDeckCount === 0, 'deck');

  /** The gate every turn-scoped control shares. Wording matches
   *  attackDisabledReason so one condition reads the same on every button. */
  function turnDisabledReason(): string | undefined {
    if (!isActive) return 'Not your turn';
    if (choiceActive) return 'Resolve the pending choice first';
    return undefined;
  }

  // Reasons for the remaining gated buttons, read straight off the same
  // conditions their `disabled` props use — no new rules.
  const drawTitle = turnDisabledReason();
  const endTurnTitle = turnDisabledReason();
  const bottomUpTitle =
    turnDisabledReason() ??
    (bottomUpUsed
      ? 'Bottom-up is once per game — you have already used it'
      : ownDeckCount > 10
        ? 'Bottom-up needs 10 or fewer cards left in your deck'
        : undefined);
  const banishTitle =
    turnDisabledReason() ??
    (selectedHandIndex === null ? 'Select a hand card to banish' : undefined);

  // Subtle "what can I do next" guidance — additive only, no move-logic impact.
  const suggestHand = isActive && selectedHandIndex === null && selectedFieldSlot === null;

  const gameOver = G.public.loser !== null;
  /** Drives the banner, the own-zone frame and the accent bar together, so the
   *  board reads as "mine to act on" from one flag. Game over is called out
   *  separately: after endIf fires isActive is false for BOTH players, which a
   *  bare "Opponent's turn" would misreport. */
  const myTurn = isActive && !gameOver;
  const turnHeadline = gameOver ? 'Game over' : isActive ? 'Your turn' : "Opponent's turn";

  /** Personalised straight off `loser === pid`, which also means the winner's
   *  seat never has to be recomputed here — game.ts already does that flip once
   *  in endIf. Deck-out is the only path that sets `loser`, so the detail line
   *  states exactly what the state supports and nothing more. */
  const localPlayerLost = G.public.loser === pid;
  const endHeadline = localPlayerLost ? 'You lose' : 'You win';
  const endDetail = localPlayerLost
    ? 'You ran out of cards.'
    : 'Your opponent ran out of cards.';

  const endScreenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gameOver) endScreenRef.current?.focus();
  }, [gameOver]);

  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const [ghosts, setGhosts] = useState<(Vanished & { id: number })[]>([]);
  const prevSnapRef = useRef<Snapshot | null>(null);
  const nextIdRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Every board update is diffed against the previous one. This is the only
  // source of both the log and the removal cue — the game package is untouched.
  useEffect(() => {
    const next = takeSnapshot(G, pid, opp);
    const prev = prevSnapRef.current;
    prevSnapRef.current = next;
    if (!prev) return; // first render just establishes the baseline

    const { events, vanished } = diffSnapshots(prev, next, pid);

    if (vanished.length > 0) {
      const stamped = vanished.map((v) => ({ ...v, id: nextIdRef.current++ }));
      setGhosts((cur) => [...cur, ...stamped]);
      const ids = new Set(stamped.map((g) => g.id));
      timersRef.current.push(
        setTimeout(() => setGhosts((cur) => cur.filter((g) => !ids.has(g.id))), GHOST_MS),
      );
    }

    if (events.length > 0) {
      // Ids are minted outside the updater so a double-invoked effect in
      // StrictMode cannot burn through them.
      const entries = [...events].reverse().map((text) => ({ id: nextIdRef.current++, text }));
      setLog((cur) => [...entries, ...cur].slice(0, LOG_CAP));
    }
  }, [G, pid, opp]);

  function clearSelection() {
    setSelectedHandIndex(null);
    setSelectedFieldSlot(null);
  }

  function handleSelectHandCard(index: number) {
    if (!isActive || choiceActive) return;
    setSelectedFieldSlot(null);
    setSelectedHandIndex((prev) => (prev === index ? null : index));
  }

  function handleSelectFieldCard(slot: number) {
    if (!isActive || choiceActive || attackedThisTurn) return;
    setSelectedHandIndex(null);
    setSelectedFieldSlot((prev) => (prev === slot ? null : slot));
  }

  function handlePlayIntoSlot(slot: number) {
    if (!isActive || choiceActive || selectedHandIndex === null) return;
    moves.playCard(selectedHandIndex, slot);
    clearSelection();
  }

  function handleAttackField(theirSlot: number) {
    if (!isActive || choiceActive || selectedFieldSlot === null) return;
    moves.attackBattleCard(selectedFieldSlot, theirSlot);
    clearSelection();
  }

  function handleAttackHand(theirHandIndex: number) {
    if (!isActive || choiceActive || selectedFieldSlot === null) return;
    moves.attackHand(selectedFieldSlot, theirHandIndex);
    clearSelection();
  }

  function handleAttackDeck() {
    if (attackDeckDisabled || selectedFieldSlot === null) return;
    moves.attackDeck(selectedFieldSlot);
    clearSelection();
  }

  function handleAttackHandRandom() {
    if (attackHandDisabled || selectedFieldSlot === null) return;
    moves.attackHandRandom(selectedFieldSlot);
    clearSelection();
  }

  function handleBottomUp() {
    if (!isActive || choiceActive) return;
    moves.bottomUp();
  }

  function handleEndTurn() {
    if (!isActive || choiceActive) return;
    moves.endTurn();
    clearSelection();
  }

  function handleDrawCard() {
    if (!isActive || choiceActive) return;
    moves.drawCard();
  }

  function handleBanishFromHand() {
    if (!isActive || choiceActive || selectedHandIndex === null) return;
    moves.banishFromHand(selectedHandIndex);
    clearSelection();
  }

  function handleResolveChoice(answer: number | boolean) {
    if (!myChoice) return;
    moves.resolveChoice(answer);
    clearSelection();
  }

  function choiceOptionLabel(kind: PendingChoiceKind, opt: number): string {
    switch (kind) {
      case 'opponentField': {
        const card = oppField[opt];
        return card ? `Slot ${opt + 1}: ${card.label} (BP ${card.currentBp})` : `Slot ${opt + 1}`;
      }
      case 'ownField': {
        const card = ownField[opt];
        return card ? `Slot ${opt + 1}: ${card.label} (BP ${card.currentBp})` : `Slot ${opt + 1}`;
      }
      case 'opponentHandIndex':
        return `Opponent hand card ${opt + 1}`;
      case 'ownHandIndex':
        return `Your hand card ${opt + 1}: ${ownHand[opt] ?? ''}`;
      case 'chooseAbility':
        return `Choice ${opt + 1}`;
      default:
        return `Option ${opt + 1}`;
    }
  }

  /** Non-null when this field slot is a valid answer to my pending choice —
   *  used to redirect the existing field-slot button into resolveChoice(). */
  function fieldChoiceTarget(side: 'own' | 'opp', slot: number): (() => void) | null {
    if (!myChoice) return null;
    if (side === 'own' && myChoice.kind === 'ownField' && myChoice.options?.includes(slot)) {
      return () => handleResolveChoice(slot);
    }
    if (side === 'opp' && myChoice.kind === 'opponentField' && myChoice.options?.includes(slot)) {
      return () => handleResolveChoice(slot);
    }
    return null;
  }

  function renderFieldSlot(side: 'own' | 'opp', slot: number, card: FieldCard | null) {
    const key = `${side}-field-${slot}`;
    const ghost = ghosts.find((g) => g.side === side && g.slot === slot);
    return (
      <div key={key} className={`relative ${SLOT_BOX}`}>
        {renderSlotContent(side, slot, card)}
        {ghost && (
          <img
            key={ghost.id}
            src={cardImageSrc(ghost.label)}
            alt=""
            aria-hidden="true"
            className="sk-slot-vanish pointer-events-none absolute inset-0 h-full w-full rounded-lg object-contain"
          />
        )}
      </div>
    );
  }

  function renderSlotContent(side: 'own' | 'opp', slot: number, card: FieldCard | null) {
    if (!card) {
      // Dashed, so an empty slot still reads as a placeholder now that it is
      // the same size as a card.
      const emptyBox =
        'h-full w-full rounded-lg border border-dashed border-sk-slate/30 bg-transparent';
      if (side === 'own') {
        const canPlaceHere = isActive && !choiceActive && selectedHandIndex !== null;
        return (
          <button
            type="button"
            onClick={() => handlePlayIntoSlot(slot)}
            disabled={!canPlaceHere}
            aria-label={`Empty field slot ${slot + 1}${
              canPlaceHere ? ' - play selected card here' : ''
            }`}
            className={`${emptyBox} transition disabled:cursor-not-allowed disabled:opacity-40 ${
              canPlaceHere ? 'ring-1 ring-sk-slate' : ''
            }`}
          />
        );
      }
      return <div aria-label={`Opponent empty field slot ${slot + 1}`} className={emptyBox} />;
    }

    const choiceTarget = fieldChoiceTarget(side, slot);
    const isChoiceTarget = choiceTarget !== null;

    if (side === 'own') {
      const isSelected = selectedFieldSlot === slot;
      const disabled = choiceActive ? !isChoiceTarget : !isActive || attackedThisTurn;
      return (
        <button
          type="button"
          onClick={choiceTarget ?? (() => handleSelectFieldCard(slot))}
          disabled={disabled}
          aria-pressed={isSelected}
          aria-label={`Your field card in slot ${slot + 1}, BP ${card.currentBp}${
            isChoiceTarget ? ', valid target for pending choice — click to choose' : isSelected ? ', selected' : ''
          }`}
          className={`relative h-full w-full rounded-lg overflow-visible border-2 bg-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
            isChoiceTarget
              ? 'border-sk-red ring-2 ring-sk-red'
              : isSelected
                ? 'border-white ring-2 ring-white'
                : 'border-sk-slate'
          }`}
        >
          <img
            src={cardImageSrc(card.label)}
            alt=""
            className="h-full w-full rounded-lg object-contain"
          />
          <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-sm font-bold text-white">
            {card.currentBp}
          </span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={choiceTarget ?? (() => handleAttackField(slot))}
        disabled={choiceActive ? !isChoiceTarget : !canAttack}
        aria-label={`${isChoiceTarget ? 'Valid target for pending choice — choose ' : 'Attack '}opponent field card in slot ${
          slot + 1
        }, BP ${card.currentBp}`}
        className={`relative h-full w-full rounded-lg overflow-visible border-2 bg-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
          isChoiceTarget ? 'border-sk-red ring-2 ring-sk-red' : 'border-sk-slate'
        }`}
      >
        <img
          src={cardImageSrc(card.label)}
          alt=""
          className="h-full w-full rounded-lg object-contain"
        />
        <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-sk-slate text-sm font-bold text-white">
          {card.currentBp}
        </span>
      </button>
    );
  }

  const visibleOppHandCount = Math.min(oppHandCount, OPP_HAND_CAP);
  const hiddenOppHandCount = oppHandCount - visibleOppHandCount;

  const selectionPrompt =
    selectedHandIndex !== null
      ? 'Card selected — click an empty field slot to play it.'
      : selectedFieldSlot !== null
        ? 'Attacker selected — click an opponent target, or Attack Deck.'
        : 'Select a hand card to play, or a field card to attack.';

  return (
    <div className="min-h-screen w-full flex flex-col bg-black text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* TURN BANNER */}
        <header
          aria-label="Turn status"
          className={`flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-lg border-2 px-5 py-4 transition ${
            myTurn ? 'border-sk-slate bg-sk-slate/10' : 'border-sk-slate/30'
          }`}
        >
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className={`h-9 w-1.5 shrink-0 rounded-full ${myTurn ? 'bg-white' : 'bg-sk-slate/40'}`}
            />
            <p
              aria-live="polite"
              className={`font-[family-name:var(--font-heading)] text-3xl uppercase tracking-[0.18em] sm:text-4xl ${
                myTurn ? 'text-white' : 'text-sk-slate'
              }`}
            >
              {turnHeadline}
            </p>
          </div>

          <dl className="flex items-center gap-8">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.15em] text-sk-slate">Attack</dt>
              <dd className="text-sm text-white">{attackedThisTurn ? 'Used' : 'Available'}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.15em] text-sk-slate">Turns taken</dt>
              <dd className="text-sm text-white">
                You {G.public.turnsTaken[pid] ?? 0} · Opponent {G.public.turnsTaken[opp] ?? 0}
              </dd>
            </div>
          </dl>
        </header>

        {/* OPPONENT ZONE */}
        <section
          aria-label="Opponent zone"
          className="flex flex-col items-center gap-4 border-b border-sk-slate/20 pb-8"
        >
          <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
            {Array.from({ length: visibleOppHandCount }).map((_, i) => {
              const isChoiceTarget =
                myChoice?.kind === 'opponentHandIndex' && (myChoice.options?.includes(i) ?? false);
              return (
                <button
                  key={`opp-hand-${i}`}
                  type="button"
                  onClick={isChoiceTarget ? () => handleResolveChoice(i) : () => handleAttackHand(i)}
                  disabled={choiceActive ? !isChoiceTarget : !canAttack}
                  aria-label={`${
                    isChoiceTarget ? 'Valid target for pending choice — choose ' : 'Attack '
                  }opponent hand card ${i + 1}`}
                  className={`w-20 shrink-0 rounded disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white ${
                    isChoiceTarget ? 'ring-2 ring-sk-red' : ''
                  }`}
                >
                  <CardBack />
                </button>
              );
            })}
            {hiddenOppHandCount > 0 && (
              <span className="shrink-0 text-xs text-sk-slate">+{hiddenOppHandCount}</span>
            )}
          </div>

          <div className="flex flex-row flex-nowrap w-full items-center justify-between gap-4">
            <div className="flex flex-col items-center gap-1 flex-none">
              <div className="relative w-20">
                <CardBack />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                  {oppDeckCount}
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-wide text-sk-slate">Deck</p>
            </div>

            <div className="flex items-end justify-center gap-3 flex-none">
              {oppField.map((card, slot) => renderFieldSlot('opp', slot, card))}
            </div>

            <div className="text-right text-xs text-sk-slate flex-none">
              <p>Banished {oppBanished.length}</p>
              <p>Face-down {oppBanishedFaceDown}</p>
            </div>
          </div>
        </section>

        {/* STATUS + CONTROLS */}
        <section
          aria-label="Game status and controls"
          className="flex flex-col items-center gap-2 border-b border-sk-red/60 pb-8 text-center"
        >
          {/* The result now lives in the end screen; suppress this row entirely
              at game over so a stale "select a hand card" prompt is not left
              sitting behind the overlay. */}
          {gameOver ? null : myChoice ? (
            <div
              role="group"
              aria-label="Pending ability choice"
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-sk-red px-4 py-3"
            >
              <p className="text-sm font-semibold text-white" aria-live="assertive">
                {myChoice.prompt}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {myChoice.kind === 'yesNo' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleResolveChoice(true)}
                      aria-label="Yes"
                      className="rounded border-2 border-sk-red px-4 py-1 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveChoice(false)}
                      aria-label="No"
                      className="rounded border border-sk-slate px-4 py-1 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      No
                    </button>
                  </>
                ) : (
                  (myChoice.options ?? []).map((opt) => (
                    <button
                      key={`choice-opt-${opt}`}
                      type="button"
                      onClick={() => handleResolveChoice(opt)}
                      aria-label={choiceOptionLabel(myChoice.kind, opt)}
                      className="rounded border-2 border-sk-red px-3 py-1 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white"
                    >
                      {choiceOptionLabel(myChoice.kind, opt)}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : waitingForOpponentChoice ? (
            <p className="text-sm text-sk-slate" aria-live="polite">
              Waiting for opponent&apos;s choice…
            </p>
          ) : (
            <p className="text-xs text-sk-slate" aria-live="polite">
              {selectionPrompt}
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleDrawCard}
              disabled={!isActive || choiceActive}
              aria-label="Draw a card"
              title={drawTitle}
              className={BTN_SECONDARY}
            >
              Draw card
            </button>
            <button
              type="button"
              onClick={handleBottomUp}
              disabled={!isActive || choiceActive || bottomUpUsed || ownDeckCount > 10}
              aria-label="Move bottom card of deck to top"
              title={bottomUpTitle}
              className={BTN_SECONDARY}
            >
              Bottom-up
            </button>
            <button
              type="button"
              onClick={handleAttackHandRandom}
              disabled={attackHandDisabled}
              aria-label="Attack a random opponent hand card"
              title={attackHandTitle}
              className={BTN_SECONDARY}
            >
              Attack hand
            </button>
            <button
              type="button"
              onClick={handleAttackDeck}
              disabled={attackDeckDisabled}
              aria-label="Attack opponent deck"
              title={attackDeckTitle}
              className={BTN_SECONDARY}
            >
              Attack deck
            </button>
            <button
              type="button"
              onClick={handleBanishFromHand}
              disabled={!isActive || choiceActive || selectedHandIndex === null}
              aria-label="Banish selected hand card to banished pile"
              title={banishTitle}
              className={BTN_SECONDARY}
            >
              Banish
            </button>
            <button
              type="button"
              onClick={handleEndTurn}
              disabled={!isActive || choiceActive}
              aria-label="End turn"
              title={endTurnTitle}
              className={BTN_PRIMARY}
            >
              End turn
            </button>
          </div>

          {/* EVENT LOG — newest first, so the thing that just happened is
              always the top line and never needs scrolling to. */}
          <div className="w-full max-w-md pt-3 text-left">
            <h2 className="text-[10px] uppercase tracking-[0.15em] text-sk-slate">Event log</h2>
            <ol
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Event log, newest first"
              className="mt-1 max-h-32 overflow-y-auto rounded border border-sk-slate/30 px-3 py-2"
            >
              {log.length === 0 ? (
                <li className="py-0.5 text-xs text-sk-slate">
                  Nothing yet. Plays and removals will show up here.
                </li>
              ) : (
                log.map((entry, i) => (
                  <li
                    key={entry.id}
                    className={`border-l-2 py-0.5 pl-2 text-xs ${
                      i === 0 ? 'border-sk-red text-white' : 'border-transparent text-sk-slate'
                    }`}
                  >
                    {entry.text}
                  </li>
                ))
              )}
            </ol>
          </div>
        </section>

        {/* OWN ZONE — the frame lights up only while it is this player's turn,
            so turn ownership is legible from the board itself, not just the banner. */}
        <section
          aria-label="Your zone"
          className={`flex flex-col items-center gap-5 rounded-xl border-2 px-3 py-4 transition ${
            myTurn ? 'border-sk-slate bg-sk-slate/[0.06]' : 'border-transparent'
          }`}
        >
          <div className="flex flex-row flex-nowrap w-full items-center justify-between gap-4">
            <div className="flex flex-col items-center flex-none">
              <div className="relative w-20">
                <CardBack />
                <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
                  {ownDeckCount}
                </span>
              </div>
              <p className="text-xs text-sk-slate">DECK</p>
              <p className="text-xs text-sk-slate">
                {bottomUpUsed ? 'Bottom-up used' : 'Bottom-up available'}
              </p>
            </div>

            <div className="flex flex-row flex-nowrap items-center gap-2 flex-none">
              {ownField.map((card, slot) => renderFieldSlot('own', slot, card))}
            </div>

            <div className="text-right text-xs text-sk-slate flex-none">
              <p>Banished {ownBanished.length}</p>
              <p>Face-down {ownBanishedFaceDown}</p>
            </div>
          </div>

          <div className="flex w-full flex-nowrap items-center justify-center gap-3 overflow-x-auto px-2 pb-2">
            {ownHand.map((label, i) => {
              const isSelected = selectedHandIndex === i;
              return (
                <button
                  key={`own-hand-${i}-${label}`}
                  type="button"
                  onClick={() => handleSelectHandCard(i)}
                  disabled={!isActive || choiceActive}
                  aria-pressed={isSelected}
                  aria-label={`Your hand card ${i + 1}: ${label}${
                    isSelected ? ', selected' : ''
                  }`}
                  className={`aspect-[2.5/3.5] w-44 shrink-0 overflow-hidden rounded-lg border-2 bg-neutral-950 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSelected
                      ? 'border-white ring-2 ring-white'
                      : suggestHand
                        ? 'border-sk-slate ring-1 ring-sk-slate'
                        : 'border-sk-slate'
                  }`}
                >
                  <img
                    src={cardImageSrc(label)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* END SCREEN — the board stays readable behind a dimmed, blurred
          backdrop, so the final position can still be seen. */}
      {gameOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div
            ref={endScreenRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-screen-title"
            aria-describedby="end-screen-detail"
            tabIndex={-1}
            className="w-full max-w-md rounded-xl border-2 border-sk-slate bg-black px-8 py-10 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <h2
              id="end-screen-title"
              className="font-[family-name:var(--font-heading)] text-5xl uppercase tracking-[0.15em] text-white sm:text-6xl"
            >
              {endHeadline}
            </h2>

            {/* Same accent rule the landing page uses under the wordmark. */}
            <span className="mx-auto mt-5 block h-1 w-16 bg-sk-red" aria-hidden="true" />

            <p
              id="end-screen-detail"
              aria-live="assertive"
              className="mt-5 text-sm text-sk-slate"
            >
              {endDetail}
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href={`/play?player=${encodeURIComponent(pid)}&match=${encodeURIComponent(
                  nextMatchID(matchID),
                )}`}
                className={LINK_PRIMARY}
              >
                New match
              </a>
              <a href="/" className={LINK_SECONDARY}>
                Back to home
              </a>
            </div>

            <p className="mt-6 text-xs text-sk-slate">
              New match keeps you in seat {pid}. Your opponent has to open it too — both seats
              land in the same next match.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
