import { describe, expect, test } from 'vitest';
import { Client } from 'boardgame.io/client';
import { createTestGame } from './helpers';
import { ShadowkhanGame } from '../game';

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

  test('5. with only one own Battle Card, playing Sk-11 opens no prompt and changes nothing', () => {
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
    expect(G().public.field['0'][1]?.label).toBe('Sk-11');
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
