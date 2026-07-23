import { describe, expect, test } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createTestGame } from './helpers';
import { ShadowkhanGame } from '../game';
import type { ShadowkhanG } from '../state';

describe('Sk-11 CHOSEN CONDUIT', () => {
  test('1. playing Sk-11 with two own Battle Cards opens an ownField choice listing both', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14', 'Sk-27'], hand: ['Sk-11'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2); // play Sk-11 into the empty slot

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('ownField');
    expect(pending?.sourceLabel).toBe('Sk-11');
    expect(pending?.options).toEqual([0, 1]);
  });

  test('2. choosing Sk-14 opens a yesNo confirm naming the field wipe', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14', 'Sk-27'], hand: ['Sk-11'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(0); // choose slot 0 (Sk-14)

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.prompt).toContain('ONE EYED MECHANICAL MONSTER');
    expect(pending?.prompt).toContain('removes every card from your field');
  });

  test('3. answering No cancels: Sk-14 stays BP 8, all cards remain, choice clears, player can still act', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14', 'Sk-27'], hand: ['Sk-11'], deck: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(0);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-14');
    expect(G().public.field['0'][0]?.currentBp).toBe(8);
    expect(G().public.field['0'][1]?.label).toBe('Sk-27');
    expect(G().public.field['0'][1]?.currentBp).toBe(5);
    expect(G().public.field['0'][2]?.label).toBe('Sk-11');
    expect(G().public.banished['0']).toEqual([]);

    // Player can still act: a legal, otherwise-unrelated move goes through.
    client.moves.bottomUp();
    expect(G().public.bottomUpUsed['0']).toBe(true);
  });

  test('4. answering Yes: Sk-14 becomes BP 13, every own field slot empties, all three cards are banished', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14', 'Sk-27'], hand: ['Sk-11'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(0); // choose Sk-14
    client.moves.resolveChoice(true); // confirm the wipe

    expect(G().public.field['0']).toEqual([null, null, null]);
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-14', 'Sk-27', 'Sk-11']));
    expect(G().public.banished['0']).toHaveLength(3);
    expect(G().public.pendingChoice).toBeNull();
  });

  // UPDATED this pass: Sk-11a's "can only play with 2+ Battle Cards" is now
  // enforced via PLAY_GATES (matching Sk-03a/08a/10a/16a), so playing it
  // with only one is now a rejected INVALID_MOVE rather than a card that
  // gets placed and silently does nothing. Previously this test asserted
  // the OLD (inconsistent) behavior: field['0'][1]?.label === 'Sk-11' (card
  // placed) and no other assertion on the hand. Both now change: the card
  // is never placed, and stays in hand.
  test('5. with only one own Battle Card, playing Sk-11 is rejected (INVALID_MOVE): card stays in hand, field unchanged', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], hand: ['Sk-11'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // play Sk-11 into slot 1

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-14');
    expect(G().public.field['0'][0]?.currentBp).toBe(8);
    expect(G().public.field['0'][1]).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-11']);
    expect(G().public.banished['0']).toEqual([]);
  });
});

describe('Sk-14a ONE EYED MECHANICAL MONSTER', () => {
  test('6. opponent field has one Battle Card: prompt opens and resolving removes it', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-14'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0);

    const yesNo = G().public.pendingChoice;
    expect(yesNo).not.toBeNull();
    expect(yesNo?.kind).toBe('yesNo');

    client.moves.resolveChoice(true);

    const target = G().public.pendingChoice;
    expect(target).not.toBeNull();
    expect(target?.kind).toBe('opponentField');
    expect(target?.options).toEqual([0]);

    client.moves.resolveChoice(0);

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
    expect(G().public.pendingChoice).toBeNull();
  });

  test('7. opponent field empty: no prompt should open', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-14'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-25a BATTLE SHOCK SCORPION', () => {
  test('8. winning a battle opens a yesNo; answering Yes removes the top card of the opponent deck', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25'], turnsTaken: 1 },
        '1': { field: ['Sk-29'], deck: ['Sk-01', 'Sk-02'] },
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-25 (BP6) beats Sk-29 (BP4)

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');

    client.moves.resolveChoice(true);

    expect(G().public.deckCounts['1']).toBe(1);
    expect(G().public.banished['1']).toEqual(expect.arrayContaining(['Sk-29', 'Sk-01']));
    expect(G().public.pendingChoice).toBeNull();
  });

  test('9. opponent deck empty: winning the battle opens no prompt', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25'], turnsTaken: 1 },
        '1': { field: ['Sk-29'], deck: [] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-14b ONE EYED MECHANICAL MONSTER (onBattleWin)', () => {
  test('10. winning a battle opens the chained prompt; choosing the deck option removes their top deck card', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { field: ['Sk-29'], hand: ['Sk-03'], deck: ['Sk-02', 'Sk-04'] },
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-14 (BP8) beats Sk-29 (BP4)

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');

    const yesNo = G().public.pendingChoice;
    expect(yesNo).not.toBeNull();
    expect(yesNo?.kind).toBe('yesNo');

    client.moves.resolveChoice(true);

    const source = G().public.pendingChoice;
    expect(source).not.toBeNull();
    expect(source?.kind).toBe('chooseAbility');
    expect(source?.options).toEqual([0, 1]);

    client.moves.resolveChoice(1); // choose the deck option

    expect(G().public.deckCounts['1']).toBe(1);
    expect(G().public.banished['1']).toEqual(expect.arrayContaining(['Sk-29', 'Sk-02']));
    expect(G().public.handCounts['1']).toBe(1); // hand untouched
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-05a DIVINE SKY STRIKE', () => {
  test('11. opponent field holds a Battle Card: Sk-05 fires and removes it', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.options).toEqual([0]);

    client.moves.resolveChoice(0);

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
    expect(G().public.pendingChoice).toBeNull();
  });

  test('12. opponent field empty: Sk-05 resolves silently, no prompt opens', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-05');
  });
});

describe('Sk-24a BLAZING SKY GOBLIN', () => {
  test('13. Sand Squid on own field and A Sinister Alliance in deck: fires and adds it to hand', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], hand: ['Sk-24'], deck: ['Sk-08', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // play Sk-24 into slot 1 (Sk-21 already in slot 0)

    const yesNo = G().public.pendingChoice;
    expect(yesNo).not.toBeNull();
    expect(yesNo?.kind).toBe('yesNo');

    client.moves.resolveChoice(true);

    // Named search over a singleton deck: exactly one match, so it applies
    // immediately — no second prompt.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.deckCounts['0']).toBe(1);
    expect(G().public.handCounts['0']).toBe(1);
    expect(G().secret.hands['0']).toEqual(['Sk-08']);
  });

  test("14. deck has no A Sinister Alliance: resolves silently, no prompt opens", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], hand: ['Sk-24'], deck: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.handCounts['0']).toBe(0);
    expect(G().public.deckCounts['0']).toBe(2);
  });

  test('15. deck search never leaks the opponent\'s deck (order or contents) into this payload', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], hand: ['Sk-24'], deck: ['Sk-08', 'Sk-27'] },
        '1': { field: [], hand: ['Sk-29'], deck: ['Sk-02', 'Sk-03', 'Sk-04'] },
      },
    });

    client.moves.playCard(0, 1);

    // yesNo carries no numeric options at all, so nothing deck-derived is on
    // the public choice; and the opponent's own secret zones are absent from
    // this (player '0') client's payload throughout, per playerView.
    expect(G().public.pendingChoice?.kind).toBe('yesNo');
    expect(G().public.pendingChoice?.options).toBeNull();
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();
    expect(G().secret.hands['0']).toContain('Sk-08');
  });
});

describe('Sk-20b SAGE OF DARK OMEN (onActivate)', () => {
  test('16. activating on the field removes it and pulls Arrival Of Doom to hand', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], deck: ['Sk-03', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-20');
    expect(G().secret.hands['0']).toEqual(['Sk-03']);
    expect(G().public.deckCounts['0']).toBe(1);
  });

  test('17. no Arrival Of Doom in deck: field removal still happens, search resolves silently', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], deck: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-20');
    expect(G().public.handCounts['0']).toBe(0);
    expect(G().public.deckCounts['0']).toBe(2);
  });
});

describe('Sk-23a PORTAL MONARCH (onActivate)', () => {
  test('18. discard a Battle card (choosing among two) and retrieve a Battle card from deck', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-23'], hand: ['Sk-29', 'Sk-27'], deck: ['Sk-22', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Two hand cards both qualify (any type is eligible) -> a real choice,
    // exercising dispatchSearch's "more than one match" branch for the
    // first time.
    const discardChoice = G().public.pendingChoice;
    expect(discardChoice).not.toBeNull();
    expect(discardChoice?.kind).toBe('chooseAbility');
    expect(discardChoice?.options).toEqual([0, 1]);

    client.moves.resolveChoice(0); // discard Sk-29 (Battle) at hand index 0

    // Deck retrieve step: exactly one Battle card (Sk-22) in the deck, so it
    // applies immediately with no second prompt.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-29');
    expect(G().secret.hands['0']).toEqual(['Sk-27', 'Sk-22']);
    expect(G().public.deckCounts['0']).toBe(1);
    expect(G().public.handCounts['0']).toBe(2);
  });

  test('19. no matching type in deck: discard is handled sanely, retrieve resolves silently', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-23'], hand: ['Sk-29'], deck: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Single hand card: discard auto-resolves with no prompt either.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-29');
    expect(G().public.handCounts['0']).toBe(0);
    expect(G().public.deckCounts['0']).toBe(2);
  });

  test("20. deck search never leaks the opponent's secret hand/deck, during or after activation", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-23'], hand: ['Sk-29', 'Sk-27'], deck: ['Sk-22', 'Sk-01'] },
        '1': { field: [], hand: ['Sk-30'], deck: ['Sk-02', 'Sk-03', 'Sk-04'] },
      },
    });

    client.moves.activateAbility(0);

    expect(G().public.pendingChoice?.kind).toBe('chooseAbility');
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();

    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();
    expect(G().secret.hands['0']).toContain('Sk-22');
  });
});

describe('activateAbility guards', () => {
  test("21. rejected when it isn't the acting player's turn", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [] },
        '1': { field: ['Sk-23'], hand: ['Sk-29'], deck: ['Sk-01'] },
      },
      currentPlayer: '1',
    });

    // This client is playerID '0'; it's player 1's turn, so the move must
    // be rejected before it ever reaches the reducer.
    client.moves.activateAbility(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]?.activated).toBeFalsy();
    expect(G().public.field['1'][0]?.label).toBe('Sk-23');
  });

  test("22. rejected when the card isn't on the acting player's field", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0); // slot 0 is empty

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0']).toEqual([null, null, null]);
  });

  test('23. rejected on a second activation of the same card', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-23'], hand: ['Sk-29'], deck: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);
    expect(G().public.field['0'][0]?.activated).toBe(true);
    const afterFirst = JSON.parse(JSON.stringify(G()));

    client.moves.activateAbility(0); // already activated — must be a no-op

    expect(G()).toEqual(afterFirst);
  });
});

describe('Sk-07b ACE IN THE HOLE (onDraw)', () => {
  test('24. normal draw (deck still has cards after) opens a yesNo; answering Yes moves it to the bottom of the deck', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07', 'Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-07');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual([]);
    expect(G().secret.decks['0']).toEqual(['Sk-01', 'Sk-02', 'Sk-07']);
    expect(G().public.deckCounts['0']).toBe(3);
    expect(G().public.handCounts['0']).toBe(0);
  });

  test('25. drawing it as the last card in the deck: branch a applies instead, resolves silently', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07'] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-07']);
    expect(G().public.deckCounts['0']).toBe(0);
  });

  test('26. drawCard fires onDraw exactly once; declining leaves the card in hand with no re-trigger', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.abilitySlot).toBe('b-confirm');

    client.moves.resolveChoice(false);

    // No re-trigger: pendingChoice stays null, the card is simply in hand.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-07']);
    expect(G().public.deckCounts['0']).toBe(1);
  });

  test("27. deck search never leaks the opponent's secret hand/deck, during or after onDraw resolution", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07', 'Sk-01', 'Sk-02'] },
        '1': { field: [], hand: ['Sk-30'], deck: ['Sk-03', 'Sk-04'] },
      },
    });

    client.moves.drawCard();

    expect(G().public.pendingChoice?.kind).toBe('yesNo');
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();
    expect(G().secret.decks['0']).toEqual(['Sk-01', 'Sk-02', 'Sk-07']);
  });

  test('28. the opening-hand deal does not fire onDraw', () => {
    // createTestGame swaps out setup() entirely (so tests can seed an exact
    // board), which necessarily bypasses the real opening-hand deal. Boot
    // the actual ShadowkhanGame here instead to exercise the real setup().
    const realClient = Client({ game: ShadowkhanGame, numPlayers: 2, playerID: '0' });
    realClient.start();

    expect(realClient.getState()!.G.public.pendingChoice).toBeNull();
  });
});

describe('Sk-03a play gate (Sage of Dark Omen on field)', () => {
  test('29. condition met: Sk-03 plays normally', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-03'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.field['0'][1]?.label).toBe('Sk-03');
    expect(G().secret.hands['0']).toEqual([]);
  });

  test('30. condition not met: rejected, hand and field unchanged, no pendingChoice', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-03'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.field['0']).toEqual([null, null, null]);
    expect(G().secret.hands['0']).toEqual(['Sk-03']);
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-08a play gate (an ally on field)', () => {
  test('31. condition met: Sk-08 plays normally', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], hand: ['Sk-08'] }, // Sk-21 = Sand Squid
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.field['0'][1]?.label).toBe('Sk-08');
    expect(G().secret.hands['0']).toEqual([]);
  });

  test('32. condition not met: rejected, hand and field unchanged, no pendingChoice', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-27'], hand: ['Sk-08'] }, // Sk-27 is not one of the three allies
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.field['0'][1]).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-08']);
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-10a play gate (One Eyed Mechanical Monster on field)', () => {
  test('33. condition met: Sk-10 plays normally and its ability fires', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], hand: ['Sk-10'] },
        '1': { field: ['Sk-29'] }, // BP 4, eligible (<=7)
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.field['0'][1]?.label).toBe('Sk-10');
    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.options).toEqual([0]);
  });

  test('34. condition not met: rejected, hand and field unchanged, no pendingChoice', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-10'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.field['0']).toEqual([null, null, null]);
    expect(G().secret.hands['0']).toEqual(['Sk-10']);
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-16a play gate (removed-card BP thresholds on both sides)', () => {
  test('35. condition met: Sk-16 plays normally and its ability fires', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-16'], banished: ['Sk-14', 'Sk-15'] }, // BP 8, BP 7 — two
        '1': { field: [], banished: ['Sk-14'] }, // BP 8 — at least one
      },
    });

    client.moves.playCard(0, 0);

    const card = G().public.field['0'][0];
    expect(card?.label).toBe('Sk-16');
    expect(card?.protectedFromBattleCardRemoval).toBe(true);
    expect(G().secret.hands['0']).toEqual([]);
  });

  test('36. condition not met (opponent has no qualifying removed card): rejected, hand and field unchanged, no pendingChoice', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-16'], banished: ['Sk-14', 'Sk-15'] },
        '1': { field: [], banished: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.field['0']).toEqual([null, null, null]);
    expect(G().secret.hands['0']).toEqual(['Sk-16']);
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('play-legality gate: ungated cards unaffected', () => {
  test('37. a card with no PLAY_GATES entry plays exactly as before', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-27'] }, // Crimson She-Knight — no gate
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.field['0'][0]?.label).toBe('Sk-27');
    expect(G().secret.hands['0']).toEqual([]);
  });
});

describe('Sk-15b SHADOW GHOST (removal replacement)', () => {
  // resolveChoice can only be answered by pendingChoice.pid, and it's the
  // OWNER of the threatened card who decides whether to use the
  // replacement — not the attacker. Our single test client is always
  // playerID '0', so these use the "attacker loses" battle branch (player
  // 0's own Sk-15 attacks and loses) rather than player 0 attacking into a
  // defender it doesn't own, which would open a choice only player 1 could
  // answer.
  test('38. removed by battle: hook fires; answering Yes returns it to hand instead of banishing it', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15'], turnsTaken: 1 }, // BP 7 attacker — will lose
        '1': { field: ['Sk-14'] }, // BP 8 defender
      },
    });

    client.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-15');
    // Nothing has happened to the card yet — it's still on the field.
    expect(G().public.field['0'][0]?.label).toBe('Sk-15');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).not.toContain('Sk-15');
    expect(G().public.handCounts['0']).toBe(1);
    expect(G().secret.hands['0']).toEqual(['Sk-15']);
  });

  test('39. declining Yes: normal removal proceeds (banished)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15'], turnsTaken: 1 },
        '1': { field: ['Sk-14'] },
      },
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-15');
  });

  test("40. no-trigger case: removed by an ability (not battle) — hook does not apply, removal proceeds normally", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: ['Sk-15'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-05 DIVINE SKY STRIKE — ability removal, cause 'ability'

    const pending = G().public.pendingChoice;
    expect(pending?.sourceLabel).toBe('Sk-05'); // Sk-05's own target choice, not Sk-15's hook
    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-15');
  });
});

describe('Sk-19a THE HEADLESS HORSEMAN (removal replacement, once only)', () => {
  test('41. removed by battle: hook fires; answering Yes keeps it on the field and marks the once-only use', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-19'], turnsTaken: 1 }, // BP 5 attacker — will lose
        '1': { field: ['Sk-14'] }, // BP 8 defender
      },
    });

    client.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-19');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-19');
    expect(G().public.field['0'][0]?.replacementUsed).toBe(true);
    expect(G().public.banished['0']).not.toContain('Sk-19');
  });

  test('42. declining Yes: normal removal proceeds (banished)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-19'], turnsTaken: 1 },
        '1': { field: ['Sk-14'] },
      },
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-19');
  });

  test('43. no-trigger case: once-only use already spent — removal proceeds normally, no prompt', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { field: [{ label: 'Sk-19', replacementUsed: true }] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-19');
  });
});

describe('Sk-25b BATTLE SHOCK SCORPION (removal replacement, hand cost)', () => {
  test('44. removed by battle with an Action Card in hand: hook fires; Yes pays the cost face down and survives', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25'], hand: ['Sk-08'], turnsTaken: 1 }, // Sk-08 = an Action Card
        '1': { field: ['Sk-16'] }, // BP 9 — Sk-25 (BP 6) loses as attacker
      },
    });

    client.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-25');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-25');
    expect(G().public.banished['0']).not.toContain('Sk-25');
    expect(G().public.banished['0']).not.toContain('Sk-08'); // paid face down, label never revealed
    expect(G().public.handCounts['0']).toBe(0);
    expect(G().public.banishedFaceDown['0']).toBe(1);
  });

  test('45. declining Yes: normal removal proceeds (banished)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25'], hand: ['Sk-08'], turnsTaken: 1 },
        '1': { field: ['Sk-16'] },
      },
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-25');
  });

  test('46. no-trigger case: no Action Card in hand to pay with — removal proceeds normally, no prompt', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25'], hand: [], turnsTaken: 1 },
        '1': { field: ['Sk-16'] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-25');
  });
});

describe('removal funneling: cross-cutting regressions', () => {
  test('47. onRemoved still fires exactly once on an ordinary battle-loss removal', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1, deck: ['Sk-01', 'Sk-02', 'Sk-03'] }, // BP 8 attacker
        '1': { field: [{ label: 'Sk-17', turnsOnField: 2 }] }, // BP 3, no gate/hook — onRemoved removes 2 of the OPPONENT's (attacker's) top deck cards
      },
    });

    client.moves.attackBattleCard(0, 0);

    // No hook on Sk-17 — this must complete synchronously, no pendingChoice.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-17');
    // onRemoved fired exactly once: exactly 2 cards removed (turnsOnField),
    // not 0 (never fired) or 4 (fired twice).
    expect(G().secret.decks['0']).toEqual(['Sk-03']);
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-01', 'Sk-02']));
    expect(G().public.banished['0']).toHaveLength(2);
  });

  test('48. Shockwave tie still removes from both decks face down; neither field card is removed', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-27'], deck: ['Sk-01', 'Sk-02'], turnsTaken: 1 }, // BP 5
        '1': { field: ['Sk-19'], deck: ['Sk-03', 'Sk-04'] }, // BP 5 — tie
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-27');
    expect(G().public.field['1'][0]?.label).toBe('Sk-19');
    expect(G().public.deckCounts['0']).toBe(1);
    expect(G().public.deckCounts['1']).toBe(1);
    expect(G().public.banishedFaceDown['0']).toBe(1);
    expect(G().public.banishedFaceDown['1']).toBe(1);
    // Face down: no label revealed into the public banished pile.
    expect(G().public.banished['0']).toEqual([]);
    expect(G().public.banished['1']).toEqual([]);
  });

  // UPDATED this pass, per the designer's ruling (NO CARD IS UNBANISHABLE):
  // protectedFromBattleCardRemoval now protects ONLY against ability-driven
  // removal, never an ordinary BP battle loss. This test previously
  // asserted the OLD (now-corrected) behavior — that the flag blocked
  // combat removal — via field['1'][0]?.label === 'Sk-16' (unremoved) and
  // banished['1'] NOT containing it. Both assertions now flip: a protected
  // card that loses a battle is banished normally, same as an unprotected
  // one.
  test('49. Sk-16 protectedFromBattleCardRemoval does NOT block an ordinary battle loss', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 }, // BP 8
        '1': { field: [{ label: 'Sk-16', currentBp: 3, protectedFromBattleCardRemoval: true }] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-16');
  });

  test('49b. Sk-16 protectedFromBattleCardRemoval DOES block an ability-driven removal', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: [{ label: 'Sk-16', protectedFromBattleCardRemoval: true }] },
      },
    });

    client.moves.playCard(0, 0); // Sk-05
    client.moves.resolveChoice(0); // target Sk-16

    expect(G().public.field['1'][0]?.label).toBe('Sk-16'); // still there, unremoved
    expect(G().public.banished['1']).not.toContain('Sk-16');
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-12 CURSE OF STONE (persistent lock)', () => {
  test('50. locks the target: it cannot be attacked while the lock is active', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], hand: ['Sk-12'], turnsTaken: 1 },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 1); // Sk-12 into slot 1

    const pending = G().public.pendingChoice;
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.options).toEqual([0]);

    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    const effects = G().public.activeEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ targetPid: '1', targetSlot: 0, sourcePid: '0', sourceSlot: 1 });
    expect(effects[0].kinds).toEqual(
      expect.arrayContaining(['cannotAttack', 'cannotBeAttacked', 'cannotUseEffects'])
    );

    client.moves.attackBattleCard(0, 0); // Sk-14 attacks the locked Sk-29 — must be rejected

    expect(G().public.attackedThisTurn).toBe(false);
    expect(G().public.field['1'][0]?.label).toBe('Sk-29');
    expect(G().public.banished['1']).not.toContain('Sk-29');
  });

  test('51. locks every other card sharing the selected BP too', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-12'] },
        '1': { field: ['Sk-29', 'Sk-23'] }, // both BP 4
      },
    });

    client.moves.playCard(0, 0);
    client.moves.resolveChoice(0); // select Sk-29 (BP 4) at slot 0

    const targets = G()
      .public.activeEffects.map((e) => e.targetSlot)
      .sort();
    expect(targets).toEqual([0, 1]);
  });

  test("52. the lock expires at the end of the stated duration (opponent's next turn)", () => {
    const { G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 0 },
        '1': { field: ['Sk-29'], turnsTaken: 0 },
      },
      // Dispatches exactly one endTurn (player 0's) during setup, crossing
      // the seeded expiry threshold below.
      currentPlayer: '1',
      activeEffects: [
        {
          kinds: ['cannotAttack', 'cannotBeAttacked', 'cannotUseEffects'],
          targetPid: '1',
          targetSlot: 0,
          sourceLabel: 'Sk-12',
          sourcePid: '0',
          sourceSlot: 1,
          expiresAtGlobalTurn: 1,
        },
      ],
    });

    expect(G().public.activeEffects).toEqual([]);
  });

  test('53. the lock ends when its source (Sk-12) is removed from the field', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-12'], // BP 0 (power card) — will lose any battle
          turnsTaken: 1,
        },
        '1': { field: ['Sk-29'] }, // BP 4
      },
      // Seed as if Sk-12 had already locked something — targeting an empty
      // slot (1) rather than the Sk-29 we're about to attack, so this
      // doesn't interfere with the attack that removes Sk-12 itself; only
      // that the effect is sourced from Sk-12's own slot matters here.
      activeEffects: [
        {
          kinds: ['cannotAttack', 'cannotBeAttacked', 'cannotUseEffects'],
          targetPid: '1',
          targetSlot: 1,
          sourceLabel: 'Sk-12',
          sourcePid: '0',
          sourceSlot: 0,
        },
      ],
    });

    client.moves.attackBattleCard(0, 0); // Sk-12 (BP 0) attacks and loses

    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-12');
    expect(G().public.activeEffects).toEqual([]);
  });
});

describe('Sk-22a GARGOYLE THE WICKED (persistent lock, retrofit)', () => {
  test('54. playing it locks the adjacent opponent card (cannot attack)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-22'] },
        '1': { field: [null, 'Sk-29'], deck: ['Sk-01'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-22 into slot 0 — adjacent slot is 1

    const effects = G().public.activeEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      targetPid: '1',
      targetSlot: 1,
      sourcePid: '0',
      sourceSlot: 0,
      sourceLabel: 'Sk-22',
    });
    expect(effects[0].kinds).toEqual(['cannotAttack']);
    expect(effects[0].expiresAtGlobalTurn).toBeUndefined(); // "while this card is on the field" — no turn duration
  });

  test('55. a card locked by the adjacency effect cannot attack', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-14'],
          turnsTaken: 1,
        },
        '1': { field: ['Sk-29'] },
      },
      // Seed as if an opponent's Gargoyle had already locked player 0's Sk-14.
      activeEffects: [
        {
          kinds: ['cannotAttack'],
          targetPid: '0',
          targetSlot: 0,
          sourceLabel: 'Sk-22',
          sourcePid: '1',
          sourceSlot: 0,
        },
      ],
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.attackedThisTurn).toBe(false);
    expect(G().public.field['1'][0]?.label).toBe('Sk-29');
  });

  test('56. the lock ends when Gargoyle itself is removed from the field (stale-aura fix)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-22'], turnsTaken: 1 }, // BP 6
        '1': { field: ['Sk-16'] }, // BP 9 — Gargoyle will lose
      },
      activeEffects: [
        {
          kinds: ['cannotAttack'],
          targetPid: '1',
          targetSlot: 0,
          sourceLabel: 'Sk-22',
          sourcePid: '0',
          sourceSlot: 0,
        },
      ],
    });

    client.moves.attackBattleCard(0, 0); // Sk-22 (BP 6) attacks and loses

    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-22');
    expect(G().public.activeEffects).toEqual([]);
  });
});

describe('persistent effects: unaffected actions are unchanged', () => {
  test('57. an active lock on one card does not affect an unrelated attack on a different card', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { field: ['Sk-29', 'Sk-27'] }, // slot 0 locked below, slot 1 is not
      },
      activeEffects: [
        {
          kinds: ['cannotBeAttacked'],
          targetPid: '1',
          targetSlot: 0,
          sourceLabel: 'Sk-12',
          sourcePid: '0',
          sourceSlot: 1,
        },
      ],
    });

    client.moves.attackBattleCard(0, 1); // attack slot 1 (Sk-27), the unlocked card

    expect(G().public.field['1'][1]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-27');
    // The unrelated lock on slot 0 is untouched by this attack.
    expect(G().public.field['1'][0]?.label).toBe('Sk-29');
    expect(G().public.activeEffects).toHaveLength(1);
  });
});

describe('Sk-13 MYSTICAL BLUE FLAME POWER CARD (timed BP effects)', () => {
  test('58. branch 0: +1 BP applies immediately, then reverts at the end of the activating turn and does not persist beyond it', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-27'], hand: ['Sk-13'] }, // Sk-27: BP 5, eligible (<=6)
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // Sk-13 into slot 1
    client.moves.resolveChoice(0); // branch 0: +1 BP buff
    client.moves.resolveChoice(0); // target slot 0 (Sk-27)

    // Applies immediately.
    expect(G().public.field['0'][0]?.currentBp).toBe(6);
    const effects = G().public.activeEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      kinds: ['bpModifier'],
      targetPid: '0',
      targetSlot: 0,
      sourceLabel: 'Sk-13',
      onExpire: { kind: 'revertDelta', bpDelta: 1 },
    });

    client.moves.endTurn(); // ends the activating player's own turn — the stated expiry

    expect(G().public.field['0'][0]?.currentBp).toBe(5); // reverted, does not persist
    expect(G().public.activeEffects).toEqual([]);
  });

  test('59. branch 1: restoring to original BP does NOT happen immediately', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-27', currentBp: 3 }], hand: ['Sk-13'] }, // printed BP 5, currently 3
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // Sk-13 into slot 1
    client.moves.resolveChoice(1); // branch 1: restore
    client.moves.resolveChoice(0); // target slot 0 (Sk-27)

    // NOT applied yet — the restoration itself is the delayed event.
    expect(G().public.field['0'][0]?.currentBp).toBe(3);
    const effects = G().public.activeEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      kinds: ['bpModifier'],
      targetPid: '0',
      targetSlot: 0,
      sourceLabel: 'Sk-13',
      onExpire: { kind: 'restoreOriginal' },
    });
  });

  test('60. branch 1: restore fires at the stated time (end of the opponent\'s next turn), a longer window than branch 0', () => {
    const { G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-27', currentBp: 3 }], turnsTaken: 1 },
        '1': { field: [], turnsTaken: 0 },
      },
      // Dispatches exactly one endTurn (player 0's) during setup. Starting
      // turnsTaken at 1 means that single crossing reaches globalTurns 2,
      // matching expiresAtGlobalTurn below (calibrated as if Sk-13 had been
      // activated back when globalTurns was 0 — the real "+2" formula).
      currentPlayer: '1',
      activeEffects: [
        {
          kinds: ['bpModifier'],
          targetPid: '0',
          targetSlot: 0,
          sourceLabel: 'Sk-13',
          sourcePid: '0',
          sourceSlot: 1,
          expiresAtGlobalTurn: 2,
          onExpire: { kind: 'restoreOriginal' },
        },
      ],
    });

    expect(G().public.field['0'][0]?.currentBp).toBe(5); // restored to printed BP
    expect(G().public.activeEffects).toEqual([]);
  });
});

describe('Sk-15a SHADOW GHOST (removal immunity)', () => {
  // UPDATED this pass, per the designer's ruling (NO CARD IS UNBANISHABLE):
  // protectedFromBattleCardRemoval now protects ONLY against ability-driven
  // removal. Tests 61-62 previously asserted the reverse (combat blocked,
  // ability-driven removal succeeded) — both flip. Test 61 is rewritten to
  // play Sk-15 through playCard (a real onSummon-fired flag, not seeded)
  // and lose an ordinary battle, landing on Sk-15b's now-reachable
  // return-to-hand hook — this is also the "real play-then-battle path"
  // case Step 4 asks for, since tests 38-40 only ever seed Sk-15 directly.
  test('61. a Battle Card (combat) removal is NOT blocked — it reaches Sk-15b\'s return-to-hand hook', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-15'], turnsTaken: 1 },
        '1': { field: ['Sk-16'] }, // BP 9 — Sk-15 (BP 7) loses as the attacker
      },
    });

    client.moves.playCard(0, 0); // Sk-15 into slot 0 — fires onSummon
    expect(G().public.field['0'][0]?.protectedFromBattleCardRemoval).toBe(true);

    client.moves.attackBattleCard(0, 0);

    // protectedFromBattleCardRemoval does not stop this — it's a battle
    // loss, so Sk-15b's hook opens instead of a silent block.
    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-15');

    client.moves.resolveChoice(true); // return to hand instead of banishing

    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).not.toContain('Sk-15');
    expect(G().secret.hands['0']).toEqual(['Sk-15']);
  });

  test('62. a non-Battle-Card (ability) removal IS blocked', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] }, // Divine Sky Strike — an Action Card ability
        '1': { field: [{ label: 'Sk-15', protectedFromBattleCardRemoval: true }] },
      },
    });

    client.moves.playCard(0, 0); // Sk-05
    client.moves.resolveChoice(0); // target Sk-15

    expect(G().public.field['1'][0]?.label).toBe('Sk-15'); // still there, unremoved
    expect(G().public.banished['1']).not.toContain('Sk-15');
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-20a SAGE OF DARK OMEN (multi-select)', () => {
  test('63b. a full valid multi-select resolves correctly: exact-3 hand cost, then up-to-2 deck removal', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-20'],
          hand: ['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27'], // 4 candidates for an exact-3 cost — a real choice
          deck: ['Sk-14', 'Sk-15', 'Sk-17'], // Sk-14 (BP8), Sk-15 (BP7) qualify; Sk-17 (BP3) doesn't
        },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Effect b fires unconditionally in the same dispatch (already-live
    // behavior) — Sk-20 is removed from the field immediately, and effect
    // a's yesNo survives that untouched (see the wiring comment for why).
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-20');
    const confirm = G().public.pendingChoice;
    expect(confirm?.kind).toBe('yesNo');
    expect(confirm?.sourceLabel).toBe('Sk-20');

    client.moves.resolveChoice(true);

    // Hand-cost step: 4 candidates for an exact 3 — a real multi-select.
    const handStep = G().public.pendingChoice;
    expect(handStep?.kind).toBe('chooseAbility');
    expect(handStep?.options).toEqual([0, 1, 2, 3]);
    expect(handStep?.multi).toEqual({ count: 3, exact: true, selected: [] });

    client.moves.resolveChoice(0); // pick 1 of 3
    expect(G().public.pendingChoice?.multi?.selected).toEqual([0]);
    expect(G().secret.hands['0']).toHaveLength(4); // nothing removed yet — still accumulating

    client.moves.resolveChoice(1); // pick 2 of 3
    expect(G().public.pendingChoice?.multi?.selected).toEqual([0, 1]);

    client.moves.resolveChoice(2); // pick 3 of 3 — auto-finalizes

    // Hand cost applied: Sk-01, Sk-02, Sk-04 discarded, Sk-27 remains.
    expect(G().secret.hands['0']).toEqual(['Sk-27']);
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-01', 'Sk-02', 'Sk-04']));

    // Chains straight into the deck-removal step: up to 2, BP 7/8 filtered.
    const deckStep = G().public.pendingChoice;
    expect(deckStep?.kind).toBe('chooseAbility');
    expect(deckStep?.options).toEqual([0, 1]); // ordinals — Sk-14, Sk-15
    expect(deckStep?.multi).toEqual({ count: 2, exact: false, selected: [] });

    client.moves.resolveChoice(0);
    client.moves.resolveChoice(1); // reaching the cap auto-finalizes too

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['0']).toEqual(['Sk-17']);
    expect(G().public.banished['0']).toEqual(
      expect.arrayContaining(['Sk-20', 'Sk-01', 'Sk-02', 'Sk-04', 'Sk-14', 'Sk-15'])
    );
  });

  test('63c. a partial selection cannot resolve: finalizing early on an incomplete EXACT choice is rejected', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(true);
    client.moves.resolveChoice(0); // pick only 1 of the required 3

    client.moves.resolveChoice(true); // try to finalize early — must be rejected

    // Rejected cleanly: the choice is still open, still holding just the one
    // pick, and nothing has been removed from hand.
    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.multi?.selected).toEqual([0]);
    expect(G().secret.hands['0']).toEqual(['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27']);
    expect(G().public.banished['0']).not.toEqual(expect.arrayContaining(['Sk-01']));
  });

  test('63d. cancelling an optional multi-select leaves state untouched', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(true);
    client.moves.resolveChoice(0); // tentatively pick 1 of 3

    client.moves.resolveChoice(false); // cancel

    expect(G().public.pendingChoice).toBeNull();
    // Nothing tentatively picked ever takes effect — hand is fully intact.
    expect(G().secret.hands['0']).toEqual(['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27']);
    // Only Sk-20 itself (effect b, unrelated and already unconditional) is banished.
    expect(G().public.banished['0']).toEqual(['Sk-20']);
  });

  test('63e. an exact requirement with too few candidates resolves silently (no prompt at all)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-01', 'Sk-02'] }, // only 2, need exactly 3
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Effect b still fires unconditionally; effect a's yesNo never opens at
    // all, since its cost could never be paid.
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toEqual(['Sk-20']);
    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-01', 'Sk-02']);
  });

  test('63f. "up to N" with fewer than N candidates available opens normally, capped, and can finalize early', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-20'],
          hand: ['Sk-01', 'Sk-02', 'Sk-04'], // exactly 3 — the cost auto-applies, no prompt
          deck: ['Sk-14', 'Sk-17'], // only Sk-14 (BP8) qualifies; Sk-17 (BP3) doesn't
        },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(true);

    // Hand cost: exactly 3 candidates for an exact-3 requirement — auto-applies.
    expect(G().secret.hands['0']).toEqual([]);

    // Deck step: "up to 2", but only 1 candidate exists — opens capped at 1,
    // not forced, and count (2) can never be reached.
    const deckStep = G().public.pendingChoice;
    expect(deckStep?.options).toEqual([0]);
    expect(deckStep?.multi).toEqual({ count: 2, exact: false, selected: [] });

    client.moves.resolveChoice(0); // pick the only candidate
    expect(G().public.pendingChoice?.multi?.selected).toEqual([0]); // count (2) unreachable — stays pending

    client.moves.resolveChoice(true); // finalize early with fewer than the cap

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['0']).toEqual(['Sk-17']);
    expect(G().public.banished['0']).toContain('Sk-14');
  });

  test("63g. secrecy: opponent's secret.decks/secret.hands are absent from this client's payload during and after a multi-select", () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-20'],
          hand: ['Sk-01', 'Sk-02', 'Sk-04', 'Sk-27'],
          deck: ['Sk-14', 'Sk-15', 'Sk-17'],
        },
        '1': { field: [], hand: ['Sk-30'], deck: ['Sk-02', 'Sk-03', 'Sk-04'] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice?.kind).toBe('chooseAbility');
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();

    client.moves.resolveChoice(0);
    client.moves.resolveChoice(1);
    client.moves.resolveChoice(2); // finishes the hand-cost multi-select

    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();

    // Chained into the deck step — still mid multi-select.
    expect(G().public.pendingChoice).not.toBeNull();
    client.moves.resolveChoice(0);
    client.moves.resolveChoice(1);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['1']).toBeUndefined();
    expect(G().secret.hands['1']).toBeUndefined();
    expect(G().secret.hands['0']).toEqual(['Sk-27']); // own secret state is fine to see
  });

  test('63h. an existing single-answer ability still works unchanged alongside the new multi-select machinery', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.options).toEqual([0]);
    expect(pending?.multi).toBeUndefined(); // single-answer choices carry no multi descriptor

    client.moves.resolveChoice(0);

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
    expect(G().public.pendingChoice).toBeNull();
  });
});

describe('Sk-03b ARRIVAL OF DOOM (own-field removal + War Dragon retrieval)', () => {
  test("64. multi-option own-field removal, then War Dragon found face-up in the removed pile is added to hand", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20', 'Sk-29'], hand: ['Sk-03'], banished: ['Sk-16'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);

    const removePending = G().public.pendingChoice;
    expect(removePending).not.toBeNull();
    expect(removePending?.kind).toBe('ownField');
    // Sk-03 itself is already field-resident by the time onSummon fires
    // (playCard places the card before firing the trigger — see game.ts), so
    // it's a legal removal target too, alongside the two pre-existing cards.
    expect(removePending?.options).toEqual([0, 1, 2]);

    client.moves.resolveChoice(1); // remove Sk-29, leave Sage of Dark Omen (and Sk-03 itself) in place

    // War Dragon had exactly one match in the (public) removed pile, so
    // dispatchSearch's single-match fast path applies it immediately — no
    // second prompt.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][1]).toBeNull();
    expect(G().public.banished['0']).not.toContain('Sk-16');
    expect(G().secret.hands['0']).toEqual(['Sk-16']);
  });

  test('65. War Dragon absent from the removed pile falls back to the deck', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-03'], deck: ['Sk-16'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    const removePending = G().public.pendingChoice;
    expect(removePending?.kind).toBe('ownField');
    // Sage of Dark Omen (slot 0) and Sk-03 itself (slot 1, already field-resident by onSummon time) are both legal targets.
    expect(removePending?.options).toEqual([0, 1]);

    client.moves.resolveChoice(0); // remove Sage of Dark Omen

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().secret.decks['0']).toEqual([]);
    expect(G().secret.hands['0']).toEqual(['Sk-16']);
  });

  test('66. War Dragon nowhere to be found: the field removal still happens, and the retrieval half fizzles silently', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-03'], deck: ['Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);
    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull(); // mandatory removal clause still applied
    expect(G().public.banished['0']).toContain('Sk-20');
    expect(G().secret.decks['0']).toEqual(['Sk-02']); // untouched — no War Dragon to find
    expect(G().secret.hands['0']).toEqual([]);
  });
});

describe('Sk-25c BATTLE SHOCK SCORPION (removed-pile retrieval)', () => {
  test('67. Blazing Sky Goblin and Sand Squid on field, one face-up removed Action Card: confirms and adds it to hand', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-24', 'Sk-21'], hand: ['Sk-25'], banished: ['Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);

    const confirm = G().public.pendingChoice;
    expect(confirm).not.toBeNull();
    expect(confirm?.kind).toBe('yesNo');
    expect(confirm?.sourceLabel).toBe('Sk-25');
    expect(confirm?.abilitySlot).toBe('c-confirm');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toEqual([]);
    expect(G().secret.hands['0']).toEqual(['Sk-02']);
  });

  test('68. multiple face-up removed Action Cards: the choice exposes REAL removed-pile indices, not ordinal positions (removed pile is public)', () => {
    const { client, G } = createTestGame({
      players: {
        // index 0 is a non-Action filler; the two Action Card matches sit at
        // real indices 1 and 2 — if this zone used the ordinal-secrecy
        // scheme (like deck/hand), the options would instead read [0, 1].
        '0': { field: ['Sk-24', 'Sk-21'], hand: ['Sk-25'], banished: ['Sk-29', 'Sk-02', 'Sk-06'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(true);

    const searchPending = G().public.pendingChoice;
    expect(searchPending).not.toBeNull();
    expect(searchPending?.kind).toBe('chooseAbility');
    expect(searchPending?.options).toEqual([1, 2]);

    client.moves.resolveChoice(2);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toEqual(['Sk-29', 'Sk-02']);
    expect(G().secret.hands['0']).toEqual(['Sk-06']);
  });

  test('69. no face-up removed Action Card: the CHOICE_READY pre-check fizzles before any prompt opens', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-24', 'Sk-21'], hand: ['Sk-25'], banished: ['Sk-29'] }, // Rarewolf — not an Action Card
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][2]?.label).toBe('Sk-25');
    expect(G().public.banished['0']).toEqual(['Sk-29']);
  });

  test('70. a face-down removed card is never selectable: the search reads only the face-up pile, regardless of the face-down count', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-24', 'Sk-21'],
          hand: ['Sk-25'],
          banished: ['Sk-02'], // one genuine face-up Action Card match
          banishedFaceDown: 3, // simulates several other cards removed face-down — no labels stored for any of them
        },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(true);

    // Only the single face-up match was ever a candidate — the face-down
    // count neither inflates the option list nor contributes a card to hand.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-02']);
    expect(G().public.banishedFaceDown['0']).toBe(3); // untouched by the search
  });
});

describe('Sk-07a ACE IN THE HOLE (onDraw, last card of the deck)', () => {
  // Ten distinct face-up removed labels, none of which collide with any
  // card used elsewhere in this describe block's setups.
  const TEN_REMOVED = ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05', 'Sk-06', 'Sk-08', 'Sk-09', 'Sk-10', 'Sk-11'];

  test('71. same seed produces the same shuffled deck order twice (reproducibility)', () => {
    const setup = {
      players: {
        '0': { hand: [], deck: ['Sk-07'], banished: [...TEN_REMOVED] },
        '1': { field: [] },
      },
      seed: 'sk07a-determinism-seed',
    };

    const run1 = createTestGame(setup);
    run1.client.moves.drawCard();
    run1.client.moves.resolveChoice(true);

    const run2 = createTestGame(setup);
    run2.client.moves.drawCard();
    run2.client.moves.resolveChoice(true);

    expect(run1.G().secret.decks['0']).toHaveLength(10);
    expect(run1.G().secret.decks['0']).toEqual(run2.G().secret.decks['0']);
  });

  test('72. fires on the last-card draw and moves exactly 10 from the removed pile into the deck', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07'], banished: [...TEN_REMOVED] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-07');
    expect(pending?.abilitySlot).toBe('a-confirm');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toEqual([]); // removed count: 10 -> 0
    expect(G().public.deckCounts['0']).toBe(10); // deck count: 0 -> 10
    expect([...G().secret.decks['0']].sort()).toEqual([...TEN_REMOVED].sort());
  });

  test('73. fewer than 10 face-up removed cards available: the exact-count pre-check fizzles before any prompt opens', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07'], banished: ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05'] }, // only 5
        '1': { field: [] },
      },
    });

    client.moves.drawCard();

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toHaveLength(5); // untouched
    expect(G().secret.hands['0']).toEqual(['Sk-07']); // drew normally
    expect(G().secret.decks['0']).toEqual([]);
  });

  test('74. declining the optional prompt leaves state untouched', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07'], banished: [...TEN_REMOVED] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toEqual(TEN_REMOVED); // unchanged, same order
    expect(G().secret.decks['0']).toEqual([]); // the draw itself still emptied the deck; declining doesn't undo that
    expect(G().secret.hands['0']).toEqual(['Sk-07']);
  });

  test('75. the shuffled deck order never reaches the opposing client', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07'], banished: [...TEN_REMOVED] },
        '1': { field: [] },
      },
    });

    client.moves.drawCard();
    client.moves.resolveChoice(true);

    expect(G().secret.decks['0']).toHaveLength(10); // visible to the owning player's own client, as normal

    // Simulate what player 1's OWN client payload would be, via the real
    // playerView reducer (the actual mechanism responsible for what reaches
    // a client) — cast needed only because playerView's declared context
    // type also carries ctx/game/data, none of which this game's
    // implementation reads (it destructures just { G, playerID }).
    const player1View = ShadowkhanGame.playerView!({ G: G(), playerID: '1' } as any) as ShadowkhanG;
    expect(player1View.secret.decks['0']).toBeUndefined();
    expect(player1View.secret.decks['1']).toEqual([]);
  });
});

describe('Sk-04a PURGATORY UNDONE (field placement, removed pile)', () => {
  test('76. full chain: multi-match search exposes REAL removed-pile indices (public zone), then auto-places into the one empty slot and fires onSummon', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-29 is present but NOT field-origin (filler, at real index 0);
        // Sk-01 and Sk-02 (real indices 1, 2) ARE field-origin. If this zone
        // used ordinal-secrecy the choice would read [0, 1] instead.
        '0': { field: ['Sk-20', null, null], hand: ['Sk-04'], banished: ['Sk-29', 'Sk-01', 'Sk-02'], banishedFromField: ['Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // Sk-04 into the only-but-one empty slot; slot 2 stays empty

    const searchPending = G().public.pendingChoice;
    expect(searchPending).not.toBeNull();
    expect(searchPending?.kind).toBe('chooseAbility');
    expect(searchPending?.options).toEqual([1, 2]); // real indices, not ordinal [0, 1]

    client.moves.resolveChoice(1); // choose Sk-01 (real index 1)

    // Sk-01's own onSummon (RULES OF ENGAGEMENT) sets a global flag — the
    // clearest available proof that placement fires onSummon like a normal
    // play, since placeCardOnField is the exact function playCard itself
    // uses (see its doc comment in effects.ts). No prior test used Sk-01's
    // onSummon this way; single-slot placement needed no further prompt.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][2]?.label).toBe('Sk-01');
    expect(G().public.rulesOfEngagementActive).toBe(true);
    expect(G().public.banished['0']).toEqual(['Sk-29', 'Sk-02']);
    expect(G().public.banishedFromField['0']).toEqual(['Sk-02']);
  });

  test('77. no field-origin removed card available: resolves silently, even though the removed pile is non-empty', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-29 is in the removed pile but was removed from HAND or DECK,
        // not field — untagged, so it must not be selectable.
        '0': { field: ['Sk-20', null, null], hand: ['Sk-04'], banished: ['Sk-29'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][1]?.label).toBe('Sk-04');
    expect(G().public.field['0'][2]).toBeNull(); // nothing was placed
    expect(G().public.banished['0']).toEqual(['Sk-29']); // untouched
  });

  test('78. own field already full when Sk-04 is played: the pre-check fizzles before any prompt, even with an eligible removed card waiting', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20', 'Sk-29', null], hand: ['Sk-04'], banished: ['Sk-01'], banishedFromField: ['Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2); // fills the last empty slot with Sk-04 itself

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][2]?.label).toBe('Sk-04');
    expect(G().public.banished['0']).toEqual(['Sk-01']); // untouched — nowhere to put it
  });
});

describe('Sk-08a A SINISTER ALLIANCE (field placement, deck search)', () => {
  test('79. full chain: multi-match deck search keeps ORDINAL secrecy (secret zone), then auto-places into the one empty slot', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-01 (real index 0) is not an ally and must never be offered.
        // Sk-25 and Sk-24 (real indices 1, 2) are the two eligible allies.
        '0': { field: ['Sk-21', null, null], hand: ['Sk-08'], deck: ['Sk-01', 'Sk-25', 'Sk-24'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // Sk-08 into slot 1; slot 2 stays empty

    const confirm = G().public.pendingChoice;
    expect(confirm?.kind).toBe('yesNo');
    expect(confirm?.sourceLabel).toBe('Sk-08');
    expect(confirm?.abilitySlot).toBe('a-confirm');

    client.moves.resolveChoice(true);

    const searchPending = G().public.pendingChoice;
    expect(searchPending).not.toBeNull();
    expect(searchPending?.kind).toBe('chooseAbility');
    // Ordinal positions within the match list (the 1st and 2nd matches),
    // NOT the real deck indices [1, 2] — deck is secret, unlike 'removed'.
    expect(searchPending?.options).toEqual([0, 1]);
    expect(G().secret.decks['1']).toBeUndefined(); // opponent's deck never leaks

    client.moves.resolveChoice(0); // the 1st match: Sk-25

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][2]?.label).toBe('Sk-25');
    expect(G().secret.decks['0']).toEqual(['Sk-01', 'Sk-24']); // Sk-25 removed, order preserved
  });

  test('80. declining the optional prompt leaves the deck and field untouched', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21', null, null], hand: ['Sk-08'], deck: ['Sk-25'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.decks['0']).toEqual(['Sk-25']);
    expect(G().public.field['0'][1]?.label).toBe('Sk-08');
    expect(G().public.field['0'][2]).toBeNull();
  });

  test('81. no eligible ally in the deck: resolves silently, no prompt opens', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21', null, null], hand: ['Sk-08'], deck: ['Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][1]?.label).toBe('Sk-08');
    expect(G().secret.decks['0']).toEqual(['Sk-01']);
  });
});

describe('Sk-29a RAREWOLF (guardian removal hook)', () => {
  test('82. fires and alters the outcome: accepting substitutes Rarewolf for the BP<=4 card that was about to be removed', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20', 'Sk-29', null], turnsTaken: 1 }, // Sk-20 = Sage of Dark Omen, BP2
        '1': { field: ['Sk-25'] }, // BP6 — beats Sk-20 (BP2) as defender
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-20 attacks and loses

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-29');
    expect(pending?.abilitySlot).toBe('guard-confirm');

    client.moves.resolveChoice(true);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-20'); // survived
    expect(G().public.field['0'][1]).toBeNull(); // Rarewolf removed instead
    expect(G().public.banished['0']).toContain('Sk-29');
    expect(G().public.banished['0']).not.toContain('Sk-20');
  });

  test('83. declining leaves the original removal to proceed normally', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20', 'Sk-29', null], turnsTaken: 1 },
        '1': { field: ['Sk-25'] },
      },
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(false);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull(); // Sk-20 removed as normal
    expect(G().public.field['0'][1]?.label).toBe('Sk-29'); // Rarewolf untouched
    expect(G().public.banished['0']).toContain('Sk-20');
    expect(G().public.banished['0']).not.toContain('Sk-29');
  });

  test('84. no guardian present: the BP<=4 card is removed with no prompt, exactly as before this pass', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20', null, null], turnsTaken: 1 },
        '1': { field: ['Sk-25'] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-20');
  });
});

describe("Sk-30a SHADOW'S MISTRESS (guardian removal hook)", () => {
  // Vehicle: Sk-11's own overflow-wipe effect ("if the selected card's BP
  // becomes more than 9, remove all cards from your field") is an
  // 'ability'-cause removal player0 can trigger entirely with their own
  // moves — the test harness's single client is bound to playerID '0', so a
  // vehicle needing the OPPONENT to act (e.g. Sk-05's opponent-field
  // removal) isn't reachable here. Deliberately 'ability'-cause, not
  // 'battle': Sk-15b's own self-hook is unconditionally eligible for a
  // 'battle'-cause removal and would win first (see test 88), which would
  // mask Sk-30a's own behavior rather than isolate it. Sk-15 + Sk-30 (both
  // Battle Cards) satisfy Sk-11's own "two or more Battle Cards" play gate,
  // so Sk-11 can be played straight into the third slot.
  test("85. fires and alters the outcome: accepting redirects Shadow Ghost to the deck and pays the hand cost", () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-30', null], hand: ['Sk-11', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2); // Sk-11 into the empty slot
    client.moves.resolveChoice(0); // buff Sk-15 (BP7 + Sk-30's BP3 = 10, over 9)
    client.moves.resolveChoice(true); // confirm the overflow wipe

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-30');
    expect(pending?.abilitySlot).toBe('guard-confirm');

    client.moves.resolveChoice(true); // accept the guardian's redirect

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull(); // Shadow Ghost left the field
    expect(G().public.field['0'][1]?.label).toBe('Sk-30'); // guardian itself untouched
    expect(G().secret.decks['0']).toEqual(['Sk-15']); // redirected to deck, not banished
    expect(G().public.banished['0']).not.toContain('Sk-15');
    expect(G().secret.hands['0']).toEqual([]); // the one remaining hand card paid the cost
    expect(G().public.banishedFaceDown['0']).toBe(1);
  });

  test('86. declining leaves the original removal to proceed normally, and the cost is never paid', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-30', null], hand: ['Sk-11', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(0);
    client.moves.resolveChoice(true);
    client.moves.resolveChoice(false); // decline the guardian's redirect

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-15');
    expect(G().secret.decks['0']).toEqual([]); // never redirected
    expect(G().secret.hands['0']).toEqual(['Sk-01']); // cost never paid
  });

  test('87. cannot pay its cost (empty hand): the guardian is not offered at all, removal proceeds silently', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-30', null], hand: ['Sk-11'] }, // hand is empty after Sk-11 is played
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 2);
    client.moves.resolveChoice(0);
    client.moves.resolveChoice(true); // no guard-confirm should open from here

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-15');
  });
});

describe('Guardian vs self-hook ordering', () => {
  test('88. a self-hook card and an applicable guardian both present: the self-hook is offered, the guardian is never consulted for that removal', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-30', null], turnsTaken: 1 },
        '1': { field: ['Sk-16'] }, // War Dragon, BP9 — beats Shadow Ghost (BP7) as defender
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-15 attacks and loses (battle cause)

    // Sk-15b (self-hook) is unconditionally eligible for a battle-cause
    // removal — it must win over Sk-30 (guardian), per the ordering
    // decision in removeFieldCard.
    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.sourceLabel).toBe('Sk-15');
    expect(pending?.abilitySlot).toBe('removal-confirm');

    client.moves.resolveChoice(false); // decline the self-hook's own return-to-hand offer

    // Normal banishment follows — Sk-30's guardian redirect never ran for
    // this removal (nothing added to the deck).
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-15');
    expect(G().secret.decks['0']).toEqual([]);
    expect(G().public.field['0'][1]?.label).toBe('Sk-30'); // guardian itself unaffected
  });

  test('89. an existing self-hook (Sk-19a) still fires unchanged even with an inapplicable guardian on the same field', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-19', 'Sk-29', null], turnsTaken: 1 }, // Sk-19 is BP5 — too high for Rarewolf's BP<=4 guard
        '1': { field: ['Sk-16'] }, // BP9 — beats Sk-19 (BP5)
      },
    });

    client.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.sourceLabel).toBe('Sk-19');
    expect(pending?.abilitySlot).toBe('removal-confirm');

    client.moves.resolveChoice(true); // remain on the field instead

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-19');
    expect(G().public.field['0'][0]?.replacementUsed).toBe(true);
    expect(G().public.field['0'][1]?.label).toBe('Sk-29'); // guardian never consulted, untouched
  });
});
