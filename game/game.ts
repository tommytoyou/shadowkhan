import { INVALID_MOVE } from 'boardgame.io/core';
import type { Game } from 'boardgame.io';
import { CARDS, CARD_BY_LABEL } from './cards';
import type { ShadowkhanG } from './state';
import { syncCounts } from './state';
import {
  fireTrigger,
  modifyBp,
  interceptHandOrDeckAttack,
  resolvePendingChoice,
  drawCardForPlayer,
  isPlayLegal,
  removeFieldCard,
  removeFromOpponentHand,
  removeOpponentDeckTop,
  removeOwnDeckTopFaceDown,
  discardOwnHandCard,
} from './effects';

const ALL_LABELS = CARDS.map((c) => c.label);
const MAX_HAND_SIZE = 5;

const DEV_MODE = true; // set false for normal shuffled play
const DEV_TEST_HAND: string[] = ['Sk-14', 'Sk-27', 'Sk-11'];

/** Pulls `labels` out of `deck` (mutating it) and returns them as a hand.
 *  Labels not found in the deck are skipped rather than crashing. */
function pullTestHand(deck: string[], labels: string[]): string[] {
  const hand: string[] = [];
  for (const label of labels) {
    const index = deck.indexOf(label);
    if (index === -1) continue;
    deck.splice(index, 1);
    hand.push(label);
  }
  return hand;
}

export const ShadowkhanGame: Game<ShadowkhanG> = {
  name: 'shadowkhan',

  setup: ({ random }): ShadowkhanG => {
    const deck0 = random.Shuffle([...ALL_LABELS]);
    const deck1 = random.Shuffle([...ALL_LABELS]);

    const hand0 = DEV_MODE ? pullTestHand(deck0, DEV_TEST_HAND) : deck0.splice(0, 3);
    const hand1 = DEV_MODE ? pullTestHand(deck1, DEV_TEST_HAND) : deck1.splice(0, 3);

    const G: ShadowkhanG = {
      secret: {
        decks: { '0': deck0, '1': deck1 },
        hands: { '0': hand0, '1': hand1 },
      },
      public: {
        deckCounts: { '0': 0, '1': 0 },
        handCounts: { '0': 0, '1': 0 },
        field: { '0': [null, null, null], '1': [null, null, null] },
        banished: { '0': [], '1': [] },
        banishedFaceDown: { '0': 0, '1': 0 },
        turnsTaken: { '0': 0, '1': 0 },
        bottomUpUsed: { '0': false, '1': false },
        attackedThisTurn: false,
        loser: null,
        rulesOfEngagementActive: false,
        pendingChoice: null,
      },
    };

    syncCounts(G);
    return G;
  },

  playerView: ({ G, playerID }) => {
    if (playerID === null || playerID === undefined) {
      return { ...G, secret: { decks: {}, hands: {} } };
    }
    return {
      ...G,
      secret: {
        decks: { [playerID]: G.secret.decks[playerID] ?? [] },
        hands: { [playerID]: G.secret.hands[playerID] ?? [] },
      },
    };
  },

  turn: {
    onBegin: ({ G, ctx }) => {
      G.public.attackedThisTurn = false;

      const pid = ctx.currentPlayer;
      const bothReady =
        G.public.turnsTaken['0'] >= 1 && G.public.turnsTaken['1'] >= 1;

      if (bothReady) {
        const hand = G.secret.hands[pid];
        if (hand.length < MAX_HAND_SIZE) {
          if (G.secret.decks[pid].length === 0) {
            G.public.loser = pid;
          } else {
            drawCardForPlayer(G, ctx, pid);
          }
        }
      }
    },

    onEnd: ({ G, ctx }) => {
      const pid = ctx.currentPlayer;
      G.public.turnsTaken[pid] = (G.public.turnsTaken[pid] ?? 0) + 1;
      for (const card of G.public.field[pid]) {
        if (card) card.turnsOnField += 1;
      }
    },
  },

  moves: {
    drawCard: {
      client: false,
      move: ({ G, ctx }) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        if (G.secret.hands[pid].length >= MAX_HAND_SIZE) return INVALID_MOVE;
        if (G.secret.decks[pid].length === 0) return INVALID_MOVE;
        drawCardForPlayer(G, ctx, pid);
      },
    },

    playCard: {
      client: false,
      move: ({ G, ctx }, handIndex: number, slot: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        const hand = G.secret.hands[pid];
        if (handIndex < 0 || handIndex >= hand.length) return INVALID_MOVE;
        if (slot < 0 || slot >= 3) return INVALID_MOVE;
        if (G.public.field[pid][slot] !== null) return INVALID_MOVE;

        const label = hand[handIndex];
        const card = CARD_BY_LABEL[label];
        if (!card) return INVALID_MOVE;
        if (!isPlayLegal(G, pid, label)) return INVALID_MOVE;

        hand.splice(handIndex, 1);
        G.public.field[pid][slot] = {
          label,
          currentBp: card.bp ?? 0,
          attached: [],
          turnsOnField: 0,
        };
        syncCounts(G);
        fireTrigger(G, ctx, 'onSummon', { pid, slot });
      },
    },

    attackBattleCard: {
      client: false,
      move: ({ G, ctx }, mySlot: number, theirSlot: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        const defender = G.public.field[opp][theirSlot];
        if (!attacker || !defender) return INVALID_MOVE;
        if (attacker.canAttack === false) return INVALID_MOVE;

        G.public.attackedThisTurn = true;

        if (attacker.currentBp > defender.currentBp) {
          if (!defender.protectedFromBattleCardRemoval) {
            removeFieldCard(G, ctx, opp, theirSlot, 'battle', {
              fireOnRemoved: true,
              afterRemoved: (G2, ctx2) => fireTrigger(G2, ctx2, 'onBattleWin', { pid, slot: mySlot }),
            });
          }
        } else if (attacker.currentBp < defender.currentBp) {
          if (G.public.rulesOfEngagementActive) {
            // RULES OF ENGAGEMENT (Sk-01): attacking a higher-BP card reduces
            // the defender's BP by the attacker's BP instead of removing the
            // attacker; the defender is only removed once its BP hits zero.
            modifyBp(defender, -attacker.currentBp);
            if (defender.currentBp <= 0 && !defender.protectedFromBattleCardRemoval) {
              removeFieldCard(G, ctx, opp, theirSlot, 'battle', { fireOnRemoved: true });
            }
          } else if (!attacker.protectedFromBattleCardRemoval) {
            removeFieldCard(G, ctx, pid, mySlot, 'battle', { fireOnRemoved: true });
          }
        } else {
          // Shockwave: both lose top deck card face-down
          removeOwnDeckTopFaceDown(G, pid);
          removeOwnDeckTopFaceDown(G, opp);
          syncCounts(G);
        }
      },
    },

    attackHand: {
      client: false,
      move: ({ G, ctx }, mySlot: number, theirHandIndex: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        if (!attacker) return INVALID_MOVE;
        if (attacker.canAttack === false) return INVALID_MOVE;

        const oppHand = G.secret.hands[opp];
        if (theirHandIndex < 0 || theirHandIndex >= oppHand.length) {
          return INVALID_MOVE;
        }

        G.public.attackedThisTurn = true;

        const targetLabel = oppHand[theirHandIndex];
        if (interceptHandOrDeckAttack(G, ctx, targetLabel, pid, mySlot)) {
          return;
        }

        removeFromOpponentHand(G, opp, theirHandIndex);
        syncCounts(G);
      },
    },

    attackHandRandom: {
      client: false,
      move: ({ G, ctx, random }, mySlot: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        if (!attacker) return INVALID_MOVE;
        if (attacker.canAttack === false) return INVALID_MOVE;

        const oppHand = G.secret.hands[opp];
        if (oppHand.length === 0) return INVALID_MOVE;

        G.public.attackedThisTurn = true;

        // random.Die(n) returns 1..n inclusive — subtract 1 for a 0-based index.
        const idx = random.Die(oppHand.length) - 1;
        removeFromOpponentHand(G, opp, idx);
        syncCounts(G);
      },
    },

    attackDeck: {
      client: false,
      move: ({ G, ctx }, mySlot: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        if (!attacker) return INVALID_MOVE;
        if (attacker.canAttack === false) return INVALID_MOVE;

        if (G.secret.decks[opp].length === 0) return INVALID_MOVE;

        G.public.attackedThisTurn = true;

        const targetLabel = G.secret.decks[opp][0];
        if (interceptHandOrDeckAttack(G, ctx, targetLabel, pid, mySlot)) {
          return;
        }

        removeOpponentDeckTop(G, opp);
        syncCounts(G);
      },
    },

    bottomUp: {
      client: false,
      move: ({ G, ctx }) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;

        if (G.public.bottomUpUsed[pid]) return INVALID_MOVE;
        if (G.public.deckCounts[pid] > 10) return INVALID_MOVE;

        const deck = G.secret.decks[pid];
        if (deck.length < 2) return INVALID_MOVE;

        const bottom = deck.pop()!;
        deck.unshift(bottom);
        G.public.bottomUpUsed[pid] = true;
        syncCounts(G);
      },
    },

    banishFromHand: {
      client: false,
      move: ({ G, ctx }, handIndex: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        if (handIndex < 0 || handIndex >= G.secret.hands[pid].length) return INVALID_MOVE;

        discardOwnHandCard(G, pid, handIndex);
        syncCounts(G);
      },
    },

    activateAbility: {
      client: false,
      move: ({ G, ctx }, cardFieldIndex: number) => {
        if (G.public.pendingChoice) return INVALID_MOVE;
        const pid = ctx.currentPlayer;
        if (cardFieldIndex < 0 || cardFieldIndex >= 3) return INVALID_MOVE;

        const card = G.public.field[pid][cardFieldIndex];
        if (!card) return INVALID_MOVE;
        if (card.activated) return INVALID_MOVE;

        card.activated = true;
        fireTrigger(G, ctx, 'onActivate', { pid, slot: cardFieldIndex });
      },
    },

    resolveChoice: {
      client: false,
      move: ({ G, ctx }, answer: number | boolean) => {
        const pending = G.public.pendingChoice;
        if (!pending) return INVALID_MOVE;
        if (pending.pid !== ctx.currentPlayer) return INVALID_MOVE;
        if (!resolvePendingChoice(G, ctx, answer)) return INVALID_MOVE;
      },
    },

    endTurn: ({ G, events }) => {
      if (G.public.pendingChoice) return INVALID_MOVE;
      events.endTurn();
    },
  },

  endIf: ({ G }) => {
    if (G.public.loser !== null) {
      const winner = G.public.loser === '0' ? '1' : '0';
      return { winner };
    }
    return undefined;
  },
};
