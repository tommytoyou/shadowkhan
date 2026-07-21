import { INVALID_MOVE } from 'boardgame.io/core';
import type { Game } from 'boardgame.io';
import { CARDS, CARD_BY_LABEL } from './cards';
import type { ShadowkhanG } from './state';
import { syncCounts } from './state';

const ALL_LABELS = CARDS.map((c) => c.label);
const MAX_HAND_SIZE = 5;

export const ShadowkhanGame: Game<ShadowkhanG> = {
  name: 'shadowkhan',

  setup: ({ random }): ShadowkhanG => {
    const deck0 = random.Shuffle([...ALL_LABELS]);
    const deck1 = random.Shuffle([...ALL_LABELS]);

    const hand0 = deck0.splice(0, 3);
    const hand1 = deck1.splice(0, 3);

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
          const deck = G.secret.decks[pid];
          if (deck.length === 0) {
            G.public.loser = pid;
          } else {
            const card = deck.shift()!;
            hand.push(card);
            syncCounts(G);
          }
        }
      }
    },

    onEnd: ({ G, ctx }) => {
      const pid = ctx.currentPlayer;
      G.public.turnsTaken[pid] = (G.public.turnsTaken[pid] ?? 0) + 1;
    },
  },

  moves: {
    drawCard: {
      client: false,
      move: ({ G, ctx }) => {
        const pid = ctx.currentPlayer;
        const hand = G.secret.hands[pid];
        if (hand.length >= MAX_HAND_SIZE) return INVALID_MOVE;
        const deck = G.secret.decks[pid];
        if (deck.length === 0) return INVALID_MOVE;
        const card = deck.shift()!;
        hand.push(card);
        syncCounts(G);
      },
    },

    playCard: {
      client: false,
      move: ({ G, ctx }, handIndex: number, slot: number) => {
        const pid = ctx.currentPlayer;
        const hand = G.secret.hands[pid];
        if (handIndex < 0 || handIndex >= hand.length) return INVALID_MOVE;
        if (slot < 0 || slot >= 3) return INVALID_MOVE;
        if (G.public.field[pid][slot] !== null) return INVALID_MOVE;

        const label = hand[handIndex];
        const card = CARD_BY_LABEL[label];
        if (!card) return INVALID_MOVE;

        hand.splice(handIndex, 1);
        G.public.field[pid][slot] = {
          label,
          currentBp: card.bp ?? 0,
          attached: [],
        };
        syncCounts(G);
      },
    },

    attackBattleCard: {
      client: false,
      move: ({ G, ctx }, mySlot: number, theirSlot: number) => {
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        const defender = G.public.field[opp][theirSlot];
        if (!attacker || !defender) return INVALID_MOVE;

        G.public.attackedThisTurn = true;

        if (attacker.currentBp > defender.currentBp) {
          G.public.banished[opp].push(defender.label);
          G.public.field[opp][theirSlot] = null;
        } else if (attacker.currentBp < defender.currentBp) {
          G.public.banished[pid].push(attacker.label);
          G.public.field[pid][mySlot] = null;
        } else {
          // Shockwave: both lose top deck card face-down
          if (G.secret.decks[pid].length > 0) {
            G.secret.decks[pid].shift();
            G.public.banishedFaceDown[pid]++;
          }
          if (G.secret.decks[opp].length > 0) {
            G.secret.decks[opp].shift();
            G.public.banishedFaceDown[opp]++;
          }
          syncCounts(G);
        }
      },
    },

    attackHand: {
      client: false,
      move: ({ G, ctx }, mySlot: number, theirHandIndex: number) => {
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        if (!attacker) return INVALID_MOVE;

        const oppHand = G.secret.hands[opp];
        if (theirHandIndex < 0 || theirHandIndex >= oppHand.length) {
          return INVALID_MOVE;
        }

        G.public.attackedThisTurn = true;

        const removed = oppHand.splice(theirHandIndex, 1)[0];
        G.public.banished[opp].push(removed);
        syncCounts(G);
      },
    },

    attackDeck: {
      client: false,
      move: ({ G, ctx }, mySlot: number) => {
        const pid = ctx.currentPlayer;
        const opp = pid === '0' ? '1' : '0';

        if (G.public.attackedThisTurn) return INVALID_MOVE;
        if (G.public.turnsTaken[pid] < 1) return INVALID_MOVE;

        const attacker = G.public.field[pid][mySlot];
        if (!attacker) return INVALID_MOVE;

        if (G.secret.decks[opp].length === 0) return INVALID_MOVE;

        G.public.attackedThisTurn = true;

        const removed = G.secret.decks[opp].shift()!;
        G.public.banished[opp].push(removed);
        syncCounts(G);
      },
    },

    bottomUp: {
      client: false,
      move: ({ G, ctx }) => {
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
        const pid = ctx.currentPlayer;
        const hand = G.secret.hands[pid];
        if (handIndex < 0 || handIndex >= hand.length) return INVALID_MOVE;

        const [label] = hand.splice(handIndex, 1);
        G.public.banished[pid].push(label);
        syncCounts(G);
      },
    },

    endTurn: ({ events }) => {
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
