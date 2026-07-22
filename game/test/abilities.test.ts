import { describe, expect, test } from 'vitest';
import { createTestGame } from './helpers';

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
