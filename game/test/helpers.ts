// Headless test harness for game logic — see the accompanying report for why
// this shape was chosen. Summary: we use `Client` from the officially
// documented 'boardgame.io/client' entry point (the supported way to drive a
// boardgame.io Game without any UI) against a game object that is a shallow
// copy of the REAL ShadowkhanGame — same moves, same turn hooks, same endIf,
// same random/events plugins — with only `setup()` swapped out so a test can
// hand it an exact starting G instead of a random deal. No rule or ability
// logic is touched; only the initial deal is test-controlled, exactly the
// same category of thing DEV_MODE/DEV_TEST_HAND already does in game.ts.
import { Client } from 'boardgame.io/client';
import { ShadowkhanGame } from '../game';
import { CARD_BY_LABEL } from '../cards';
import type { FieldCard, PendingChoice, ShadowkhanG } from '../state';

export type PlayerID = '0' | '1';

/** A field slot: a bare label (defaults to that card's printed BP), an object
 *  for finer control (custom currentBp / flags), or null for an empty slot. */
export type FieldSlotSpec =
  | string
  | (Partial<Pick<FieldCard, 'currentBp' | 'canAttack' | 'protectedFromBattleCardRemoval' | 'turnsOnField'>> & {
      label: string;
    })
  | null;

export interface PlayerPositionSpec {
  /** Up to 3 entries, left-to-right by slot index. Missing slots are empty. */
  field?: FieldSlotSpec[];
  /** Hand contents by label, in order. Defaults to []. */
  hand?: string[];
  /** Deck contents by label, top-of-deck first. Defaults to []. */
  deck?: string[];
  /** G.public.turnsTaken for this player. Defaults to 0. */
  turnsTaken?: number;
}

export interface BoardPositionSpec {
  players: Record<PlayerID, PlayerPositionSpec>;
  /** Whose turn it is (ctx.currentPlayer). Defaults to '0', boardgame.io's
   *  own default for a fresh game. Setting this to '1' dispatches one real
   *  events.endTurn() after the client starts to get there — meaning the
   *  real turn.onEnd/onBegin hooks run (turnsTaken/turnsOnField increment
   *  for player '0' as a natural consequence of a genuine turn transition,
   *  not a shortcut). None of the current test cases need this path. */
  currentPlayer?: PlayerID;
  attackedThisTurn?: boolean;
  pendingChoice?: PendingChoice | null;
  rulesOfEngagementActive?: boolean;
}

function toFieldCard(spec: FieldSlotSpec): FieldCard | null {
  if (spec === null || spec === undefined) return null;
  const isObj = typeof spec === 'object';
  const label = isObj ? spec.label : spec;
  const printed = CARD_BY_LABEL[label];

  const card: FieldCard = {
    label,
    currentBp: isObj && spec.currentBp !== undefined ? spec.currentBp : printed?.bp ?? 0,
    attached: [],
    turnsOnField: isObj && spec.turnsOnField !== undefined ? spec.turnsOnField : 0,
  };
  if (isObj && spec.canAttack !== undefined) card.canAttack = spec.canAttack;
  if (isObj && spec.protectedFromBattleCardRemoval !== undefined) {
    card.protectedFromBattleCardRemoval = spec.protectedFromBattleCardRemoval;
  }
  return card;
}

function buildField(slots: FieldSlotSpec[] | undefined): (FieldCard | null)[] {
  const result: (FieldCard | null)[] = [null, null, null];
  (slots ?? []).forEach((slot, i) => {
    if (i < 3) result[i] = toFieldCard(slot);
  });
  return result;
}

function buildG(spec: BoardPositionSpec): ShadowkhanG {
  const p0 = spec.players['0'];
  const p1 = spec.players['1'];
  const hand0 = p0.hand ?? [];
  const hand1 = p1.hand ?? [];
  const deck0 = p0.deck ?? [];
  const deck1 = p1.deck ?? [];

  return {
    secret: {
      decks: { '0': [...deck0], '1': [...deck1] },
      hands: { '0': [...hand0], '1': [...hand1] },
    },
    public: {
      deckCounts: { '0': deck0.length, '1': deck1.length },
      handCounts: { '0': hand0.length, '1': hand1.length },
      field: { '0': buildField(p0.field), '1': buildField(p1.field) },
      banished: { '0': [], '1': [] },
      banishedFaceDown: { '0': 0, '1': 0 },
      turnsTaken: { '0': p0.turnsTaken ?? 0, '1': p1.turnsTaken ?? 0 },
      bottomUpUsed: { '0': false, '1': false },
      attackedThisTurn: spec.attackedThisTurn ?? false,
      loser: null,
      rulesOfEngagementActive: spec.rulesOfEngagementActive ?? false,
      pendingChoice: spec.pendingChoice ?? null,
    },
  };
}

export interface TestGame {
  /** The real boardgame.io client — dispatch real moves via client.moves.*. */
  client: ReturnType<typeof Client<ShadowkhanG>>;
  /** Convenience: client.getState().G, pre-typed. Re-reads live each call. */
  G: () => ShadowkhanG;
}

/**
 * Builds a running ShadowkhanGame client seeded at an exact board position,
 * ready to dispatch real moves through the real reducer (random/events
 * plugins active, playerView applied on read). Game rule/ability code is
 * never touched — only the initial deal is replaced.
 */
export function createTestGame(spec: BoardPositionSpec): TestGame {
  const initialG = buildG(spec);

  const testGame = {
    ...ShadowkhanGame,
    setup: () => initialG,
  };

  const client = Client<ShadowkhanG>({
    game: testGame,
    numPlayers: 2,
    playerID: '0',
  });

  client.start();

  // boardgame.io's own default for a fresh 2-player game is ctx.currentPlayer
  // === '0'. To reach '1' we dispatch our own real `endTurn` move (not the
  // raw framework event) so the pendingChoice guard and turn.onEnd/onBegin
  // hooks all run exactly as they would for a real player ending their turn.
  const desiredCurrentPlayer = spec.currentPlayer ?? '0';
  if (desiredCurrentPlayer !== client.getState()?.ctx.currentPlayer) {
    client.moves.endTurn();
  }

  return {
    client,
    G: () => client.getState()!.G,
  };
}
