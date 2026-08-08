'use client';

import { useEffect, useRef } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import type { BoardProps } from 'boardgame.io/react';
import { ShadowkhanGame } from '@shadowkhan/game';
import type { PendingChoice, ShadowkhanG } from '@shadowkhan/game';
import Board from './Board';

/** Both seats share ONE transport instance and ONE matchID, so both clients
 *  attach to the same Local master and every bot move propagates straight
 *  into the human's view — no server, no socket, no second browser tab. */
const local = Local();
const MATCH_ID = 'cpu-local';

const BOT = '1';
const OPP = '0';

/** The only card in ATTACH_TARGETS (effects.ts) — played onto an OCCUPIED slot
 *  as an attachment rather than into an empty one. */
const ATTACH_LABEL = 'Sk-09';

/** Pacing for the bot's first action on a freshly-arrived state, purely so a
 *  human can see what happened instead of the CPU turn vanishing between
 *  frames. */
const BOT_DELAY_MS = 500;

/** How long to wait before concluding a dispatched move was a no-op. Moves
 *  are `client: false`, so nothing is applied locally and a rejected move
 *  (INVALID_MOVE) is indistinguishable from a slow one except by waiting and
 *  seeing whether the state signature moved. Slightly under BOT_DELAY_MS so a
 *  run of rejects still resolves briskly. */
const RETRY_MS = 450;

/** Upper bound on actions in one bot turn. Repeatable activations (Sk-26a is
 *  once-per-TURN, not once-ever) plus chained choices could otherwise let a
 *  single turn run long; this bounds it without encoding any strategy. */
const TURN_BUDGET = 24;

/** Final spin backstop. Every dispatch is supposed to move the state
 *  signature; if `endTurn` itself comes back a no-op this many times running
 *  against an unchanged signature, something is wrong that retrying cannot
 *  fix. Stop and say so rather than hammer forever. */
const MAX_REPEATS = 3;

/** Hard ceiling on dispatches against a single unchanged signature. The tried
 *  set already bounds normal exploration (each candidate is attempted at most
 *  once), so this only catches a pathological case — chiefly a bot-owned
 *  choice that rejects every answer we offer, where answers are random rather
 *  than drawn from an exhaustible list. Comfortably above the largest possible
 *  candidate list (12 plays + 15 attacks + 3 activations + bottom-up). */
const MAX_ATTEMPTS_PER_STATE = 48;

/** Absolute ceiling on dispatches within a single bot turn, counting rejects.
 *  TURN_BUDGET deliberately counts only moves that landed, so a pile of
 *  illegal candidates cannot crowd out the legal ones — but that leaves every
 *  remaining guard (triedRef, attemptsRef, deadEndRef) keyed to the state
 *  signature, and all of them reset the moment it changes. If the signature
 *  churns for any reason, those guards reset faster than they can bound
 *  anything and the driver will dispatch without limit. This is the one bound
 *  that resets only on a genuine turn change, so it holds regardless. Set well
 *  above what an honest turn needs (24 landed moves plus rejects). */
const MAX_DISPATCHES_PER_TURN = 120;

type Props = BoardProps<ShadowkhanG>;

/** A move the bot might dispatch. `key` identifies it within one state so an
 *  attempt that turns out to be illegal is not retried against that state. */
type Candidate = { move: string; args: number[]; key: string };

const candidate = (move: string, ...args: number[]): Candidate => ({
  move,
  args,
  key: `${move}:${args.join(',')}`,
});

const pickRandom = <T,>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];

/**
 * Everything the bot's decision depends on, plus everything a dispatched move
 * could plausibly change. Used to tell "the engine accepted my move" from "the
 * engine rejected it", which boardgame.io does not report back synchronously.
 */
function signatureOf(G: ShadowkhanG, ctx: Props['ctx']): string {
  return JSON.stringify([
    ctx.turn,
    ctx.currentPlayer,
    G.public.pendingChoice,
    G.public.field,
    G.public.deckCounts,
    G.public.handCounts,
    G.public.attackedThisTurn,
    G.public.turnsTaken,
    G.public.banished,
  ]);
}

/**
 * Every move the bot could plausibly make from this state. Deliberately
 * OVER-enumerates: play legality (PLAY_GATES), Sk-09's attach targeting, and
 * `cannotUseEffects` locks live inside the engine and cannot be evaluated from
 * the board props, so illegal candidates are included here and weeded out by
 * the try-verify-retry loop instead.
 *
 * Omitted on purpose: `drawCard` (fires automatically in turn.onBegin),
 * `banishFromHand` (a voluntary self-discard — pure downside without a reason
 * to want it), and `attackHand` (needs an index into a hand the bot cannot
 * see; `attackHandRandom` is the no-knowledge equivalent).
 */
function enumerateCandidates(G: ShadowkhanG): Candidate[] {
  const out: Candidate[] = [];
  const mine = G.public.field[BOT] ?? [null, null, null];
  const theirs = G.public.field[OPP] ?? [null, null, null];
  const hand = G.secret.hands[BOT] ?? [];

  // `slot` means opposite things depending on the card: a normal card needs an
  // EMPTY slot to occupy, an attach card needs an OCCUPIED slot to attach to.
  // Enumerating both for every card was ~15 candidates per turn of which all
  // but a couple were guaranteed-illegal; splitting on the label keeps the
  // list to what could actually be legal. Which occupied slot is a valid HOST
  // is still the engine's call (attach isValidTarget) — rejections there are
  // rare and the retry loop handles them.
  for (let h = 0; h < hand.length; h++) {
    const needsHost = hand[h] === ATTACH_LABEL;
    for (let slot = 0; slot < 3; slot++) {
      const occupied = mine[slot] != null;
      if (needsHost === occupied) out.push(candidate('playCard', h, slot));
    }
  }

  if (!G.public.attackedThisTurn && (G.public.turnsTaken[BOT] ?? 0) >= 1) {
    for (let mySlot = 0; mySlot < 3; mySlot++) {
      const attacker = mine[mySlot];
      if (!attacker || attacker.canAttack === false) continue;

      for (let theirSlot = 0; theirSlot < 3; theirSlot++) {
        if (theirs[theirSlot]) out.push(candidate('attackBattleCard', mySlot, theirSlot));
      }
      if ((G.public.handCounts[OPP] ?? 0) > 0) out.push(candidate('attackHandRandom', mySlot));
      if ((G.public.deckCounts[OPP] ?? 0) > 0) out.push(candidate('attackDeck', mySlot));
    }
  }

  // Skipping already-activated slots keeps a once-per-turn repeatable ability
  // from being offered again and again within the same turn.
  for (let i = 0; i < 3; i++) {
    const card = mine[i];
    if (card && card.activated !== true) out.push(candidate('activateAbility', i));
  }

  const myDeck = G.public.deckCounts[BOT] ?? 0;
  if (!G.public.bottomUpUsed[BOT] && myDeck <= 10 && myDeck >= 2) {
    out.push(candidate('bottomUp'));
  }

  return out;
}

/** A random legal answer to a choice the bot owns. No strategy — a coin flip
 *  on yes/no, a uniform pick among offered options. */
function chooseAnswer(pc: PendingChoice): number | boolean {
  if (pc.multi) {
    const remaining = (pc.options ?? []).filter((o) => !pc.multi!.selected.includes(o));
    // The engine resolves a multi-select on its own once `count` picks land,
    // so feeding it one more selection is all that's needed. `true` finalizes
    // an "up to N" choice if somehow nothing is left to pick.
    if (remaining.length > 0) return pickRandom(remaining);
    return true;
  }
  if (pc.options === null) return Math.random() < 0.5;
  return pickRandom(pc.options);
}

/**
 * Headless driver for seat '1'. Renders nothing.
 *
 * Plays a legal-only RANDOM game: it plays cards, attacks, activates
 * abilities, and answers its own ability prompts, choosing uniformly among
 * whatever is available. There is no evaluation of any kind — it is a legality
 * engine with a die, not an opponent that is trying to win.
 *
 * The hard part is legality. Moves are `client: false`, so a dispatch is
 * fire-and-forget: an illegal move returns INVALID_MOVE inside the master and
 * simply leaves the state alone. The driver therefore works by
 * try-verify-retry — dispatch a candidate, wait, and if the state signature
 * has not moved, treat that candidate as illegal, remember it, and try a
 * different one. Exhausting the candidate list means there is nothing legal
 * left to do, which is exactly when the turn should end.
 */
function BotDriver(props: Props) {
  /** Latest props, readable from inside a timer callback without making the
   *  timer depend on a particular render's closure. */
  const propsRef = useRef(props);
  propsRef.current = props;

  const sigRef = useRef<string | null>(null);
  const turnRef = useRef<number>(-1);
  /** Candidate keys already attempted against the CURRENT signature. */
  const triedRef = useRef<Set<string>>(new Set());
  const actionsThisTurnRef = useRef(0);
  const attemptsRef = useRef(0);
  /** Signature a candidate move was just dispatched against, or null. If the
   *  signature later moves on from this one, that dispatch is confirmed to
   *  have landed — the only way to tell an accepted move from a rejected one,
   *  and therefore the only sound basis for charging the turn budget. */
  const pendingActionRef = useRef<string | null>(null);
  /** Every dispatch this turn, landed or rejected. Reset only on a turn
   *  change — see MAX_DISPATCHES_PER_TURN. */
  const dispatchesThisTurnRef = useRef(0);
  /** Consecutive `endTurn` dispatches that failed to move the signature. */
  const deadEndRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Deliberately NOT a per-render cleanup. A rejected move still produces a
  // state update, so the component re-renders with an unchanged signature —
  // tearing the retry timer down there would cancel the very verification pass
  // that is supposed to notice the rejection, and the bot would stall. The
  // timer is owned by the signature, not by the render.
  useEffect(() => clearTimer, []);

  useEffect(() => {
    /** Adopt a newly-arrived state, if it is in fact new: everything remembered
     *  about the previous one (what was tried, how many attempts) is
     *  meaningless now. Returns whether anything changed.
     *
     *  This is also where the turn budget is charged. A dispatch is only
     *  counted once the signature it was fired against has demonstrably moved
     *  on — a rejected candidate leaves the state untouched and so costs
     *  nothing, which is what keeps a pile of illegal candidates from crowding
     *  out the legal moves further down the list. Both entry points (the
     *  render effect and the retry timer) go through here so a landed move is
     *  counted exactly once, whichever notices it first. */
    const syncIfChanged = (G: ShadowkhanG, ctx: Props['ctx']): boolean => {
      const sig = signatureOf(G, ctx);
      if (sig === sigRef.current) return false;

      const landed = pendingActionRef.current !== null && pendingActionRef.current === sigRef.current;
      const turnChanged = ctx.turn !== turnRef.current;

      pendingActionRef.current = null;
      sigRef.current = sig;
      triedRef.current.clear();
      attemptsRef.current = 0;
      deadEndRef.current = 0;

      if (turnChanged) {
        turnRef.current = ctx.turn;
        actionsThisTurnRef.current = 0;
        dispatchesThisTurnRef.current = 0;
      } else if (landed) {
        actionsThisTurnRef.current += 1;
      }
      return true;
    };

    /** Dispatch, then arm the verification pass. Only ever one timer alive, so
     *  at most one dispatch per unchanged signature per RETRY_MS. */
    const dispatch = (send: () => void) => {
      attemptsRef.current += 1;
      dispatchesThisTurnRef.current += 1;
      send();
      clearTimer();
      timerRef.current = setTimeout(step, RETRY_MS);
    };

    function step(): void {
      timerRef.current = null;
      const { G, ctx, moves, isActive } = propsRef.current;

      syncIfChanged(G, ctx);

      // Once the game is decided there is nothing legal left to do, but
      // `endTurn` still advances ctx.turn — and a turn change resets every
      // guard here (triedRef, attemptsRef, deadEndRef, the per-turn dispatch
      // ceiling). Without this the driver flips turns forever against a
      // finished game, dispatching moves the engine rejects, and no backstop
      // can ever catch it because they are all reset on the way round.
      if (ctx.gameover !== undefined) return;

      if (!isActive) return;

      if (dispatchesThisTurnRef.current >= MAX_DISPATCHES_PER_TURN) {
        console.warn(
          `[BotDriver] giving up: ${dispatchesThisTurnRef.current} dispatches in one turn`
        );
        return;
      }

      if (attemptsRef.current >= MAX_ATTEMPTS_PER_STATE) {
        console.warn(
          `[BotDriver] giving up: ${attemptsRef.current} dispatches with no state change`
        );
        return;
      }

      // A choice the bot owns can be opened on the HUMAN's turn (guardian and
      // self-hook cards set activePlayers to the defender), so this is checked
      // before, and independently of, whose turn it is.
      const pc = G.public.pendingChoice;
      if (pc) {
        if (pc.pid !== BOT) return;
        const answer = chooseAnswer(pc);
        dispatch(() => moves.resolveChoice(answer));
        return;
      }

      if (ctx.currentPlayer !== BOT) return;

      const endTurn = () => {
        deadEndRef.current += 1;
        if (deadEndRef.current > MAX_REPEATS) {
          console.warn(`[BotDriver] giving up: endTurn ignored ${MAX_REPEATS} times running`);
          return;
        }
        dispatch(() => moves.endTurn());
      };

      if (actionsThisTurnRef.current >= TURN_BUDGET) {
        console.warn(`[BotDriver] turn budget of ${TURN_BUDGET} actions reached — ending turn`);
        endTurn();
        return;
      }

      const options = enumerateCandidates(G).filter((c) => !triedRef.current.has(c.key));
      if (options.length === 0) {
        endTurn();
        return;
      }

      const choice = pickRandom(options);
      triedRef.current.add(choice.key);
      // Charged to the turn budget only if it lands — see syncIfChanged.
      pendingActionRef.current = sigRef.current;
      dispatch(() => {
        const fn = (moves as Record<string, (...a: number[]) => void>)[choice.move];
        fn(...choice.args);
      });
    }

    // Runs on every render, but only *acts* when the state genuinely changed —
    // a re-render on unchanged state must not start a second decision loop,
    // since the retry timer already owns that state.
    const { G, ctx } = propsRef.current;
    if (syncIfChanged(G, ctx)) {
      clearTimer();
      timerRef.current = setTimeout(step, BOT_DELAY_MS);
    }
  });

  return null;
}

const HumanClient = Client({
  game: ShadowkhanGame,
  board: Board,
  numPlayers: 2,
  multiplayer: local,
  debug: false,
});

const BotClient = Client({
  game: ShadowkhanGame,
  board: BotDriver,
  numPlayers: 2,
  multiplayer: local,
  debug: false,
});

export default function CpuGame() {
  return (
    <>
      <HumanClient playerID="0" matchID={MATCH_ID} />
      <BotClient playerID="1" matchID={MATCH_ID} />
    </>
  );
}
