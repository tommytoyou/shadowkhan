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
import { Local } from 'boardgame.io/multiplayer';
import { ShadowkhanGame } from '../game';
import { CARD_BY_LABEL } from '../cards';
import type { ActiveEffect, FieldCard, PendingChoice, ShadowkhanG } from '../state';

export type PlayerID = '0' | '1';

/** A field slot: a bare label (defaults to that card's printed BP), an object
 *  for finer control (custom currentBp / flags), or null for an empty slot. */
export type FieldSlotSpec =
  | string
  | (Partial<Pick<FieldCard, 'currentBp' | 'canAttack' | 'protectedFromBattleCardRemoval' | 'turnsOnField' | 'replacementUsed'>> & {
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
  /** G.public.banished (face-up removed pile) for this player, by label.
   *  Defaults to []. */
  banished?: string[];
  /** G.public.banishedFaceDown (face-down removed count — no labels, by
   *  construction) for this player. Defaults to 0. Seedable so a test can
   *  assert that face-down removals never leak into a face-up-only search
   *  (see the 'removed' zone in effects.ts) regardless of how many there are. */
  banishedFaceDown?: number;
  /** Subset of `banished` (by label) tagged as removed FROM THIS PLAYER'S
   *  OWN FIELD specifically — G.public.banishedFromField. Defaults to [].
   *  Every label listed here must also appear in `banished`; seedable so a
   *  test can distinguish a field-origin removed card (Sk-04a's target)
   *  from a hand/deck-origin one sitting in the same pile. */
  banishedFromField?: string[];
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
  /** G.public.activeEffects. Defaults to []. */
  activeEffects?: ActiveEffect[];
  /** boardgame.io's Game.seed — fixes the master's deterministic PRNG so a
   *  test invoking random.Shuffle/Die (via EngineCtx, see effects.ts) can
   *  assert reproducibility: two createTestGame calls with the same seed and
   *  the same move sequence must produce the same random outcome. Omitted by
   *  default (boardgame.io picks its own seed), matching every existing test
   *  that doesn't care about randomness at all. */
  seed?: string | number;
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
  if (isObj && spec.replacementUsed !== undefined) {
    card.replacementUsed = spec.replacementUsed;
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
      banished: { '0': [...(p0.banished ?? [])], '1': [...(p1.banished ?? [])] },
      banishedFaceDown: { '0': p0.banishedFaceDown ?? 0, '1': p1.banishedFaceDown ?? 0 },
      banishedFromField: { '0': [...(p0.banishedFromField ?? [])], '1': [...(p1.banishedFromField ?? [])] },
      turnsTaken: { '0': p0.turnsTaken ?? 0, '1': p1.turnsTaken ?? 0 },
      bottomUpUsed: { '0': false, '1': false },
      attackedThisTurn: spec.attackedThisTurn ?? false,
      loser: null,
      rulesOfEngagementActive: spec.rulesOfEngagementActive ?? false,
      pendingChoice: spec.pendingChoice ?? null,
      activeEffects: [...(spec.activeEffects ?? [])],
    },
  };
}

export interface TestGame {
  /** The real boardgame.io client, bound to player '0' — dispatch real moves
   *  via client.moves.*. Every existing test uses only this and G(); nothing
   *  about their calling code changes. */
  client: ReturnType<typeof Client<ShadowkhanG>>;
  /** Convenience: client.getState().G, pre-typed (player '0's playerView).
   *  Re-reads live each call. */
  G: () => ShadowkhanG;
  /** A SEPARATE, genuinely independent client bound to player '1', wired to
   *  the SAME match as `client` via multiplayer: Local() (see below) — so a
   *  test can dispatch moves AS player 1 (client1.moves.*) and read player
   *  1's own playerView (G1()), through the real reducer and real move
   *  validation exactly like `client`, not a bypass. Additive: no existing
   *  test references this. */
  client1: ReturnType<typeof Client<ShadowkhanG>>;
  /** Convenience: client1.getState().G (player '1's playerView). */
  G1: () => ShadowkhanG;
}

/** Local()'s own master registry (see boardgame.io's client/transport/local)
 *  is keyed by the `game` object passed to Client — reference equality, not
 *  matchID — so two clients only share a master if they're constructed with
 *  the literal same `testGame` object, which is exactly what happens below
 *  (both Client() calls close over the same local `testGame`). matchID
 *  additionally scopes which MATCH within that shared master they join;
 *  each createTestGame() call mints its own so unrelated tests never
 *  collide, even though the master registry itself lives at module scope
 *  for the whole test run. */
let matchCounter = 0;

/**
 * Builds a running ShadowkhanGame client pair seeded at an exact board
 * position, ready to dispatch real moves through the real reducer
 * (random/events plugins active, playerView applied on read). Game
 * rule/ability code is never touched — only the initial deal is replaced.
 *
 * Two clients, not one: player '0's client (`client`) is what every
 * existing test already uses unchanged. player '1's client (`client1`) is
 * new — a second Client(), bound to playerID '1', connected to the SAME
 * LocalMaster as `client` via multiplayer: Local() and a shared matchID, so
 * both observe and can mutate the SAME canonical game state, each strictly
 * through their own playerView. This is boardgame.io's own documented
 * pattern for simulating multiple players locally — not a parallel,
 * test-only state channel. Move validation is untouched: client1 can only
 * submit moves boardgame.io itself considers legal for player '1' right
 * now, exactly as client can only move for player '0'.
 */
export function createTestGame(spec: BoardPositionSpec): TestGame {
  const initialG = buildG(spec);

  const testGame = {
    ...ShadowkhanGame,
    setup: () => initialG,
    ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
  };

  const matchID = `test-${matchCounter++}`;

  const client = Client<ShadowkhanG>({
    game: testGame,
    numPlayers: 2,
    playerID: '0',
    matchID,
    multiplayer: Local(),
  });
  const client1 = Client<ShadowkhanG>({
    game: testGame,
    numPlayers: 2,
    playerID: '1',
    matchID,
    multiplayer: Local(),
  });

  client.start();
  client1.start();

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
    client1,
    G1: () => client1.getState()!.G,
  };
}
