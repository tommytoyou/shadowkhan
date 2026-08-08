'use client';

import { useEffect, useRef } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import type { BoardProps } from 'boardgame.io/react';
import { ShadowkhanGame } from '@shadowkhan/game';
import type { ShadowkhanG } from '@shadowkhan/game';
import Board from './Board';

/** Both seats share ONE transport instance and ONE matchID, so both clients
 *  attach to the same Local master and every bot move propagates straight
 *  into the human's view — no server, no socket, no second browser tab. */
const local = Local();
const MATCH_ID = 'cpu-local';

/** Pacing for the bot's action, purely so a human can see what happened
 *  instead of the CPU turn vanishing between frames. */
const BOT_DELAY_MS = 500;

/** Safety valve. Every action this driver takes is supposed to change the
 *  state it was reacting to; if the same owed action comes back around this
 *  many times running, something rejected it (INVALID_MOVE) and retrying
 *  forever would just spin. Stop and say so rather than hammer. */
const MAX_REPEATS = 3;

type Props = BoardProps<ShadowkhanG>;

/**
 * Headless, deliberately trivial driver for seat '1'. Renders nothing — it
 * exists only to make sure the CPU seat always does *something* when the game
 * is waiting on it, so control can never get stuck on the human's side.
 *
 * It plays no cards and makes no decisions worth the name: it ends its turn
 * immediately, and answers any choice it owes with the most conservative
 * legal answer available (decline / cancel / first option).
 */
function BotDriver(props: Props) {
  const { G, ctx, moves, isActive } = props;

  /** Set once an action has been scheduled for the CURRENT state; the effect
   *  cleanup clears it, which happens exactly when a new state arrives (deps
   *  change) — so the next owed action is free to fire, but a re-render on
   *  unchanged state cannot double-dispatch. */
  const actedRef = useRef(false);
  /** Last action signature and how many times running it has been attempted. */
  const repeatRef = useRef<{ key: string; count: number }>({ key: '', count: 0 });

  useEffect(() => {
    if (!isActive) return;
    if (actedRef.current) return;

    const pc = G.public.pendingChoice;

    // What to do, decided up front so the signature below describes the
    // actual action rather than the state that prompted it.
    let key: string;
    let act: () => void;

    if (pc && pc.pid === '1') {
      if (pc.options === null || pc.kind === 'yesNo') {
        key = `choice:no:${pc.sourceLabel}:${pc.abilitySlot}`;
        act = () => moves.resolveChoice(false);
      } else if (pc.multi) {
        // `false` cancels a multi-select outright — always legal, and it
        // commits nothing (see resolveMultiChoice in effects.ts).
        key = `choice:cancel:${pc.sourceLabel}:${pc.abilitySlot}`;
        act = () => moves.resolveChoice(false);
      } else {
        // openChoice never opens with an empty option list, so [0] exists.
        key = `choice:first:${pc.sourceLabel}:${pc.abilitySlot}:${pc.options[0]}`;
        act = () => moves.resolveChoice(pc.options![0]);
      }
    } else if (ctx.currentPlayer === '1' && !pc) {
      key = `endTurn:${ctx.turn}`;
      act = () => moves.endTurn();
    } else {
      // Active, but nothing owed by this seat — nothing to do.
      return;
    }

    const repeat = repeatRef.current;
    repeat.count = repeat.key === key ? repeat.count + 1 : 1;
    repeat.key = key;
    if (repeat.count > MAX_REPEATS) {
      console.warn(`[BotDriver] giving up on "${key}" after ${MAX_REPEATS} attempts`);
      return;
    }

    actedRef.current = true;
    const timer = setTimeout(act, BOT_DELAY_MS);

    return () => {
      clearTimeout(timer);
      actedRef.current = false;
    };
  }, [G, ctx, moves, isActive]);

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
