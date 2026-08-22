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
        // Sk-30 is a harmless filler ahead of the deck's real content: it
        // has no onDraw trigger (only Sk-07/Sk-28 do — see effects.ts) and
        // its own guardian ability only matters while ON THE FIELD, so the
        // automatic turn-1 auto-draw consumes it instead of Sk-01, leaving
        // the deck at the 2 cards this test's own bottomUp call needs.
        '0': { field: ['Sk-14', 'Sk-27'], hand: ['Sk-11'], deck: ['Sk-30', 'Sk-01', 'Sk-02'] },
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
  // UPDATED for the designer ruling that effect a resolves immediately,
  // overriding the printed "may" — no yes/no step, AND (since "remove one"
  // is no longer optional) no target prompt either when there's only one
  // legal candidate, matching the same zero/one/many shape dispatchSearch
  // already uses elsewhere: with nothing left to decide, it just happens.
  // Previously this asserted an intervening yesNo prompt before even
  // reaching the (still-real, single-option) target choice; now there is no
  // prompt of any kind — stronger in that it pins down the actual
  // immediate-removal behavior, not just "the yesNo is gone."
  test('6. opponent field has exactly one Battle Card: removed immediately, no prompt of any kind', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-14'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
  });

  test('6b. opponent field has two or more Battle Cards: a real target choice still opens (which one is a genuine decision)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-14'] },
        '1': { field: ['Sk-29', 'Sk-15'] },
      },
    });

    client.moves.playCard(0, 0);

    const target = G().public.pendingChoice;
    expect(target).not.toBeNull();
    expect(target?.kind).toBe('opponentField');
    expect(target?.sourceLabel).toBe('Sk-14');
    expect(target?.abilitySlot).toBe('a-target');
    expect(target?.options).toEqual([0, 1]);

    client.moves.resolveChoice(1);

    expect(G().public.field['1'][1]).toBeNull();
    expect(G().public.field['1'][0]?.label).toBe('Sk-29'); // untouched — only the chosen one is removed
    expect(G().public.banished['1']).toContain('Sk-15');
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
        // Sk-24 relocated from hand to the deck's top: the automatic turn-1
        // auto-draw draws it into hand BEFORE the test's own playCard call,
        // reconstructing the exact original hand/deck split (hand: ['Sk-24'],
        // deck: ['Sk-08', 'Sk-01']) with no foreign card left sitting in
        // hand afterward — unlike an unrelated filler, which would still be
        // there polluting the exact hands['0'] equality check below.
        '0': { field: ['Sk-21'], hand: [], deck: ['Sk-24', 'Sk-08', 'Sk-01'] },
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
        // Sk-24 relocated from hand to the deck's top — see test 13's
        // comment.
        '0': { field: ['Sk-21'], hand: [], deck: ['Sk-24', 'Sk-01', 'Sk-02'] },
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
        // Sk-24 relocated from hand to the deck's top — see test 13's comment.
        '0': { field: ['Sk-21'], hand: [], deck: ['Sk-24', 'Sk-08', 'Sk-27'] },
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
        // Sk-30 filler ahead of Sk-03: the turn-1 auto-draw takes it first
        // (genuinely irrelevant — no onDraw trigger, no interaction with
        // this ability), leaving Sk-03 in the deck for effect b's own
        // search to find. The auto-draw is NOT suppressed here — it fires
        // and its result is accounted for explicitly in the hand assertion
        // below, rather than hidden by pre-filling hand to 5.
        '0': { field: ['Sk-20'], deck: ['Sk-30', 'Sk-03', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-20');
    expect(G().secret.hands['0']).toEqual(['Sk-30', 'Sk-03']); // Sk-30: the turn-1 draw; Sk-03: this ability's own retrieval
    expect(G().public.deckCounts['0']).toBe(1);
  });

  // UPDATED for the designer ruling that effect b is gated as a whole on
  // ARRIVAL OF DOOM actually being retrievable — previously the field
  // removal ran unconditionally and only the retrieval itself silently
  // fizzled, leaving the player having paid (lost Sk-20) for nothing. Now
  // the whole ability resolves silently and Sk-20 stays on the field.
  // Stronger: it pins down that NOTHING happens, not just that the search
  // half fizzles.
  test('17. no Arrival Of Doom in deck: the whole ability resolves silently, Sk-20 stays on the field', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-30 filler ahead of the deck's real content — see test 16's
        // comment. Deliberately no ARRIVAL OF DOOM anywhere here, including
        // as the filler, so the search's own "no match" branch is still the
        // thing under test.
        '0': { field: ['Sk-20'], deck: ['Sk-30', 'Sk-01', 'Sk-02'] },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-20'); // never removed
    expect(G().public.banished['0']).not.toContain('Sk-20');
    expect(G().secret.hands['0']).toEqual(['Sk-30']); // only the turn-1 draw — the ability itself retrieved nothing
    expect(G().public.deckCounts['0']).toBe(2); // untouched
  });
});

describe('Sk-23a PORTAL MONARCH (onActivate)', () => {
  test('18. discard a Battle card (choosing among two) and retrieve a Battle card from deck', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-27 (the hand's trailing card) relocated to the deck's top: the
        // automatic turn-1 auto-draw appends it back onto the end of hand,
        // reconstructing the exact original hand ['Sk-29', 'Sk-27'] — same
        // order, since the draw always appends — while Sk-22 stays
        // protected deeper in the deck for the retrieve step to find.
        '0': { field: ['Sk-23'], hand: ['Sk-29'], deck: ['Sk-27', 'Sk-22', 'Sk-01'] },
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
        // Sk-29 (the sole hand card) relocated to the deck's top: the
        // automatic turn-1 auto-draw draws it right back into hand,
        // reconstructing the exact original hand/deck split.
        '0': { field: ['Sk-23'], hand: [], deck: ['Sk-29', 'Sk-01', 'Sk-02'] },
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

    // The automatic turn-1 draw (turn.onBegin) already performed this exact
    // draw during construction — drawCardForPlayer/fireOnDraw fire the same
    // way regardless of caller (see game.ts). No manual move needed.

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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.

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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.

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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.

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
    // Seeded so the turn-1 auto-draw that follows the deal — a real draw,
    // unrelated to what this test checks — deterministically does NOT land
    // on Sk-07/Sk-28, the only two labels with an onDraw trigger; otherwise
    // this test would be flaky (~1-in-27 per run) for a reason that has
    // nothing to do with the opening deal itself, which is the one thing
    // under test here. 'seed-0' was verified (by iterating candidate seeds
    // against the real shuffle) to land the auto-drawn 4th card on neither
    // label for player 0.
    const realClient = Client({ game: { ...ShadowkhanGame, seed: 'seed-0' }, numPlayers: 2, playerID: '0' });
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
        // Sk-30 filler ahead of the deck's real content: the automatic
        // turn-1 auto-draw takes it instead (hand is never asserted on in
        // this test, so it landing there is harmless), leaving the 3 real
        // cards intact for onRemoved's own top-2 removal to consume.
        '0': { field: ['Sk-14'], turnsTaken: 1, deck: ['Sk-30', 'Sk-01', 'Sk-02', 'Sk-03'] }, // BP 8 attacker
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
        // Sk-30 filler ahead of the deck's real content — see test 47's
        // comment (hand is never asserted on in this test).
        '0': { field: ['Sk-27'], deck: ['Sk-30', 'Sk-01', 'Sk-02'], turnsTaken: 1 }, // BP 5
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

  test('141. onRemoved fires for BOTH removal causes in the same match — ability-driven (the gap this fix closed) and battle-driven (unchanged) — each firing exactly once for its own card', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-30 filler ahead of the deck's real content — see test 47's
        // comment (player 0's final hand is never asserted on here).
        '0': { field: ['Sk-14', null, null], hand: ['Sk-05'], turnsTaken: 1, deck: ['Sk-30', 'Sk-01', 'Sk-02', 'Sk-03'] },
        '1': { field: [{ label: 'Sk-17', turnsOnField: 2 }, { label: 'Sk-17', turnsOnField: 1 }, null] },
      },
    });

    // First: an ABILITY-cause removal (Sk-05 targeting slot 0's Bloat
    // Dragon). Before this fix, onRemoved never fired for an ability-driven
    // removal at all — this is the exact behavior the fix added.
    client.moves.playCard(0, 1); // Sk-05 into player 0's own slot 1
    const pending = G().public.pendingChoice;
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.sourceLabel).toBe('Sk-05');
    expect(pending?.options).toEqual([0, 1]);

    client.moves.resolveChoice(0); // remove slot 0's Sk-17 by ABILITY

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-17');
    expect(G().secret.decks['0']).toEqual(['Sk-03']); // turnsOnField=2 swept exactly 2
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-01', 'Sk-02']));
    expect(G().public.banished['0']).toHaveLength(2);

    // Second, same match: an ordinary BATTLE-cause removal of the other
    // Sk-17 (slot 1) — unchanged by this fix, and must not double-fire or
    // interfere with the first removal's own sweep.
    client.moves.attackBattleCard(0, 1); // Sk-14 (BP8) attacks slot 1's Sk-17 (BP3)

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][1]).toBeNull();
    expect(G().public.banished['1']).toHaveLength(2); // both copies of Sk-17, one per cause
    expect(G().secret.decks['0']).toEqual([]); // turnsOnField=1 swept exactly 1 more
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-01', 'Sk-02', 'Sk-03']));
    expect(G().public.banished['0']).toHaveLength(3);
  });

  test('142. onRemoved does NOT fire when the removal is PREVENTED outright — protectedFromBattleCardRemoval blocks the ability before finishFieldRemoval ever runs', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-30 filler ahead of the deck's real content — see test 47's
        // comment.
        '0': { hand: ['Sk-05'], deck: ['Sk-30', 'Sk-01', 'Sk-02', 'Sk-03'] },
        '1': { field: [{ label: 'Sk-17', turnsOnField: 2, protectedFromBattleCardRemoval: true }] },
      },
    });

    client.moves.playCard(0, 0);
    client.moves.resolveChoice(0); // target the protected Sk-17 — removeFieldCard returns 'prevented'

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]?.label).toBe('Sk-17'); // untouched
    expect(G().public.banished['1']).not.toContain('Sk-17');
    // Direct proof: if onRemoved had fired anyway, player 0's deck would
    // have lost its top 2 cards. It didn't — nothing here ever reached
    // finishFieldRemoval.
    expect(G().secret.decks['0']).toEqual(['Sk-01', 'Sk-02', 'Sk-03']);
    expect(G().public.banished['0']).toEqual([]);
  });

  test('143. onRemoved does NOT fire when the removal is PREVENTED by a self-hook (Sk-19a keeping the card on the field) — finishFieldRemoval never runs for that slot', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-19', null, null] }, // Headless Horseman, BP5
        '1': { field: ['Sk-16'], turnsTaken: 1, deck: ['Sk-02'] }, // see test 94's comment on the deck filler
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0); // player 1 attacks and wins; Sk-19 would be removed by battle

    const pending = G().public.pendingChoice;
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-19');
    expect(pending?.abilitySlot).toBe('removal-confirm');

    client.moves.resolveChoice(true); // player 0 (the defender) keeps it on the field

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-19');
    expect(G().public.field['0'][0]?.replacementUsed).toBe(true);
    // Sk-19 itself carries no onRemoved ability, so there's no card-specific
    // side effect to check here the way tests 141/142/144 use Sk-17's own
    // deck-sweep as direct proof. What this asserts instead is the general
    // contract: the card was never banished, meaning finishFieldRemoval —
    // the single call site that fires onRemoved — never ran for this slot.
    expect(G().public.banished['0']).not.toContain('Sk-19');
  });

  test("144. onRemoved does NOT fire when the removal is PREVENTED by a guardian substitution (Sk-29a) — the redirected removal fires onRemoved for the GUARDIAN's own slot, never the saved card's", () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-17', turnsOnField: 2 }, 'Sk-29', null] },
        // Sk-30 filler ahead of the deck's real content — see test 47's
        // comment (player 1's final hand is never asserted on here).
        '1': { hand: ['Sk-05'], deck: ['Sk-30', 'Sk-01', 'Sk-02', 'Sk-03'] },
      },
      currentPlayer: '1',
    });

    client1.moves.playCard(0, 0); // opponent plays Sk-05
    client1.moves.resolveChoice(0); // targets Sk-17 (slot 0), not Sk-29 (slot 1)

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-29');
    expect(pending?.abilitySlot).toBe('guard-confirm');

    client.moves.resolveChoice(true); // player 0, Rarewolf's own owner, substitutes it in

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-17'); // survived
    expect(G().public.field['0'][1]).toBeNull(); // Rarewolf removed instead
    expect(G().public.banished['0']).toContain('Sk-29');
    expect(G().public.banished['0']).not.toContain('Sk-17');
    // Direct proof: Sk-17's own onRemoved never fired — player 1's deck (the
    // ability owner's deck, the one Sk-17's ability would have swept) is
    // completely untouched, and nothing was banished from it. Player 1's own
    // deck contents aren't visible in player 0's playerView (G()), so this
    // reads through player 1's own client instead (G1()) — the same
    // secrecy convention every other cross-player deck check in this file
    // already follows.
    expect(G1().secret.decks['1']).toEqual(['Sk-01', 'Sk-02', 'Sk-03']);
    expect(G().public.banished['1']).toEqual([]);
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
          // Sk-27 (the hand's trailing card) relocated to the deck's top:
          // the automatic turn-1 auto-draw appends it back onto the end of
          // hand, reconstructing the exact original 4-card hand in the
          // exact original order (the draw always appends), while Sk-14
          // stays protected deeper in the deck for the deck-removal step.
          hand: ['Sk-01', 'Sk-02', 'Sk-04'], // 4 candidates for an exact-3 cost — a real choice
          deck: ['Sk-27', 'Sk-14', 'Sk-15', 'Sk-17'], // Sk-14 (BP8), Sk-15 (BP7) qualify; Sk-17 (BP3) doesn't
        },
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Effect b is now gated on ARRIVAL OF DOOM being in the deck (it isn't
    // here — Sk-14/Sk-15/Sk-17 only), so it resolves silently and Sk-20
    // stays on the field; effect a's own yesNo is unaffected either way
    // (see the wiring comment for why the two don't interfere).
    expect(G().public.field['0'][0]?.label).toBe('Sk-20');
    expect(G().public.banished['0']).not.toContain('Sk-20');
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
    expect(G().public.field['0'][0]?.label).toBe('Sk-20'); // effect b never fired — still on the field
    expect(G().public.banished['0']).toEqual(
      expect.arrayContaining(['Sk-01', 'Sk-02', 'Sk-04', 'Sk-14', 'Sk-15'])
    );
    expect(G().public.banished['0']).not.toContain('Sk-20');
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
    // Effect b is gated on ARRIVAL OF DOOM being in the deck — it isn't
    // (deck defaults to empty here) — so it never fires either: nothing at
    // all is banished, and Sk-20 stays on the field.
    expect(G().public.banished['0']).toEqual([]);
    expect(G().public.field['0'][0]?.label).toBe('Sk-20');
  });

  test('63e. an exact requirement with too few candidates resolves silently (no prompt at all)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-20'], hand: ['Sk-01', 'Sk-02'] }, // only 2, need exactly 3
        '1': { field: [] },
      },
    });

    client.moves.activateAbility(0);

    // Effect b is gated on ARRIVAL OF DOOM being in the deck — deck is
    // empty here, so it resolves silently and Sk-20 stays; effect a's
    // yesNo never opens either, since its own cost could never be paid.
    expect(G().public.field['0'][0]?.label).toBe('Sk-20');
    expect(G().public.banished['0']).toEqual([]);
    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-01', 'Sk-02']);
  });

  test('63f. "up to N" with fewer than N candidates available opens normally, capped, and can finalize early', () => {
    const { client, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-20'],
          // Sk-04 (the hand's trailing card) relocated to the deck's top —
          // see test 63b's comment.
          hand: ['Sk-01', 'Sk-02'], // exactly 3 — the cost auto-applies, no prompt
          deck: ['Sk-04', 'Sk-14', 'Sk-17'], // only Sk-14 (BP8) qualifies; Sk-17 (BP3) doesn't
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
          // Sk-27 relocated to the deck's top — see test 63b's comment.
          hand: ['Sk-01', 'Sk-02', 'Sk-04'],
          deck: ['Sk-27', 'Sk-14', 'Sk-15', 'Sk-17'],
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
        // Sk-03 (the sole hand card) relocated to the deck's top: the
        // automatic turn-1 auto-draw draws it right back into hand,
        // reconstructing the exact original hand/deck split.
        '0': { field: ['Sk-20'], hand: [], deck: ['Sk-03', 'Sk-02'] },
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

    // The automatic turn-1 draw already performed this exact draw during
    // construction, for each independently-seeded run — see the equivalent
    // note on test 24 above.
    const run1 = createTestGame(setup);
    run1.client.moves.resolveChoice(true);

    const run2 = createTestGame(setup);
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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.

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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.

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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.
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

    // The automatic turn-1 draw already performed this exact draw during
    // construction — see the equivalent note on test 24 above.
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
        // Sk-08 (the sole hand card) relocated to the deck's top: the
        // automatic turn-1 auto-draw draws it right back into hand,
        // reconstructing the exact original hand/deck split.
        '0': { field: ['Sk-21', null, null], hand: [], deck: ['Sk-08', 'Sk-01', 'Sk-25', 'Sk-24'] },
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
        // Sk-08 relocated to the deck's top — see test 79's comment.
        '0': { field: ['Sk-21', null, null], hand: [], deck: ['Sk-08', 'Sk-25'] },
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
        // Sk-08 relocated to the deck's top — see test 79's comment.
        '0': { field: ['Sk-21', null, null], hand: [], deck: ['Sk-08', 'Sk-01'] },
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

describe('createTestGame: two independent clients over one shared match', () => {
  test('90. a move submitted as player 1 succeeds and mutates state correctly, visible to both clients', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { field: [] },
        '1': { hand: ['Sk-01'], field: [] },
      },
      currentPlayer: '1',
    });

    client1.moves.playCard(0, 0);

    // Public state — visible identically through EITHER client, proving
    // both are genuinely watching the same canonical match, not two
    // independent local games that merely started from the same spec.
    expect(G1().public.field['1'][0]?.label).toBe('Sk-01');
    expect(G().public.field['1'][0]?.label).toBe('Sk-01');
    expect(G1().secret.hands['1']).toEqual([]);
  });

  test('91. a move submitted by the wrong player is rejected: move validation is intact, not bypassed', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { hand: [], field: [] },
        '1': { hand: ['Sk-01'], field: [] },
      },
      // currentPlayer defaults to '0' — it is NOT player 1's turn.
    });

    client1.moves.playCard(0, 0);

    expect(G1().public.field['1'][0]).toBeNull(); // rejected — nothing placed
    expect(G1().secret.hands['1']).toEqual(['Sk-01']); // card never left hand
    expect(G().public.field['1'][0]).toBeNull(); // same rejection, seen from the other client
  });

  test("92. each player's playerView hides the other's secret hand and deck, verified from both sides", () => {
    const { G, G1 } = createTestGame({
      players: {
        // Sk-01 (the sole hand card) relocated to the deck's top: the
        // automatic turn-1 auto-draw draws it right back into hand,
        // reconstructing the exact original hand/deck split with no moves
        // dispatched at all in this test.
        '0': { hand: [], deck: ['Sk-01', 'Sk-02'] },
        '1': { hand: ['Sk-03'], deck: ['Sk-04'] },
      },
    });

    expect(G().secret.hands['0']).toEqual(['Sk-01']);
    expect(G().secret.decks['0']).toEqual(['Sk-02']);
    expect(G().secret.hands['1']).toBeUndefined();
    expect(G().secret.decks['1']).toBeUndefined();

    expect(G1().secret.hands['1']).toEqual(['Sk-03']);
    expect(G1().secret.decks['1']).toEqual(['Sk-04']);
    expect(G1().secret.hands['0']).toBeUndefined();
    expect(G1().secret.decks['0']).toBeUndefined();
  });

  // Re-testing Sk-30a with the OPPONENT actively removing the guarded card
  // via their own move (Sk-05, "Remove one Battle Card from the field
  // face-up") — the scenario the previous run's single-client harness could
  // not reach.
  //
  // CHANGED from the previous run: this test previously asserted that
  // NEITHER player could resolve the guardian's own confirm — a real,
  // pre-existing gap (pending.pid === '0' the defender, ctx.currentPlayer
  // stays '1' the attacker throughout, since nothing ends their turn). That
  // gap is now fixed (see syncActivePlayersToPendingChoice in effects.ts and
  // resolveChoice in game.ts), so this test is rewritten to assert the
  // FIXED behavior — the defender resolves successfully — rather than
  // continuing to assert the stuck state that no longer occurs.
  test('93. opponent-triggered guardian: the DEFENDING player resolves it, pays the cost, and the redirect happens, even though the ATTACKER still holds the turn', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-30', null], hand: ['Sk-01'] },
        '1': { hand: ['Sk-05'] },
      },
      currentPlayer: '1',
    });

    client1.moves.playCard(0, 0); // opponent plays Sk-05
    client1.moves.resolveChoice(0); // targets Sk-15 (slot 0), not Sk-30 (slot 1)

    // The guardian fires: GUARDIAN_HOOKS' field scan and pid plumbing work
    // correctly across players, opening Sk-30's own confirm for its owner.
    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-30');
    expect(pending?.abilitySlot).toBe('guard-confirm');
    expect(client.getState()?.ctx.currentPlayer).toBe('1'); // still player 1's turn — untouched

    client.moves.resolveChoice(true); // player 0, the guardian's own owner, resolves it

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull(); // Shadow Ghost left the field
    expect(G().public.field['0'][1]?.label).toBe('Sk-30'); // guardian itself untouched
    expect(G().secret.decks['0']).toEqual(['Sk-15']); // redirected to deck, not banished
    expect(G().public.banished['0']).not.toContain('Sk-15');
    expect(G().secret.hands['0']).toEqual([]); // the one hand card paid the cost
    expect(G().public.banishedFaceDown['0']).toBe(1);
    expect(client.getState()?.ctx.currentPlayer).toBe('1'); // still player 1's turn afterward too
  });

  test('94. Sk-15b fires and resolves for the DEFENDER when the OPPONENT wins the battle — the shape the card is actually for', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', null, null] }, // Shadow Ghost, BP7, seeded directly (no onSummon, no protectedFromBattleCardRemoval)
        // deck: ['Sk-02'] is a harmless filler — turnsTaken: 1 combined with
        // currentPlayer: '1' makes turn.onBegin's bothReady check true (the
        // setup's own endTurn dispatch bumps player 0's turnsTaken to 1
        // too), which would otherwise auto-lose player 1 on an empty deck
        // before this test's own moves ever run.
        '1': { field: ['Sk-16'], turnsTaken: 1, deck: ['Sk-02'] }, // War Dragon, BP9 — beats Shadow Ghost as attacker
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0); // player 1 attacks and wins; player 0's Sk-15 would be removed by battle

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-15');
    expect(pending?.abilitySlot).toBe('removal-confirm');
    expect(client.getState()?.ctx.currentPlayer).toBe('1'); // the attacker's turn, unchanged

    client.moves.resolveChoice(true); // player 0 (the defender) returns it to hand instead

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull();
    expect(G().secret.hands['0']).toEqual(['Sk-15']);
    expect(G().public.banished['0']).not.toContain('Sk-15');
  });

  test('95. Sk-19a fires and resolves for the DEFENDER on the same opponent-caused path', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-19', null, null] }, // Headless Horseman, BP5
        '1': { field: ['Sk-16'], turnsTaken: 1, deck: ['Sk-02'] }, // see test 94's comment on the deck filler
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-19');
    expect(pending?.abilitySlot).toBe('removal-confirm');

    client.moves.resolveChoice(true); // player 0 keeps it on the field, once-only use

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-19');
    expect(G().public.field['0'][0]?.replacementUsed).toBe(true);
  });

  test('96. Sk-25b fires and resolves for the DEFENDER on the same opponent-caused path, paying the hand cost', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-25', null, null], hand: ['Sk-08'] }, // Battle Shock Scorpion, BP6; Sk-08 is an Action Card
        '1': { field: ['Sk-16'], turnsTaken: 1, deck: ['Sk-02'] }, // see test 94's comment on the deck filler
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0);

    const pending = G().public.pendingChoice;
    expect(pending?.pid).toBe('0');
    expect(pending?.sourceLabel).toBe('Sk-25');
    expect(pending?.abilitySlot).toBe('removal-confirm');

    client.moves.resolveChoice(true); // player 0 pays the cost to survive

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-25');
    expect(G().public.banished['0']).not.toContain('Sk-25');
    expect(G().secret.hands['0']).toEqual([]);
    expect(G().public.banishedFaceDown['0']).toBe(1);
  });

  test('97. the attacker cannot act while the defender\'s choice is open', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { field: ['Sk-15', null, null] },
        '1': { field: ['Sk-16', 'Sk-14', null], turnsTaken: 1, deck: ['Sk-02'] }, // a second Battle Card to attack with, if allowed; deck filler per test 94's comment
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0); // opens Sk-15b's own confirm for player 0

    expect(G().public.pendingChoice).not.toBeNull();

    // The attacker (player 1, still ctx.currentPlayer) attempts to act again
    // while the defender's choice is open — every move already gates on
    // G.public.pendingChoice, and player 1 is no longer even the sole
    // active player (activePlayers now names player 0 only), so this is
    // doubly rejected.
    client1.moves.attackBattleCard(1, 0); // Sk-14 attacking again
    client1.moves.endTurn();

    expect(G().public.pendingChoice).not.toBeNull(); // still open — neither attempt got through
    expect(G().public.attackedThisTurn).toBe(true); // unchanged since the first attack
    expect(G1().public.field['1'][1]?.label).toBe('Sk-14'); // second attacker never left the field
    expect(client1.getState()?.ctx.currentPlayer).toBe('1'); // turn never passed

    // The defender answers, and only then can the attacker's turn proceed.
    client.moves.resolveChoice(true);
    expect(G().public.pendingChoice).toBeNull();
  });

  test('98. an ordinary same-player pendingChoice still resolves exactly as before', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-05'] },
        '1': { field: ['Sk-29'] },
      },
    });

    client.moves.playCard(0, 0); // player 0 plays Sk-05 on their own turn

    const pending = G().public.pendingChoice;
    expect(pending?.pid).toBe('0');
    expect(client.getState()?.ctx.currentPlayer).toBe('0');

    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-29');
  });
});

describe('Sk-06 TRANSFORMATION CHAMBER (scheduled summon)', () => {
  test('99. full chain: select (auto), pay the cost (real multi-select), stays hidden and un-summoned through the intervening turn, then places on the correct later turn', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        // Sk-01 (the hand's trailing card) relocated to the deck's top: the
        // automatic turn-1 auto-draw appends it back onto the end of hand,
        // reconstructing the exact original hand ['Sk-06', 'Sk-01'] — same
        // order, since the draw always appends — while Sk-20 stays
        // protected deeper in the deck for effect a's own search to find.
        '0': { field: [], hand: ['Sk-06'], deck: ['Sk-01', 'Sk-20', 'Sk-02', 'Sk-08', 'Sk-03'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-06 into slot 0

    // Effect a: only Sk-20 (Battle, BP2) qualifies — Sk-02/Sk-08/Sk-03 are
    // all Action Cards — so the search auto-selects with no prompt, and
    // immediately chains into effect b's cost. selectedBp=2, but
    // hand+deck combined now holds 4 cards (Sk-01, plus Sk-02/Sk-08/Sk-03
    // left in the deck after Sk-20 was pulled out) — more than the exact
    // count needed, so THIS opens a real multi-select, unlike the search.
    const costPending = G().public.pendingChoice;
    expect(costPending).not.toBeNull();
    expect(costPending?.kind).toBe('chooseAbility');
    expect(costPending?.sourceLabel).toBe('Sk-06');
    expect(costPending?.abilitySlot).toBe('b-cost');
    expect(costPending?.options).toEqual([0, 1, 2, 3]);
    expect(costPending?.multi).toEqual({ count: 2, exact: true, selected: [] });

    client.moves.resolveChoice(0); // one pick of two — not yet complete
    expect(G().public.pendingChoice?.multi?.selected).toEqual([0]);

    client.moves.resolveChoice(1); // second pick completes the exact-2 cost

    expect(G().public.pendingChoice).toBeNull();
    expect(G().secret.hands['0']).toEqual([]); // Sk-01 (ordinal 0) paid
    expect(G().secret.decks['0']).toEqual(['Sk-08', 'Sk-03']); // Sk-02 (ordinal 1) paid; Sk-20 already removed at selection
    expect(G().public.field['0'].map((c) => c?.label ?? null)).toEqual(['Sk-06', null, null]); // not placed yet

    // Secrecy: the scheduled entry lives in G.secret, visible to its owner...
    expect(G().secret.scheduledSummons['0']).toEqual([
      { label: 'Sk-20', summonAtGlobalTurn: 2, sourceLabel: 'Sk-06', sourceSlot: 0 },
    ]);
    // ...and hidden from the opponent's own client entirely.
    expect(G1().secret.scheduledSummons['0']).toBeUndefined();

    client.moves.endTurn(); // player 0's turn 1 ends (globalTurns -> 1)

    // Still the intervening turn: not summonable, not usable, not visible.
    expect(G().public.field['0'].map((c) => c?.label ?? null)).toEqual(['Sk-06', null, null]);
    expect(G1().secret.scheduledSummons['0']).toBeUndefined();

    client1.moves.endTurn(); // player 1's turn 1 ends (globalTurns -> 2) — player 0's next turn begins

    // Two empty slots remain (1 and 2), so placement opens a real choice —
    // the same emptyOwnFieldSlot machinery Sk-04a/Sk-08a already use.
    const placePending = G().public.pendingChoice;
    expect(placePending).not.toBeNull();
    expect(placePending?.kind).toBe('emptyOwnFieldSlot');
    expect(placePending?.sourceLabel).toBe('Sk-06');
    expect(placePending?.abilitySlot).toBe('scheduled-summon');
    expect(placePending?.options).toEqual([1, 2]);
    expect(G().secret.scheduledSummons['0']).toEqual([]); // popped off the queue already, not stranded

    client.moves.resolveChoice(1);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'].map((c) => c?.label ?? null)).toEqual(['Sk-06', 'Sk-20', null]);
  });

  test('100. the field is full when the scheduled turn arrives: the entry fizzles silently, no crash, no stranded entry', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-01', 'Sk-02', 'Sk-08'], // full — 3/3 occupied
          deck: ['Sk-03'], // lets a normal draw succeed afterward with no complication
          scheduledSummons: [{ label: 'Sk-20', summonAtGlobalTurn: 2, sourceLabel: 'Sk-06', sourceSlot: 0 }],
        },
        '1': { hand: ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05'], turnsTaken: 1 }, // full hand skips player 1's own draw-check
      },
      currentPlayer: '1',
    });

    client1.moves.endTurn(); // player 0's turn begins with globalTurns already at the scheduled threshold

    expect(G().public.pendingChoice).toBeNull(); // no crash, no stray prompt
    expect(G().secret.scheduledSummons['0']).toEqual([]); // the entry is gone, not left stranded
    expect(G().public.field['0'].map((c) => c?.label)).toEqual(['Sk-01', 'Sk-02', 'Sk-08']); // untouched — Sk-20 never appeared
  });

  test('101. the source card is removed before the scheduled turn: the entry is pruned, the card is lost', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': {
          field: ['Sk-06', null, null],
          scheduledSummons: [{ label: 'Sk-20', summonAtGlobalTurn: 100, sourceLabel: 'Sk-06', sourceSlot: 0 }],
        },
        '1': { field: ['Sk-16'], turnsTaken: 1, hand: ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05'] },
      },
      currentPlayer: '1',
    });

    client1.moves.attackBattleCard(0, 0); // Sk-16 (BP9) attacks Sk-06 (BP0 by default) and wins

    expect(G().public.field['0'][0]).toBeNull(); // Sk-06 removed
    expect(G().public.banished['0']).toContain('Sk-06');
    expect(G().secret.scheduledSummons['0']).toEqual([]); // pruned along with its source slot, not left dangling
  });

  test('102. cost cannot be paid: the eligibility pre-filter excludes the candidate, so nothing is scheduled', () => {
    const { client, G } = createTestGame({
      players: {
        // Only Sk-20 (BP2) is in the deck; after it leaves as the candidate,
        // 0 cards remain in hand+deck combined to pay its BP-2 cost.
        // Sk-06 (the sole hand card) relocated to the deck's top: the
        // automatic turn-1 auto-draw draws it right back into hand,
        // reconstructing the exact original hand/deck split.
        '0': { field: [], hand: [], deck: ['Sk-06', 'Sk-20'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-06'); // played normally
    expect(G().secret.decks['0']).toEqual(['Sk-20']); // never touched — not even offered as a candidate
    expect(G().secret.scheduledSummons['0']).toEqual([]);
  });
});

describe('Sk-09 POWER OF THE SHADOWS (attach target)', () => {
  // Sk-15 is seeded directly (bypassing onSummon, per the existing test
  // convention) so its own protectedFromBattleCardRemoval flag is never set
  // — these tests are specifically about Sk-09b's OWN protection, not
  // Sk-15a's.
  test('103. attaches to a valid Shadow Ghost, and its protection blocks an ability-driven removal (Sk-15 survives, everything else in the wipe does not)', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-25', null], hand: ['Sk-09', 'Sk-11'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-09 attaches to Shadow Ghost at slot 0

    expect(G().public.field['0'][0]?.label).toBe('Sk-15'); // host unchanged, not replaced
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-09']);
    expect(G().secret.hands['0']).toEqual(['Sk-11']); // Sk-09 left the hand
    expect(G().public.activeEffects).toEqual([
      expect.objectContaining({
        kinds: ['protectedFromRemoval'],
        targetPid: '0',
        targetSlot: 0,
        sourceLabel: 'Sk-09',
        expiresAtGlobalTurn: 2,
      }),
    ]);

    // Trigger an ability-cause field wipe (Sk-11's own overflow effect) that
    // would otherwise remove every own field card, Shadow Ghost included.
    client.moves.playCard(0, 2); // Sk-11 into slot 2 — "2+ Battle Cards" gate satisfied by Sk-15 + Sk-25
    client.moves.resolveChoice(0); // buff Sk-15 (BP7 + Sk-25's BP6 = 13, over 9)
    client.moves.resolveChoice(true); // confirm the overflow wipe

    expect(G().public.field['0'][0]?.label).toBe('Sk-15'); // protected — survives the wipe
    expect(G().public.field['0'][0]?.currentBp).toBe(13); // the buff itself still applied; only the removal was blocked
    expect(G().public.field['0'][1]).toBeNull(); // Sk-25 — unprotected — removed
    expect(G().public.field['0'][2]).toBeNull(); // Sk-11 — unprotected — removed
    expect(G().public.banished['0']).toContain('Sk-25');
    expect(G().public.banished['0']).toContain('Sk-11');
    expect(G().public.banished['0']).not.toContain('Sk-15');
  });

  test('104. no Shadow Ghost on the field: rejected, card stays in hand', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-09'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().secret.hands['0']).toEqual(['Sk-09']);
    expect(G().public.field['0']).toEqual([null, null, null]);
  });

  test('105. targeting a card that is not Shadow Ghost: rejected, card stays in hand', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', 'Sk-20', null], hand: ['Sk-09'] }, // Shadow Ghost exists, but at slot 0, not slot 1
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 1); // targets slot 1 — Sk-20, not Shadow Ghost

    expect(G().secret.hands['0']).toEqual(['Sk-09']);
    expect(G().public.field['0'][1]?.label).toBe('Sk-20'); // untouched
    expect(G().public.field['0'][1]?.attached).toEqual([]); // nothing attached
  });

  test('106. the protection expires at its stated time, and the host is removable again', () => {
    const { client, client1, G } = createTestGame({
      players: {
        // Sk-11 (the hand's trailing card) relocated to the deck's top: the
        // turn-1 auto-draw appends it right back onto the end of hand
        // (reconstructing the exact original hand ['Sk-09', 'Sk-11'] and
        // deck ['Sk-01']) before Sk-09 is even played, so the SECOND
        // auto-draw two turns later — the one this test actually cares
        // about — still finds exactly Sk-01 waiting, same as before.
        '0': { field: ['Sk-15', 'Sk-25', null], hand: ['Sk-09'], deck: ['Sk-11', 'Sk-01'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-09 attaches — expires at globalTurns 2
    client.moves.endTurn(); // globalTurns -> 1
    client1.moves.endTurn(); // globalTurns -> 2: expireTimedEffects prunes Sk-09's effect

    expect(G().public.activeEffects).toEqual([]);

    client.moves.playCard(0, 2); // Sk-11 into slot 2 (Sk-11 is still at hand index 0; the auto-draw appended Sk-01 after it)
    client.moves.resolveChoice(0); // buff Sk-15 again
    client.moves.resolveChoice(true); // confirm the overflow wipe

    expect(G().public.field['0']).toEqual([null, null, null]); // Sk-15 is no longer protected — removed along with everything else
    expect(G().public.banished['0']).toContain('Sk-15');
  });

  test('107. the host is removed while attached: the attached card is banished alongside it', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', null, null], hand: ['Sk-09'], turnsTaken: 1 },
        '1': { field: ['Sk-16'] }, // BP9 — beats Shadow Ghost (BP7) as attacker
      },
    });

    client.moves.playCard(0, 0); // Sk-09 attaches
    client.moves.attackBattleCard(0, 0); // Sk-15 attacks Sk-16 and loses (battle cause — protectedFromRemoval does not apply to battle loss)

    // Sk-15b (self-hook) is unconditionally eligible for a battle-cause
    // removal and fires first — decline it to let the removal proceed.
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-15');
    client.moves.resolveChoice(false);

    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-15');
    expect(G().public.banished['0']).toContain('Sk-09'); // the cleanup rule: attached cards are banished with their host
    expect(G().public.banishedFromField['0']).toContain('Sk-09');
  });

  test('108. the protection holds against an OPPONENT-caused removal, not just an own-turn one', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: ['Sk-15', null, null], hand: ['Sk-09'] },
        '1': { hand: ['Sk-05'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-09 attaches on player 0's own turn
    client.moves.endTurn(); // player 1's turn begins

    client1.moves.playCard(0, 0); // opponent plays Sk-05 ("Remove one Battle Card from the field face-up")
    client1.moves.resolveChoice(0); // targets Shadow Ghost — the only candidate

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-15'); // protection held — the removal was prevented outright
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-09']);
    expect(G().public.banished['0']).not.toContain('Sk-15');
  });
});

describe('Sk-26 ABDUCTION SAUCER (steal-and-hold, once per turn)', () => {
  test('109. takes an opponent Battle Card: it leaves their field and is held, publicly visible to both clients', () => {
    const { client, G, G1 } = createTestGame({
      players: {
        '0': { field: ['Sk-26', null, null] },
        '1': { field: ['Sk-20'] }, // BP2 Battle Card
      },
    });

    client.moves.activateAbility(0);

    const pending = G().public.pendingChoice;
    expect(pending?.kind).toBe('opponentField');
    expect(pending?.sourceLabel).toBe('Sk-26');
    expect(pending?.abilitySlot).toBe('a-target');
    expect(pending?.options).toEqual([0]);

    client.moves.resolveChoice(0);

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]).toBeNull(); // left the opponent's field
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-20']); // held under Sk-26
    expect(G().public.banished['1']).not.toContain('Sk-20'); // never actually banished, redirected

    // Publicity, not secrecy: FieldCard.attached lives in G.public, so both
    // clients see the SAME held card, including the opponent it was taken
    // from — "place it under this card" is a physical, face-up action, and
    // nothing in the text says otherwise (unlike Sk-06's own secret
    // scheduled-summon queue, which IS a hidden deck selection).
    expect(G1().public.field['0'][0]?.attached).toEqual(['Sk-20']);
  });

  test('110. a second attempt in the same turn is rejected; it works again on the next turn', () => {
    const { client, client1, G } = createTestGame({
      players: {
        // deck fillers: once both players have taken a turn, turn.onBegin
        // attempts a normal draw for whoever's turn is starting, and an
        // empty deck there would auto-lose that player before this test's
        // own assertions run. Player 0 now goes through the auto-draw
        // TWICE in this test (the turn-1 draw at construction, then the
        // real one at their second onBegin two endTurns later) — an extra
        // Sk-30 filler ahead of Sk-02 absorbs the first, leaving Sk-02 for
        // the second exactly as this test always intended. Hand content is
        // never asserted in this test, so which card lands there doesn't
        // matter — only that the deck never runs dry mid-sequence.
        '0': { field: ['Sk-26', null, null], deck: ['Sk-30', 'Sk-02'] },
        '1': { field: ['Sk-20', 'Sk-21'], deck: ['Sk-01'] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(0); // takes Sk-20 (slot 0)

    client.moves.activateAbility(0); // same turn, second attempt

    expect(G().public.pendingChoice).toBeNull(); // rejected outright — no trigger fired
    expect(G().public.field['1'][0]).toBeNull(); // Sk-20's slot, still empty
    expect(G().public.field['1'][1]?.label).toBe('Sk-21'); // untouched — still in its original slot
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-20']); // no second card taken

    client.moves.endTurn(); // globalTurns -> 1, the lock (expires at 1) is already gone
    client1.moves.endTurn(); // globalTurns -> 2, back to player 0's turn

    client.moves.activateAbility(0); // succeeds again
    client.moves.resolveChoice(1); // Sk-21 is still at slot 1 — the only candidate now

    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-20', 'Sk-21']);
  });

  test('111. a card the opponent has protected cannot be taken', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-26', null, null] },
        '1': { field: [{ label: 'Sk-20', protectedFromBattleCardRemoval: true }] },
      },
    });

    client.moves.activateAbility(0);
    client.moves.resolveChoice(0); // Sk-20 is still offered as a target — the option itself isn't pre-filtered

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][0]?.label).toBe('Sk-20'); // untouched — the take silently failed
    expect(G().public.field['0'][0]?.attached).toEqual([]); // nothing taken
    expect(G().public.banished['1']).not.toContain('Sk-20');
  });

  test('112. Sk-26b returns held cards when Sk-26 is removed by a card effect', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-26', attached: ['Sk-20'] }, null, null] },
        '1': { field: ['Sk-01', null, null], hand: ['Sk-05'] }, // one filler + one empty slot, so the return auto-places with no further choice
      },
      currentPlayer: '1',
    });

    client1.moves.playCard(0, 1); // opponent plays Sk-05 targeting player 0's field
    client1.moves.resolveChoice(0); // Sk-26 is the only Battle Card there

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]).toBeNull(); // Sk-26 removed
    expect(G().public.banished['0']).toContain('Sk-26');
    expect(G().public.field['1'][2]?.label).toBe('Sk-20'); // returned to its original owner's field, not banished
    expect(G().public.banished['1']).not.toContain('Sk-20');
  });

  test('113. Sk-26 removed by an ordinary battle loss does NOT trigger 26b: held cards are banished with it, not returned', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-26', attached: ['Sk-20'] }, null, null], turnsTaken: 1 },
        '1': { field: ['Sk-16'] }, // BP9 — beats Sk-26 (BP5) as defender
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-26 attacks and loses (battle cause)

    expect(G().public.field['0'][0]).toBeNull();
    expect(G().public.banished['0']).toContain('Sk-26');
    expect(G().public.banished['0']).toContain('Sk-20'); // banished alongside its host — NOT returned to player 1
    expect(G().public.banishedFromField['0']).toContain('Sk-20');
    expect(G().public.field['1'][0]?.label).toBe('Sk-16'); // player 1's own field is untouched — nothing returned there
  });
});

describe('Sk-18 EMPTY VESSEL (copy-identity)', () => {
  test('114. copying a higher-BP removed card lets Sk-18 win a battle its own printed BP (1) would have lost', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-16 WAR DRAGON, BP 9, sitting in the removed pile to be copied.
        '0': { hand: ['Sk-18'], banished: ['Sk-16'], turnsTaken: 1 },
        // Sk-17 BLOAT DRAGON, BP 3 — beats Sk-18's own printed BP 1, but
        // loses to a copied BP 9.
        '1': { field: ['Sk-17'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-18 onto slot 0 — fires onSummon
    client.moves.resolveChoice(true); // "copy a removed card?" — yes
    client.moves.resolveChoice(0); // only candidate: Sk-16 at removed-pile index 0

    expect(G().public.field['0'][0]?.copiedIdentity).toBe('Sk-16');
    expect(G().public.field['0'][0]?.currentBp).toBe(9); // Sk-16's printed BP, not Sk-18's own (1)

    client.moves.attackBattleCard(0, 0); // Sk-18 (BP9 via copy) attacks Sk-17 (BP3)

    expect(G().public.field['1'][0]).toBeNull(); // Sk-17 removed
    expect(G().public.banished['1']).toContain('Sk-17');
    expect(G().public.field['0'][0]?.label).toBe('Sk-18'); // attacker survives — would NOT have, at printed BP 1
  });

  test('115. the copied card\'s own ability fires for Sk-18, through the exact same dispatch', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-18', copiedIdentity: 'Sk-26', currentBp: 1 }, null, null] },
        '1': { field: ['Sk-20', null, null] },
      },
    });

    client.moves.activateAbility(0); // dispatched via ABILITIES_BY_LABEL['Sk-26'] (Sk-26's own onActivate)
    client.moves.resolveChoice(0); // Sk-20 is the only Battle Card on the opponent's field

    expect(G().public.field['1'][0]).toBeNull(); // taken, exactly like a real Sk-26 would
    expect(G().public.field['0'][0]?.attached).toEqual(['Sk-20']); // held under Sk-18's OWN slot
    expect(G().public.field['0'][0]?.label).toBe('Sk-18'); // physical identity never changed
  });

  test('116. copying a card with a removal hook: the hook fires for the copy (Step 1d)', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-19 THE HEADLESS HORSEMAN, BP 5 as copied.
        '0': { field: [{ label: 'Sk-18', copiedIdentity: 'Sk-19', currentBp: 5 }, null, null], turnsTaken: 1 },
        '1': { field: ['Sk-16'] }, // BP 9 — beats the copied BP 5
      },
    });

    client.moves.attackBattleCard(0, 0); // Sk-18 (as Sk-19, BP5) attacks and would lose to BP9

    // REMOVAL_HOOKS is consulted by effectiveLabel, so Sk-19's own hook
    // opens — not a plain removal.
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-19');
    expect(G().public.pendingChoice?.kind).toBe('yesNo');

    client.moves.resolveChoice(true); // remain on the field instead (once only)

    expect(G().public.field['0'][0]?.label).toBe('Sk-18'); // still physically Sk-18
    expect(G().public.field['0'][0]?.replacementUsed).toBe(true);
    expect(G().public.banished['0']).not.toContain('Sk-18');
    expect(G().public.banished['0']).not.toContain('Sk-19');
  });

  test('117. Sk-18b does not fire while the copied removed card is still removed', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-18', copiedIdentity: 'Sk-16', currentBp: 9 }, null, null], banished: ['Sk-16'] },
        '1': { field: [] },
      },
    });

    client.moves.endTurn(); // turn.onEnd -> checkCopyIdentityIntegrity

    expect(G().public.field['0'][0]?.label).toBe('Sk-18'); // untouched — Sk-16 is still in the removed pile
    expect(G().public.banishedFaceDown['0']).toBe(0);
  });

  test('118. Sk-18b fires (face-down, no label revealed) once the copied removed card is no longer removed', () => {
    const { client, G } = createTestGame({
      players: {
        // Sk-16 copied earlier, but is NOT in the removed pile any more —
        // e.g. it was retrieved by some other effect since Sk-18 copied it.
        '0': { field: [{ label: 'Sk-18', copiedIdentity: 'Sk-16', currentBp: 9 }, null, null], banished: [] },
        '1': { field: [] },
      },
    });

    client.moves.endTurn(); // turn.onEnd -> checkCopyIdentityIntegrity

    expect(G().public.field['0'][0]).toBeNull(); // removed
    expect(G().public.banishedFaceDown['0']).toBe(1); // face-down: count only
    expect(G().public.banished['0']).not.toContain('Sk-18'); // never revealed face-up
    expect(G().public.banished['0']).not.toContain('Sk-16');
  });

  test('119. no eligible copy target (empty removed pile): resolves silently, Sk-18 stays its own printed self', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-18'], banished: [] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0);

    expect(G().public.pendingChoice).toBeNull(); // the yesNo never opened — willHaveLegalOutcome's look-ahead
    expect(G().public.field['0'][0]?.label).toBe('Sk-18');
    expect(G().public.field['0'][0]?.currentBp).toBe(1); // printed BP, no copy applied
    expect(G().public.field['0'][0]?.copiedIdentity).toBeUndefined();
  });

  test('120. copied identity is fully public: both clients see the same value (publicity, not secrecy)', () => {
    const { G, G1 } = createTestGame({
      players: {
        '0': { field: [{ label: 'Sk-18', copiedIdentity: 'Sk-16', currentBp: 9 }, null, null] },
        '1': { field: [] },
      },
    });

    // FieldCard.copiedIdentity lives in G.public.field, exactly like
    // currentBp/attached — no secrecy zone involved, matching Sk-18's text
    // never saying the copy is hidden (contrast Sk-06's own secret
    // scheduledSummons queue).
    expect(G().public.field['0'][0]?.copiedIdentity).toBe('Sk-16');
    expect(G1().public.field['0'][0]?.copiedIdentity).toBe('Sk-16');
  });
});

describe('Sk-21 SAND SQUID (shuffle-and-guess)', () => {
  // Seeds and field compositions below were found by direct observation
  // (running each seed against both possible guess indices and reading the
  // outcome) — ctx.random.Shuffle's output for a given seed/input isn't
  // meant to be predicted by inspection, only reproduced.

  test('121. a correct guess (known seed) removes all of the opponent\'s Battle Cards', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        '1': { field: ['Sk-20', 'Sk-17'] },
      },
      seed: 'sk21-wrongguess-seed',
    });

    client.moves.attackBattleCard(0, 0);
    expect(G().public.pendingChoice?.kind).toBe('yesNo');
    client.moves.resolveChoice(true);
    expect(G().public.pendingChoice?.kind).toBe('opponentField');
    client.moves.resolveChoice(0); // correct, for this seed

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1']).toEqual([null, null, null]);
    expect(G().public.banished['1']).toEqual(expect.arrayContaining(['Sk-20', 'Sk-17']));
    expect(G().public.field['0'][0]?.currentBp).toBe(6); // Sk-21's own BP untouched by a correct guess
  });

  test('122. a wrong guess decreases Sk-21\'s own BP by 2, permanently, and normal combat still follows', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        '1': { field: ['Sk-20', 'Sk-17'] }, // Sk-20 (BP2) is the declared attack target
      },
      seed: 'sk21-wrongguess-seed',
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(true);
    client.moves.resolveChoice(1); // wrong, for this seed

    expect(G().public.field['0'][0]?.currentBp).toBe(4); // 6 - 2, permanent (no ActiveEffect, no expiry)
    // Normal combat still resolves afterward against the ORIGINAL declared
    // target (Sk-20, slot 0) using the now-reduced BP: 4 > 2, so Sk-20 is
    // still removed — but via the ordinary battle-cause path, not Sk-21a's
    // own "remove all" sweep (which never fires on a wrong guess at all).
    expect(G().public.field['1'][0]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-20');
    // Sk-17 was never the declared target and the sweep never ran — untouched.
    expect(G().public.field['1'][1]?.label).toBe('Sk-17');
  });

  test('123. the same seed produces the same shuffle result twice (reproducibility)', () => {
    const setup = {
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        '1': { field: ['Sk-20', 'Sk-17'] },
      },
      seed: 'sk21-wrongguess-seed',
    };

    const run1 = createTestGame(setup);
    run1.client.moves.attackBattleCard(0, 0);
    run1.client.moves.resolveChoice(true);
    run1.client.moves.resolveChoice(0);

    const run2 = createTestGame(setup);
    run2.client.moves.attackBattleCard(0, 0);
    run2.client.moves.resolveChoice(true);
    run2.client.moves.resolveChoice(0);

    expect(run1.G().public.field['1']).toEqual(run2.G().public.field['1']);
    expect(run1.G().public.field['0'][0]?.currentBp).toEqual(run2.G().public.field['0'][0]?.currentBp);
    expect(run1.G().public.banished['1']).toEqual(run2.G().public.banished['1']);
  });

  test('124. a protected opponent card is not removed by a correct guess, even though the rest of the field is', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        // Sk-17 (unprotected) is the declared attack target; Sk-20 carries
        // protectedFromBattleCardRemoval, which only blocks cause: 'ability'
        // removal — exactly what the "remove all" sweep uses.
        '1': { field: ['Sk-17', { label: 'Sk-20', protectedFromBattleCardRemoval: true }] },
      },
      seed: 'sk21-protected-seed',
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(true);
    client.moves.resolveChoice(1); // correct, for this seed

    expect(G().public.field['1'][0]).toBeNull(); // Sk-17 removed by the sweep
    expect(G().public.banished['1']).toContain('Sk-17');
    expect(G().public.field['1'][1]?.label).toBe('Sk-20'); // protected — routed through removeFieldCard, which returned 'prevented'
    expect(G().public.banished['1']).not.toContain('Sk-20');
    // theirSlot (0) was removed by the sweep itself, so resolveBattleOutcome's
    // own fallback find nothing left to fight and safely no-ops.
    expect(G().public.field['0'][0]?.currentBp).toBe(6);
  });

  test('125. an opponent field with no Battle Cards: the gambit is skipped silently, normal combat resolves directly', () => {
    // Sk-02 is an Action Card, never eligible for the ability's "select all
    // Battle Cards" text — seeded directly onto the field (bypassing normal
    // play legality) specifically to exercise the type-filtered zero-target
    // gate: attackBattleCard's own precondition only requires a non-null
    // defender, not a Battle Card one, so this is reachable through the real
    // move even though ordinary play would never place a non-Battle Card on
    // the field this way.
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        '1': { field: ['Sk-02'] },
      },
    });

    client.moves.attackBattleCard(0, 0);

    expect(G().public.pendingChoice).toBeNull(); // the yesNo never opened at all
    expect(G().public.field['1'][0]).toBeNull(); // normal combat still ran: Sk-21 (BP6) beat Sk-02's fallback BP 0
    expect(G().public.field['0'][0]?.currentBp).toBe(6); // untouched — no gambit, no penalty
  });

  test('126. the flip result is genuinely hidden from both clients while the guess is pending', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { field: ['Sk-21'], turnsTaken: 1 },
        '1': { field: ['Sk-20', 'Sk-17'] },
      },
      seed: 'sk21-wrongguess-seed',
    });

    client.moves.attackBattleCard(0, 0);
    client.moves.resolveChoice(true);

    // The guess pendingChoice is now open — both real field positions stay
    // fully visible (this design never hides FieldCard identities; see the
    // Step 2 report), but the one thing that actually matters for the guess
    // — which card the engine already secretly drew — is never exposed
    // through EITHER client's own playerView, not even Sk-21's own
    // controller's.
    expect(G().public.pendingChoice?.kind).toBe('opponentField');
    expect(G().secret.pendingFlip).toEqual({});
    expect(G1().secret.pendingFlip).toEqual({});

    client.moves.resolveChoice(0);
    expect(G().secret.pendingFlip).toEqual({}); // still empty after resolution — cleared, never revealed
  });
});

describe('Sk-16c/d WAR DRAGON (reactive negation window)', () => {
  test('127. Sk-16c: negating a Power Card stops its effect from ever firing, but it stays played', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-12'], field: [] },
        // Sk-11 (power) is the one payable face-down cost card — the
        // dispatchSearch cost step auto-resolves with no second prompt.
        '1': { field: ['Sk-16', 'Sk-17'], hand: ['Sk-11'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-12 (power) placed at slot 0, onSummon suppressed

    expect(G().public.field['0'][0]?.label).toBe('Sk-12'); // already played, occupying its slot
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-16');
    expect(G().public.pendingChoice?.abilitySlot).toBe('c-confirm');
    expect(G().public.pendingChoice?.kind).toBe('yesNo');
    expect(G().public.pendingChoice?.pid).toBe('1'); // War Dragon's own owner, not the acting player

    client1.moves.resolveChoice(true); // negate

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['0'][0]?.label).toBe('Sk-12'); // still played — negation cancels the EFFECT, not the play
    expect(G().public.activeEffects).toEqual([]); // Sk-12's own onSummon (the lock) never fired
    expect(G().public.handCounts['1']).toBe(0); // the face-down Power Card was paid
    expect(G().public.banishedFaceDown['1']).toBe(1);
    expect(G().public.banished['1']).not.toContain('Sk-11'); // paid face down, label never revealed
  });

  test('128. Sk-16c: declining lets the Power Card resolve exactly as it would with no War Dragon at all', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-12'], field: [] },
        '1': { field: ['Sk-16', 'Sk-17'], hand: ['Sk-11'] },
      },
    });

    client.moves.playCard(0, 0);
    client1.moves.resolveChoice(false); // decline

    // Declining resumes Sk-12's own onSummon — its own opponentField target
    // choice, exactly as if War Dragon had never been consulted at all.
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-12');
    expect(G().public.pendingChoice?.kind).toBe('opponentField');

    client.moves.resolveChoice(1); // target Sk-17 (BP3, index 1)

    expect(G().public.activeEffects).toHaveLength(1);
    expect(G().public.activeEffects[0]).toMatchObject({
      sourceLabel: 'Sk-12',
      targetPid: '1',
      targetSlot: 1,
      kinds: expect.arrayContaining(['cannotAttack', 'cannotBeAttacked', 'cannotUseEffects']),
    });
    expect(G().public.handCounts['1']).toBe(1); // nothing paid — the cost step never opened
    expect(G().public.banishedFaceDown['1']).toBe(0);
  });

  test('129. Sk-16c: no payable Power Card in hand — the window never opens at all', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-12'], field: [] },
        '1': { field: ['Sk-16', 'Sk-17'], hand: [] }, // War Dragon present, but nothing to pay with
      },
    });

    client.moves.playCard(0, 0);

    // Straight to Sk-12's own target choice — no 'Sk-16'/c-confirm prompt
    // ever appeared in between.
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-12');
    expect(G().public.pendingChoice?.kind).toBe('opponentField');

    client.moves.resolveChoice(1);
    expect(G().public.activeEffects).toHaveLength(1);
    expect(G().public.banishedFaceDown['1']).toBe(0);
  });

  test('130. Sk-16d: negating an Action Card\'s field removal leaves the targeted card untouched', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-05'], field: [] },
        // Sk-02 (action) is the one payable face-down cost card.
        '1': { field: ['Sk-16', 'Sk-17'], hand: ['Sk-02'] },
      },
    });

    client.moves.playCard(0, 0); // Sk-05 (action) — onSummon fires immediately, unlike a Power Card
    client.moves.resolveChoice(1); // Sk-05a targets Sk-17 (index 1), not War Dragon itself

    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-16');
    expect(G().public.pendingChoice?.abilitySlot).toBe('d-confirm');
    expect(G().public.pendingChoice?.pid).toBe('1');
    expect(G().public.field['1'][1]?.label).toBe('Sk-17'); // not removed yet — the window is still open

    client1.moves.resolveChoice(true); // negate

    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][1]?.label).toBe('Sk-17'); // removal never happened
    expect(G().public.banished['1']).not.toContain('Sk-17');
    expect(G().public.handCounts['1']).toBe(0); // Sk-02 paid face down
    expect(G().public.banishedFaceDown['1']).toBe(1);
    expect(G().public.banished['1']).not.toContain('Sk-02'); // paid face down, label never revealed
  });

  test('131. Sk-16d: declining lets the removal resolve exactly as it would with no War Dragon at all', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-05'], field: [] },
        '1': { field: ['Sk-16', 'Sk-17'], hand: ['Sk-02'] },
      },
    });

    client.moves.playCard(0, 0);
    client.moves.resolveChoice(1);
    client1.moves.resolveChoice(false); // decline

    expect(G().public.pendingChoice).toBeNull(); // Sk-05 has no follow-up clause, unlike Sk-03b
    expect(G().public.field['1'][1]).toBeNull(); // removed, as normal
    expect(G().public.banished['1']).toContain('Sk-17');
    expect(G().public.handCounts['1']).toBe(1); // nothing paid
    expect(G().public.banishedFaceDown['1']).toBe(0);
  });

  test('132. Sk-16d: no payable Action Card in hand — the removal resolves immediately, no window opens', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-05'], field: [] },
        '1': { field: ['Sk-16', 'Sk-17'], hand: [] },
      },
    });

    client.moves.playCard(0, 0);
    client.moves.resolveChoice(1);

    // No intervening 'Sk-16' prompt — resolveChoice(1) went straight through
    // to the removal in the same dispatch.
    expect(G().public.pendingChoice).toBeNull();
    expect(G().public.field['1'][1]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-17');
  });

  test('133. the attacker (acting player) cannot act while a negation window is open', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        '0': { hand: ['Sk-05', 'Sk-01'], field: [] },
        '1': { field: ['Sk-16', 'Sk-17'], hand: ['Sk-02'] },
      },
    });

    client.moves.playCard(0, 0); // play Sk-05
    client.moves.resolveChoice(1); // target Sk-17 — opens Sk-16d's own window, owned by player 1

    expect(G().public.pendingChoice?.pid).toBe('1');

    // Player 0 (the acting player, still ctx.currentPlayer) attempts to act
    // again while player 1's negation choice is open.
    client.moves.playCard(0, 1); // second card, different slot
    client.moves.endTurn();

    expect(G().public.pendingChoice?.abilitySlot).toBe('d-confirm'); // still open — neither attempt got through
    expect(G().public.field['0'][1]).toBeNull(); // the second card never got played
    expect(G1().secret.hands['0']).toBeUndefined(); // (sanity: player 1's own view never sees player 0's hand anyway)
    expect(client.getState()?.ctx.currentPlayer).toBe('0'); // turn never passed

    client1.moves.resolveChoice(true); // the defender answers, only now can play resume
    expect(G().public.pendingChoice).toBeNull();
  });

  test('134. with no War Dragon on the field, every existing Power and Action card resolves exactly as before', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-12', 'Sk-05'], field: [] },
        '1': { field: ['Sk-17', 'Sk-19'] }, // no War Dragon anywhere
      },
    });

    client.moves.playCard(0, 0); // Sk-12 (power)
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-12'); // no 'Sk-16' window intervened
    client.moves.resolveChoice(0); // target Sk-17
    expect(G().public.activeEffects).toHaveLength(1);

    client.moves.playCard(0, 1); // Sk-05 (action) — same hand, next slot
    expect(G().public.pendingChoice?.sourceLabel).toBe('Sk-05');
    client.moves.resolveChoice(1); // target Sk-19 (index 1 — Sk-17 is protected by Sk-12's own lock, but still offered)
    expect(G().public.field['1'][1]).toBeNull();
    expect(G().public.banished['1']).toContain('Sk-19');
  });
});

describe('Sk-28b/c SKULLFACE (planted-card countdown)', () => {
  test('135. Sk-28a plants it: hand cleared, the card leaves the field, is inserted into the opponent\'s deck, and the plant is recorded', () => {
    const { client, G1 } = createTestGame({
      players: {
        '0': { hand: ['Sk-28', 'Sk-01'], field: [] },
        '1': { deck: ['Sk-02', 'Sk-03', 'Sk-04'] },
      },
    });

    client.moves.playCard(0, 0);

    // Own-side assertions (via the planter's own client) are covered
    // implicitly below through G1() for the target's deck, since decks are
    // only ever visible to their own owner.
    expect(G1().public.field['0'][0]).toBeNull(); // relocated, not banished
    expect(G1().public.handCounts['0']).toBe(0); // "remove all cards in your hand" — Sk-28 played, Sk-01 discarded too
    expect(G1().secret.decks['1']).toContain('Sk-28');
    expect(G1().secret.decks['1']).toHaveLength(4); // 3 original + Sk-28
    expect(G1().secret.skullfacePlant['1']).toEqual({ plantedAtGlobalTurn: 0, plantedByPid: '0' });
  });

  test('136. drawing Sk-28 within the window fires Sk-28b: the top three of the DRAWER\'S OWN deck are removed', () => {
    const { client1, G } = createTestGame({
      players: {
        '0': {},
        '1': {
          deck: ['Sk-28', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05'],
          skullfacePlant: { plantedAtGlobalTurn: 0, plantedByPid: '0' },
        },
      },
      currentPlayer: '1',
    });

    // Reaching currentPlayer: '1' dispatches an implicit endTurn during
    // construction (see createTestGame), which already ran player 1's own
    // first onBegin — the automatic turn-1 draw already performed this
    // exact draw before the test body even starts.

    expect(G().public.handCounts['1']).toBe(1); // Sk-28 itself, drawn normally — still played out, not intercepted
    expect(G().public.deckCounts['1']).toBe(1); // 5 - 1 (drawn) - 3 (payoff) = 1 left
    expect(G().public.banished['1']).toEqual(expect.arrayContaining(['Sk-02', 'Sk-03', 'Sk-04']));
    expect(G().public.banished['1']).toHaveLength(3);
  });

  test('137. not drawing it within the window fires Sk-28c at the correct turn, not before', () => {
    const { client, client1, G, G1 } = createTestGame({
      players: {
        // Hands start full (5 = MAX_HAND_SIZE) on both sides specifically to
        // suppress turn.onBegin's own auto-draw throughout this test — an
        // unrelated auto-draw pulling Sk-28 early would confound the
        // "not drawn" scenario this test is isolating.
        '0': { hand: ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05'], deck: ['Sk-06', 'Sk-07', 'Sk-08', 'Sk-09'], turnsTaken: 4 },
        '1': {
          hand: ['Sk-10', 'Sk-11', 'Sk-12', 'Sk-13', 'Sk-14'],
          deck: ['Sk-15', 'Sk-28', 'Sk-16'],
          turnsTaken: 4,
          skullfacePlant: { plantedAtGlobalTurn: 0, plantedByPid: '0' },
        },
      },
      // globalTurns = 8 to start; the window closes at 10.
    });

    client.moves.endTurn(); // globalTurns -> 9, still < 10 — the window is still open

    expect(G1().secret.skullfacePlant['1']).not.toBeNull();
    expect(G1().secret.decks['1']).toContain('Sk-28');
    expect(G().public.banishedFaceDown['1']).toBe(0);

    client1.moves.endTurn(); // globalTurns -> 10 — the window closes exactly here

    expect(G1().secret.skullfacePlant['1']).toBeNull();
    expect(G1().secret.decks['1']).not.toContain('Sk-28'); // removed face down
    expect(G().public.banishedFaceDown['1']).toBe(1);
    expect(G().public.banished['1']).not.toContain('Sk-28'); // face down — label never revealed
    // "you remove the top three cards of YOUR deck" — the PLANTER's (player
    // 0's) own deck, not the target's.
    expect(G().public.deckCounts['0']).toBe(1); // 4 - 3
    expect(G().public.banished['0']).toEqual(expect.arrayContaining(['Sk-06', 'Sk-07', 'Sk-08']));
  });

  test('138. skullfacePlant tracking is unaffected by an unrelated Sk-07a shuffle, and the plant still resolves correctly afterward', () => {
    const TEN_REMOVED = ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04', 'Sk-05', 'Sk-06', 'Sk-09', 'Sk-10', 'Sk-11', 'Sk-12'];
    const { client, G, G1 } = createTestGame({
      players: {
        // Player 0 triggers Sk-07a's own shuffle-into-deck on THEIR OWN
        // deck — structurally unrelated to Sk-28's plant, which concerns
        // player 1's deck (Sk-07a's own trigger requires the deck to be
        // completely empty right after Sk-07 is drawn, so an active plant
        // can never be sitting in the SAME deck being shuffled into at that
        // exact moment — this proves the same thing more directly: nothing
        // about shuffling ANY deck can reach across and disturb tracking
        // keyed by a DIFFERENT player).
        '0': { hand: [], deck: ['Sk-07'], banished: [...TEN_REMOVED] },
        '1': {
          deck: ['Sk-13', 'Sk-28', 'Sk-14'],
          skullfacePlant: { plantedAtGlobalTurn: 0, plantedByPid: '0' },
        },
      },
    });

    // The automatic turn-1 draw already drew Sk-07 as player 0's last deck
    // card during construction — see the equivalent note on test 24 above.
    client.moves.resolveChoice(true); // shuffles 10 removed cards into player 0's OWN deck

    expect(G().secret.decks['0']).toHaveLength(10); // player 0's own deck, unrelated to Sk-28

    // Player 1's plant and deck are completely untouched by player 0's shuffle.
    expect(G1().secret.skullfacePlant['1']).toEqual({ plantedAtGlobalTurn: 0, plantedByPid: '0' });
    expect(G1().secret.decks['1']).toEqual(['Sk-13', 'Sk-28', 'Sk-14']);
  });

  test('139. skullfacePlant is visible only to the target, not the planter; deck order stays hidden as always', () => {
    const { G, G1 } = createTestGame({
      players: {
        '0': { deck: ['Sk-01', 'Sk-02'] },
        '1': {
          deck: ['Sk-03', 'Sk-28', 'Sk-04'],
          skullfacePlant: { plantedAtGlobalTurn: 0, plantedByPid: '0' },
        },
      },
    });

    // Player 0 (the planter) cannot see player 1's plant, or their deck's
    // order/contents, at all — neither key is present in player 0's own
    // playerView, matching every other secret field's existing convention.
    expect(G().secret.skullfacePlant['1']).toBeUndefined();
    expect(G().secret.decks['1']).toBeUndefined();

    // Player 1 (the target) sees their own plant, the same way they already
    // see their own deck.
    expect(G1().secret.skullfacePlant['1']).toEqual({ plantedAtGlobalTurn: 0, plantedByPid: '0' });
  });

  test('140. draw and the empty-deck loss check behave exactly as before, with no Sk-28 anywhere in play', () => {
    const { client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-01', 'Sk-02', 'Sk-03', 'Sk-04'], deck: [] },
        '1': { hand: ['Sk-05', 'Sk-06', 'Sk-07', 'Sk-08'], deck: ['Sk-09'], turnsTaken: 1 },
      },
      currentPlayer: '1',
    });

    client1.moves.endTurn(); // -> player 0's turn; bothReady, hand < 5, deck empty -> loss

    expect(G().public.loser).toBe('0');
  });
});

describe('attackHandRandom (Sk-02 hand/deck-attack intercept parity)', () => {
  // GAP 2: attackHandRandom had never been referenced by any test in the
  // repo, so the fix wiring it through interceptHandOrDeckAttack (the same
  // Sk-02 "attacked while in hand" guard attackHand and attackDeck already
  // used) had zero coverage. Both seeds below were verified empirically
  // against this exact harness (createTestGame's seed threads straight into
  // boardgame.io's own deterministic PRNG): seed 'a' makes random.Die(3)
  // pick index 1 of a 3-card hand; seed 'f' makes it pick index 0. Neither
  // depends on which labels sit in the hand — only on hand length and the
  // fixed seed — so the same seed is reused across fixtures below with
  // confidence it lands on the same index every time.
  test('141b. Sk-02 sitting in the defender\'s hand: attackHandRandom\'s intercept fires — the attacking card is removed, Sk-02 is never touched', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { hand: ['Sk-01', 'Sk-02', 'Sk-03'] }, // seed 'a' -> random.Die(3) picks index 1 = Sk-02
      },
      seed: 'a',
    });

    client.moves.attackHandRandom(0);

    expect(G().public.field['0'][0]).toBeNull(); // the attacker itself was removed
    expect(G().public.banished['0']).toContain('Sk-14');
    expect(G().public.handCounts['1']).toBe(3); // Sk-02's hand is completely untouched
    expect(G().public.banished['1']).toEqual([]); // nothing removed from the defender's hand
    expect(G().public.attackedThisTurn).toBe(true);
  });

  test('141c. no Sk-02 anywhere in the defender\'s hand: attackHandRandom resolves normally — the intercept did not change the ordinary path', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { hand: ['Sk-04', 'Sk-01', 'Sk-03'] }, // no Sk-02 anywhere; seed 'f' -> index 0 = Sk-04
      },
      seed: 'f',
    });

    client.moves.attackHandRandom(0);

    expect(G().public.field['0'][0]?.label).toBe('Sk-14'); // attacker untouched — no intercept fired
    expect(G().public.banished['0']).toEqual([]);
    expect(G().public.handCounts['1']).toBe(2); // one card removed from the defender's hand, as normal
    expect(G().public.banished['1']).toContain('Sk-04');
    expect(G().public.attackedThisTurn).toBe(true);
  });

  test('141d. attackHand and attackHandRandom now behave identically with respect to the Sk-02 intercept', () => {
    // A: attackHand, explicit target index -> deliberately aimed at Sk-02.
    const gameA = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { hand: ['Sk-04', 'Sk-02', 'Sk-03'] },
      },
    });
    gameA.client.moves.attackHand(0, 1); // index 1 = Sk-02, explicit

    // B: attackHandRandom, seeded so the RNG lands on the same index (1) —
    // reaching Sk-02 through the random path instead of an explicit choice.
    const gameB = createTestGame({
      players: {
        '0': { field: ['Sk-14'], turnsTaken: 1 },
        '1': { hand: ['Sk-01', 'Sk-02', 'Sk-03'] },
      },
      seed: 'a',
    });
    gameB.client.moves.attackHandRandom(0);

    // Both paths must produce the exact same shape of outcome: the
    // intercept fires, the attacker is banished instead of Sk-02, and the
    // defender's hand is completely untouched.
    for (const { G } of [gameA, gameB]) {
      expect(G().public.field['0'][0]).toBeNull();
      expect(G().public.banished['0']).toContain('Sk-14');
      expect(G().public.handCounts['1']).toBe(3);
      expect(G().public.banished['1']).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// One-Battle-Card-per-turn limit. Sk-27 (CRIMSON SHE-KNIGHT) and Sk-29
// (RAREWOLF) are both plain Battle Cards with no onSummon effect of their
// own (Sk-27's ability triggers onBattleWin, Sk-29's is a GUARDIAN_HOOKS
// entry consulted on removal), so playing either never opens a pendingChoice
// — clean candidates for a limit test that only cares about placement itself.
// Sk-01/Sk-02 are similarly the simplest Action Cards (Sk-01 is a bare
// global-flag flip, Sk-02 has no ABILITIES_BY_LABEL entry at all).
// ---------------------------------------------------------------------------
describe('Battle Card per-turn limit', () => {
  test('a1. one Battle Card per turn: a second is rejected, leaving hand and field unchanged', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-27', 'Sk-29'], deck: ['Sk-17'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-27 into slot 0 — the turn's one Battle Card
    expect(G().public.field['0'][0]?.label).toBe('Sk-27');
    expect(G().public.battleCardPlayedThisTurn).toBe(true);

    client.moves.playCard(0, 1); // Sk-29 (now hand index 0) — second Battle Card, rejected
    expect(G().public.field['0'][1]).toBeNull();
    expect(G().secret.hands['0']).toContain('Sk-29');
    expect(G().public.field['0'].filter((c) => c?.label === 'Sk-29')).toHaveLength(0);
  });

  test('a2. playing a Battle Card does not block playing an Action or Power card the same turn', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-27', 'Sk-01'], deck: ['Sk-17'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-27 (Battle) into slot 0
    expect(G().public.field['0'][0]?.label).toBe('Sk-27');
    expect(G().public.battleCardPlayedThisTurn).toBe(true);

    client.moves.playCard(0, 1); // Sk-01 (Action) into slot 1 — not blocked by the Battle Card limit
    expect(G().public.field['0'][1]?.label).toBe('Sk-01');
    expect(G().public.rulesOfEngagementActive).toBe(true);
  });

  test('a3. the limit resets on the next turn', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-27', 'Sk-29'], deck: ['Sk-17', 'Sk-18'], turnsTaken: 1 },
        '1': { field: [], hand: [], deck: ['Sk-19', 'Sk-20'], turnsTaken: 1 },
      },
    });

    client.moves.playCard(0, 0); // Sk-27 — this turn's one Battle Card
    expect(G().public.battleCardPlayedThisTurn).toBe(true);

    client.moves.endTurn(); // -> player 1's turn (flag reset in onBegin)
    client1.moves.endTurn(); // -> back to player 0 (flag reset again)

    expect(G().public.battleCardPlayedThisTurn).toBe(false);

    // Locate Sk-29 by label rather than assuming its hand index — the
    // intervening auto-draws (see the Draw rework tests below) may have
    // appended cards ahead of it.
    const idx = G().secret.hands['0'].indexOf('Sk-29');
    expect(idx).toBeGreaterThanOrEqual(0);
    client.moves.playCard(idx, 1); // Sk-29 — a fresh Battle Card play, legal again
    expect(G().public.field['0'][1]?.label).toBe('Sk-29');
  });

  test('a4. Action/Power cards do not consume the Battle Card allowance: two Actions the same turn both succeed', () => {
    const { client, G } = createTestGame({
      players: {
        '0': { field: [], hand: ['Sk-01', 'Sk-02'], deck: ['Sk-17'] },
        '1': { field: [] },
      },
    });

    client.moves.playCard(0, 0); // Sk-01 (Action) into slot 0
    client.moves.playCard(0, 1); // Sk-02 (Action, now hand index 0) into slot 1

    expect(G().public.field['0'][0]?.label).toBe('Sk-01');
    expect(G().public.field['0'][1]?.label).toBe('Sk-02');
    expect(G().public.battleCardPlayedThisTurn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Draw rework: the bothReady gate is removed (auto-draw fires from turn 1)
// and the manual drawCard move is deleted entirely — drawCardForPlayer/
// fireOnDraw themselves are untouched, so any onDraw ability must still fire
// exactly as before, just reached through turn.onBegin only.
// ---------------------------------------------------------------------------
describe('Draw rework (turn 1 auto-draw, drawCard move removed)', () => {
  test("b1. turn 1: the current player's hand grows by exactly 1 at turn start via the automatic draw", () => {
    const { G } = createTestGame({
      players: {
        '0': { hand: ['Sk-01', 'Sk-02', 'Sk-03'], deck: ['Sk-17', 'Sk-18'] },
        '1': { field: [] },
      },
    });

    // No move has been dispatched — this is the state right after turn 1's
    // own onBegin. Previously bothReady required BOTH players to have taken
    // a turn first, so this draw never happened this early.
    expect(G().secret.hands['0']).toHaveLength(4);
    expect(G().secret.hands['0']).toContain('Sk-17');
    expect(G().secret.decks['0']).toEqual(['Sk-18']);
  });

  test('b2. the drawCard move no longer exists on the client', () => {
    const { client } = createTestGame({
      players: {
        '0': { hand: ['Sk-01'], deck: ['Sk-17'] },
        '1': { field: [] },
      },
    });

    expect(typeof (client.moves as unknown as Record<string, unknown>).drawCard).not.toBe('function');
  });

  test("b3. a card effect that fires on draw (Sk-07's onDraw) still triggers via the automatic turn-1 draw", () => {
    const { G } = createTestGame({
      players: {
        '0': { hand: [], deck: ['Sk-07', 'Sk-17'] },
        '1': { field: [] },
      },
    });

    const pending = G().public.pendingChoice;
    expect(pending).not.toBeNull();
    expect(pending?.kind).toBe('yesNo');
    expect(pending?.sourceLabel).toBe('Sk-07');
    expect(pending?.abilitySlot).toBe('b-confirm');
  });
});

// ---------------------------------------------------------------------------
// Deck-out timing: turn.onBegin's own draw-or-lose check only ever loses a
// player once BOTH G.public.turnsTaken['0'] and ['1'] are >= 1 — the same
// two-player condition the old bothReady gate expressed, now scoped to just
// the loss branch (the auto-draw itself fires from turn 1 unconditionally).
// A player's OWN turnsTaken alone is not enough: a card-legality idiom
// elsewhere in this suite seeds turnsTaken: 1 on just the current player to
// unlock attackBattleCard's own gate, with the opponent's left at its 0
// default — that must not read as "deck-out eligible" on its own. Locks
// both halves in so a future change can't silently reintroduce either a
// turn-1 deck-out or a single-player-only deck-out check.
// ---------------------------------------------------------------------------
describe('Deck-out timing rule', () => {
  test('a player whose own turnsTaken is already >= 1 does not lose by deck-out while the opponent has not started yet', () => {
    // Mirrors the turnsTaken: 1 (attack-legality) idiom used throughout this
    // suite — this is exactly the shape that regressed before this guard
    // was fixed to require BOTH players, not just pid's own count.
    const { G } = createTestGame({
      players: {
        '0': { hand: ['Sk-01'], deck: [], turnsTaken: 1 },
        '1': { hand: ['Sk-02'], deck: ['Sk-03'] }, // turnsTaken defaults to 0 — has not started yet
      },
    });

    expect(G().public.loser).toBeNull();
  });

  test('a player cannot lose by deck-out until BOTH players have started, then does once the deck is still empty', () => {
    const { client, client1, G } = createTestGame({
      players: {
        '0': { hand: ['Sk-01'], deck: [] },
        '1': { hand: ['Sk-02'], deck: ['Sk-03'] },
      },
    });

    // Turn 1: neither player has started yet — must NOT lose.
    expect(G().public.loser).toBeNull();

    client.moves.endTurn(); // -> player 1's turn; player 0 has now started, player 1 has not yet
    expect(G().public.loser).toBeNull(); // still not BOTH started

    client1.moves.endTurn(); // -> player 0's second turn: both have now started, deck is still empty
    expect(G().public.loser).toBe('0');
  });
});
