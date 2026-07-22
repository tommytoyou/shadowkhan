import { CARD_BY_LABEL } from './cards';
import type { FieldCard, ShadowkhanG } from './state';
import { syncCounts } from './state';

export type Trigger =
  | 'onSummon'
  | 'onBattleWin'
  | 'onRemoved'
  | 'onAttacked'
  | 'onActivate';

export interface AbilitySelf {
  pid: string;
  slot: number;
}

export interface EffectContext {
  G: ShadowkhanG;
  ctx: unknown;
  self: AbilitySelf;
}

export type EffectFn = (context: EffectContext) => void;

export interface Ability {
  slot: 'a' | 'b' | 'c' | 'd';
  trigger: Trigger;
  auto: true;
  run: EffectFn;
}

// ---------------------------------------------------------------------------
// Reusable action helpers. These mirror the mutation patterns already used by
// the attack* moves in game.ts — abilities compose them instead of poking G
// directly, so any given card effect either matches an existing move's logic
// or is obviously novel. All removals here are face-up to banished, per the
// rules (Shockwave is the only face-down removal, handled directly in
// attackBattleCard's tie branch).
// ---------------------------------------------------------------------------

export function removeOpponentFieldCard(
  G: ShadowkhanG,
  oppPid: string,
  slot: number
): void {
  const card = G.public.field[oppPid][slot];
  if (!card) return;
  G.public.banished[oppPid].push(card.label);
  G.public.field[oppPid][slot] = null;
}

export function removeFromOpponentHand(
  G: ShadowkhanG,
  oppPid: string,
  handIndex: number
): void {
  const hand = G.secret.hands[oppPid];
  if (handIndex < 0 || handIndex >= hand.length) return;
  const [label] = hand.splice(handIndex, 1);
  G.public.banished[oppPid].push(label);
}

export function removeOpponentDeckTop(G: ShadowkhanG, oppPid: string): void {
  const deck = G.secret.decks[oppPid];
  if (deck.length === 0) return;
  const label = deck.shift()!;
  G.public.banished[oppPid].push(label);
}

export function modifyBp(fieldCard: FieldCard, delta: number): void {
  fieldCard.currentBp = Math.max(0, fieldCard.currentBp + delta);
}

/** Inserts a card label into oppPid's deck at a given depth from the top
 *  (clamped to the deck's current length). Used by cards that plant
 *  themselves into the opponent's deck (Skullface) rather than being banished. */
export function insertIntoOpponentDeck(
  G: ShadowkhanG,
  oppPid: string,
  label: string,
  depthFromTop: number
): void {
  const deck = G.secret.decks[oppPid];
  const index = Math.max(0, Math.min(depthFromTop, deck.length));
  deck.splice(index, 0, label);
}

// ---------------------------------------------------------------------------
// Ability data — the executable layer. Keyed by card label, kept separate
// from cards.ts so the human-readable `effects` text there stays untouched.
// Only fully automatic (no player choice, no target selection) abilities are
// wired here; fireTrigger is a safe no-op for any card without an entry.
//
// Every card's full classification (AUTOMATIC implemented / ONGOING STATE
// implemented / NEEDS CHOICE deferred / not implemented) is reported back to
// the caller of this pass — see DEFERRED_ABILITIES below for everything that
// was deliberately left inert, and the accompanying report for per-card notes
// including partial-implementation caveats.
// ---------------------------------------------------------------------------

const ABILITIES_BY_LABEL: Record<string, Ability[]> = {
  // Sk-01 RULES OF ENGAGEMENT: "if a Battle Card attacks a Battle Card with a
  // higher BP, ... reduce the BP of the attack target ... instead of the
  // attacking card being removed." Unconditional, no target choice — flips a
  // global flag that attackBattleCard checks. The paired "undone by another
  // copy" clause is not implemented: with a 30-card singleton deck no second
  // copy can ever exist, so it's unreachable.
  'Sk-01': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G }) => {
        G.public.rulesOfEngagementActive = true;
      },
    },
  ],

  // Sk-08 A SINISTER ALLIANCE: only the second effect is wired — "If you have
  // all three of the above-mentioned cards on your field, their BP each
  // becomes 9." The condition and targets are fully fixed (three named
  // cards, no player choice). NOT implemented: the first effect (searching/
  // playing a card from the deck — target selection), and the "until end of
  // your turn" reversion (no temporary-effect expiry exists yet, so this
  // pass sets BP to 9 permanently).
  'Sk-08': [
    {
      slot: 'b',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const requiredNames = [
          'BLAZING SKY GOBLIN',
          'SAND SQUID',
          'BATTLE SHOCK SCORPION',
        ];
        const field = G.public.field[self.pid];
        const matches = requiredNames.map((name) =>
          field.find(
            (c): c is FieldCard => c !== null && CARD_BY_LABEL[c.label]?.name === name
          )
        );
        if (matches.every((c) => c !== undefined)) {
          for (const card of matches) {
            modifyBp(card as FieldCard, 9 - (card as FieldCard).currentBp);
          }
        }
      },
    },
  ],

  // Sk-16 WAR DRAGON: "This card cannot be removed by Battle Cards." (effect
  // b only — a and unlike its neighbours, has no "may"/"can".) Unconditional,
  // self-targeted. Implemented as a permanent flag checked in attackBattleCard.
  'Sk-16': [
    {
      slot: 'b',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const card = G.public.field[self.pid][self.slot];
        if (card) card.protectedFromBattleCardRemoval = true;
      },
    },
  ],

  // Sk-17 BLOAT DRAGON: "When this card is removed, your opponent must remove
  // cards from the top of their deck equal to the number of turns this card
  // was on the field." Unconditional, fixed target (top of opponent's deck,
  // repeated). Uses the new 'onRemoved' trigger and FieldCard.turnsOnField
  // (incremented in turn.onEnd).
  'Sk-17': [
    {
      slot: 'a',
      trigger: 'onRemoved',
      auto: true,
      run: ({ G, self }) => {
        const card = G.public.field[self.pid][self.slot];
        if (!card) return;
        const opp = self.pid === '0' ? '1' : '0';
        for (let i = 0; i < card.turnsOnField; i++) {
          removeOpponentDeckTop(G, opp);
        }
      },
    },
  ],

  // Sk-22 GARGOYLE THE WICKED: both effects wired.
  // effect a: "if your opponent has a card adjacent to this one, that card
  //   cannot attack while this card is on the field." Adjacency is read as
  //   the neighbouring slot indices on the opponent's field (no player
  //   choice — every qualifying card is locked, not a pick-one). CAVEAT: the
  //   lock does not currently get released if Gargoyle itself later leaves
  //   the field — that would need a back-reference from the locked card to
  //   its locker, which is out of scope for this pass.
  // effect b: "Remove the top card from your opponent's deck." (unconditional
  //   half) plus "This card cannot attack for the rest of the time it
  //   remains on the field" — a clean self-lock, fully correct since it's
  //   tied to this same FieldCard object.
  'Sk-22': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const oppField = G.public.field[opp];
        for (const adjSlot of [self.slot - 1, self.slot + 1]) {
          const adjCard = oppField[adjSlot];
          if (adjCard) adjCard.canAttack = false;
        }
      },
    },
    {
      slot: 'b',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        removeOpponentDeckTop(G, opp);
        const card = G.public.field[self.pid][self.slot];
        if (card) card.canAttack = false;
      },
    },
  ],

  // Sk-27 CRIMSON SHE-KNIGHT: "When this card removes a Battle Card,
  // increase this card's BP by 1." Fully automatic self-buff.
  'Sk-27': [
    {
      slot: 'a',
      trigger: 'onBattleWin',
      auto: true,
      run: ({ G, self }) => {
        const card = G.public.field[self.pid][self.slot];
        if (card) modifyBp(card, 1);
      },
    },
  ],

  // Sk-28 SKULLFACE: only effect a is wired — "Remove all cards in your hand
  // and place this card in your opponent's deck." Unconditional, no target
  // choice ("all" cards, and the card relocates itself rather than a chosen
  // target). Implemented as: banish the whole hand face-up, pull Skullface
  // off its own field slot, and insert it 5 cards deep into the opponent's
  // deck. NOT implemented: effects b/c (the delayed "if they draw it within
  // five turns" payoff) — that needs a new onDraw-style trigger plus a
  // per-instance countdown attached to a specific card sitting in the deck,
  // neither of which exist yet.
  'Sk-28': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const hand = G.secret.hands[self.pid];
        while (hand.length > 0) {
          const label = hand.pop()!;
          G.public.banished[self.pid].push(label);
        }
        G.public.field[self.pid][self.slot] = null;
        insertIntoOpponentDeck(G, opp, 'Sk-28', 4);
      },
    },
  ],
};

export function fireTrigger(
  G: ShadowkhanG,
  ctx: unknown,
  trigger: Trigger,
  self: AbilitySelf
): void {
  const fieldCard = G.public.field[self.pid][self.slot];
  if (!fieldCard) return;

  const abilities = ABILITIES_BY_LABEL[fieldCard.label];
  if (!abilities || abilities.length === 0) return;

  for (const ability of abilities) {
    if (ability.auto && ability.trigger === trigger) {
      ability.run({ G, ctx, self });
    }
  }

  syncCounts(G);
}

// ---------------------------------------------------------------------------
// Sk-02 TAKEN BY DARKNESS: "If this card is attacked while in your hand or
// deck, remove the attacking card." This card's ability matters while it's
// sitting in hand/deck, not on the field, so it can't go through fireTrigger
// (which looks cards up by field position). It's a fixed-target, no-choice
// replacement effect, so it's implemented as a dedicated guard called from
// attackHand/attackDeck before they touch the targeted card.
// ---------------------------------------------------------------------------

export function interceptHandOrDeckAttack(
  G: ShadowkhanG,
  targetLabel: string,
  attackerPid: string,
  attackerSlot: number
): boolean {
  if (targetLabel === 'Sk-02') {
    removeOpponentFieldCard(G, attackerPid, attackerSlot);
    syncCounts(G);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Deferred abilities registry — a TODO ledger, not an execution path. Nothing
// in fireTrigger or the moves reads this array; it exists purely so every
// printed ability that was *not* wired this pass has a recorded reason,
// instead of silently vanishing. Safe by construction: it can never run.
// ---------------------------------------------------------------------------

export interface DeferredAbility {
  label: string;
  slot: 'a' | 'b' | 'c' | 'd';
  classification: 'NEEDS_CHOICE' | 'GATE' | 'NOT_IMPLEMENTED';
  reason: string;
}

export const DEFERRED_ABILITIES: DeferredAbility[] = [
  { label: 'Sk-01', slot: 'b', classification: 'NOT_IMPLEMENTED', reason: "Undo-by-second-copy is unreachable in a 30-card singleton deck; no second copy can exist." },
  { label: 'Sk-02', slot: 'a', classification: 'NOT_IMPLEMENTED', reason: 'Implemented, but outside the Ability/fireTrigger system — see interceptHandOrDeckAttack.' },
  { label: 'Sk-03', slot: 'a', classification: 'GATE', reason: 'Play requirement (Sage of Dark Omen on field) not enforced — playCard has no per-card legality gates.' },
  { label: 'Sk-03', slot: 'b', classification: 'NEEDS_CHOICE', reason: 'Select which of your own field cards to remove, and whether War Dragon comes from the removed pile or the deck.' },
  { label: 'Sk-04', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select which removed face-up card to return, and which field slot to return it to.' },
  { label: 'Sk-05', slot: 'a', classification: 'NEEDS_CHOICE', reason: "Select which Battle Card to remove — 'the field' is ambiguous across up to 6 slots." },
  { label: 'Sk-06', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select a BP<=8 Battle Card from your deck.' },
  { label: 'Sk-06', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Select hand/deck cards to remove equal to the selected card's BP; also needs a delayed 'start of next turn' summon not currently modeled." },
  { label: 'Sk-07', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may select 10 of your face-up removed cards' — optional, multi-select." },
  { label: 'Sk-07', slot: 'b', classification: 'NEEDS_CHOICE', reason: "'you may place it at the bottom of your deck' — optional." },
  { label: 'Sk-08', slot: 'a', classification: 'GATE', reason: "Play requirement not enforced; 'you may play one of the above from your deck' needs deck search + choice." },
  { label: 'Sk-09', slot: 'a', classification: 'GATE', reason: 'Only usable on Shadow Ghost — Power Cards have no attach-target parameter in playCard yet.' },
  { label: 'Sk-09', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-09's attach targeting, which isn't wired." },
  { label: 'Sk-10', slot: 'a', classification: 'GATE', reason: 'Play requirement (One Eyed Mechanical Monster on field) not enforced.' },
  { label: 'Sk-10', slot: 'b', classification: 'NEEDS_CHOICE', reason: 'Select which opponent Battle Card with BP<=7 to remove — multiple may qualify.' },
  { label: 'Sk-10', slot: 'c', classification: 'NEEDS_CHOICE', reason: 'Select which opponent hand card to remove.' },
  { label: 'Sk-11', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select which of your Battle Cards to buff.' },
  { label: 'Sk-11', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-11a's selection." },
  { label: 'Sk-11', slot: 'c', classification: 'NEEDS_CHOICE', reason: "Conditional field-wipe follow-up to Sk-11a's selection." },
  { label: 'Sk-12', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select target opponent Battle Card to lock.' },
  { label: 'Sk-12', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-12a's target selection." },
  { label: 'Sk-12', slot: 'c', classification: 'NEEDS_CHOICE', reason: 'Duration clause tied to the deferred target selection above.' },
  { label: 'Sk-13', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'Choose one of the following effects' — explicit branch choice." },
  { label: 'Sk-13', slot: 'b', classification: 'NEEDS_CHOICE', reason: 'One branch of the choice above; also needs target selection.' },
  { label: 'Sk-13', slot: 'c', classification: 'NEEDS_CHOICE', reason: 'Other branch of the choice above; also needs target selection.' },
  { label: 'Sk-14', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may remove 1 of your opponent's Battle Cards' — optional + select which." },
  { label: 'Sk-14', slot: 'b', classification: 'NEEDS_CHOICE', reason: "'you may remove 1 card from your opponent's hand or the top of their deck' — optional + choice of source." },
  { label: 'Sk-15', slot: 'a', classification: 'NOT_IMPLEMENTED', reason: 'No current ability performs non-battle field-card removal against a specific opponent card to guard against — nothing to intercept yet.' },
  { label: 'Sk-15', slot: 'b', classification: 'NEEDS_CHOICE', reason: "'you may return it to your hand instead' — optional replacement." },
  { label: 'Sk-16', slot: 'a', classification: 'GATE', reason: 'Play requirement (removed-card counts on both sides) not enforced.' },
  { label: 'Sk-16', slot: 'c', classification: 'NEEDS_CHOICE', reason: "'you may remove 1 face-down Power Card...to negate' — optional, needs a reactive negation system." },
  { label: 'Sk-16', slot: 'd', classification: 'NEEDS_CHOICE', reason: 'Same shape as slot c for Action Cards; printed text is also flagged low-confidence in cards.ts.' },
  { label: 'Sk-18', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may select 1 of your removed cards' to copy." },
  { label: 'Sk-18', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-18a's selection." },
  { label: 'Sk-19', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'it may remain on the field instead' — optional replacement." },
  { label: 'Sk-20', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may remove 3 cards from your hand...' — optional, multi-select." },
  { label: 'Sk-20', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Self-activated ability with no explicit trigger — needs a new 'activate' move not yet supported; also searches the deck for a named card." },
  { label: 'Sk-21', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may select...call it correctly' — optional guessing minigame." },
  { label: 'Sk-21', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-21a's guess outcome." },
  { label: 'Sk-23', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select which hand card to discard and which deck card of matching type to retrieve.' },
  { label: 'Sk-24', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can add A Sinister Alliance from your deck' — optional." },
  { label: 'Sk-25', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can remove the top card from your opponent's deck' — optional." },
  { label: 'Sk-25', slot: 'b', classification: 'NEEDS_CHOICE', reason: "'you can remove face down one Action Card...' — optional, selects a hand card." },
  { label: 'Sk-25', slot: 'c', classification: 'NEEDS_CHOICE', reason: "'you can add one face-up removed Action Card...' — optional, selects from the removed pool." },
  { label: 'Sk-26', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can select one Battle Card...place it under this card' — optional target selection; also needs a new 'cards attached under this card' mechanic." },
  { label: 'Sk-26', slot: 'b', classification: 'NOT_IMPLEMENTED', reason: "Depends entirely on Sk-26a's 'place under this card' mechanic, which is deferred — nothing will ever be attached to return." },
  { label: 'Sk-28', slot: 'b', classification: 'NOT_IMPLEMENTED', reason: "Delayed 'drawn within next five turns' payoff needs a new onDraw-style trigger and a per-instance countdown attached to a specific deck card — not modeled." },
  { label: 'Sk-28', slot: 'c', classification: 'NOT_IMPLEMENTED', reason: 'Same missing infrastructure as slot b (the non-draw branch of the same delayed payoff).' },
  { label: 'Sk-29', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can remove this card on the field instead' — optional replacement." },
  { label: 'Sk-30', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can add it to your deck instead...' — optional replacement." },
];
