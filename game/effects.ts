import { CARD_BY_LABEL } from './cards';
import type { ActiveEffect, EffectKind, FieldCard, PendingChoiceKind, ShadowkhanG } from './state';
import { syncCounts } from './state';

export type Trigger =
  | 'onSummon'
  | 'onBattleWin'
  | 'onRemoved'
  | 'onAttacked'
  | 'onActivate'
  | 'onDraw';

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
// Target-selection system. An ability that can't resolve immediately (a
// "you may", or a choice among several legal targets) opens a pendingChoice
// on G.public instead of mutating state right away, and returns. The engine
// pauses — see the pendingChoice guards added to every move in game.ts —
// until resolveChoice() answers it, which runs `resolve`. `resolve` may
// itself call openChoice() again to chain into a second question (e.g.
// "remove one? -> yes -> which one?"), by referencing another entry in this
// same card's CHOICE_ABILITIES_BY_LABEL bucket under a different key. Only
// entries with a `trigger` are auto-opened by fireTrigger; chained/"-target"
// entries are only reachable via another step's resolve().
// ---------------------------------------------------------------------------

export interface ChoiceAbility {
  needsChoice: true;
  /** Present only on entries fireTrigger should open directly at that trigger. */
  trigger?: Trigger;
  /** For a yesNo entry only: the key (in this same label's bucket) of the
   *  target step answering Yes would chain into. yesNo entries have no
   *  options list of their own (getOptions is always `() => null`), so this
   *  is how the generic zero-target pre-check in fireTrigger looks ahead
   *  before opening the yesNo at all — see willHaveLegalOutcome below. */
  leadsTo?: string;
  prompt: string;
  kind: PendingChoiceKind;
  getOptions: (G: ShadowkhanG, ctx: unknown, self: AbilitySelf) => number[] | null;
  resolve: (
    G: ShadowkhanG,
    ctx: unknown,
    self: AbilitySelf,
    answer: number | boolean
  ) => void;
}

// ---------------------------------------------------------------------------
// Reusable action helpers. These mirror the mutation patterns already used by
// the attack* moves in game.ts — abilities compose them instead of poking G
// directly, so any given card effect either matches an existing move's logic
// or is obviously novel. All removals here are face-up to banished, per the
// rules (Shockwave is the only face-down removal, handled directly in
// attackBattleCard's tie branch).
// ---------------------------------------------------------------------------

/** Ability-driven field removal (cause: 'ability') — routes through the
 *  shared removeFieldCard so any removal-replacement hook on the target
 *  still gets a chance to intervene. Preserves this helper's long-standing
 *  behavior of not firing onRemoved (see removeFieldCard's `opts`) — only
 *  the battle-combat call sites in game.ts pass fireOnRemoved. */
export function removeOpponentFieldCard(
  G: ShadowkhanG,
  ctx: unknown,
  oppPid: string,
  slot: number
): void {
  removeFieldCard(G, ctx, oppPid, slot, 'ability');
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

/** Removes the card at `handIndex` from owner's own hand into their
 *  banished pile ("discard"), and returns its label so the caller can chain
 *  off it (e.g. Sk-23a's same-type deck retrieval). */
export function discardOwnHandCard(
  G: ShadowkhanG,
  owner: string,
  handIndex: number
): string {
  const hand = G.secret.hands[owner];
  const [label] = hand.splice(handIndex, 1);
  G.public.banished[owner].push(label);
  return label;
}

/** Removes the card at `handIndex` from owner's own hand FACE DOWN — the
 *  label is never revealed into G.public.banished, only the count ticks up
 *  (mirrors Shockwave's face-down deck removal). Used by costs like
 *  Sk-25b's "remove face down one Action Card". */
export function banishHandCardFaceDown(
  G: ShadowkhanG,
  owner: string,
  handIndex: number
): void {
  const hand = G.secret.hands[owner];
  if (handIndex < 0 || handIndex >= hand.length) return;
  hand.splice(handIndex, 1);
  G.public.banishedFaceDown[owner]++;
}

/** Removes owner's own top deck card face down — the shared shape behind
 *  Shockwave's tie result (both sides lose their top deck card, face down,
 *  simultaneously). */
export function removeOwnDeckTopFaceDown(G: ShadowkhanG, pid: string): void {
  const deck = G.secret.decks[pid];
  if (deck.length === 0) return;
  deck.shift();
  G.public.banishedFaceDown[pid]++;
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

/** Removes the card at `deckIndex` from owner's deck and adds it to their
 *  hand — the "found it, take it" action shared by every deck-search
 *  ability that retrieves a card. See dispatchSearch below. */
export function moveDeckCardToHand(
  G: ShadowkhanG,
  owner: string,
  deckIndex: number
): void {
  const deck = G.secret.decks[owner];
  const [label] = deck.splice(deckIndex, 1);
  G.secret.hands[owner].push(label);
}

// ---------------------------------------------------------------------------
// Play-legality gates. Some cards print "you can only play this card if...":
// a condition on game state that must hold BEFORE the card is even allowed
// onto the field, distinct from what the card's ability does once it's
// there. One registry, keyed by label, mirroring the ABILITIES_BY_LABEL /
// CHOICE_ABILITIES_BY_LABEL shape — playCard calls the single isPlayLegal
// check below rather than branching per card. A label with no entry plays
// exactly as it always has (isPlayLegal returns true by default).
// ---------------------------------------------------------------------------

export interface PlayGate {
  /** Printed slot letter the condition lives on, for traceability against
   *  cards.ts / DEFERRED_ABILITIES — not read by isPlayLegal itself. */
  slot: 'a' | 'b' | 'c' | 'd';
  check: (G: ShadowkhanG, pid: string) => boolean;
}

const PLAY_GATES: Record<string, PlayGate> = {
  // Sk-03 ARRIVAL OF DOOM: "This card can only be played when you have Sage
  // of Dark Omen on the field."
  'Sk-03': {
    slot: 'a',
    check: (G, pid) =>
      G.public.field[pid].some((c) => c && CARD_BY_LABEL[c.label]?.name === 'SAGE OF DARK OMEN'),
  },

  // Sk-08 A SINISTER ALLIANCE: "You can only play this card if you have at
  // least one Blazing Sky Goblin, Sand Squid, or Battle Shock Scorpion on
  // your field." (The rest of that sentence — playing one of those three
  // from your deck — is a separate, still-deferred search+play effect; this
  // gate only covers whether Sk-08 itself may be played.)
  'Sk-08': {
    slot: 'a',
    check: (G, pid) => {
      const allies = ['BLAZING SKY GOBLIN', 'SAND SQUID', 'BATTLE SHOCK SCORPION'];
      return G.public.field[pid].some(
        (c) => c && allies.includes(CARD_BY_LABEL[c.label]?.name ?? '')
      );
    },
  },

  // Sk-10 CYCLO OPTIC BEAM: "This card can only be played while you have a
  // One Eyed Mechanical Monster on the field."
  'Sk-10': {
    slot: 'a',
    check: (G, pid) =>
      G.public.field[pid].some((c) => c && CARD_BY_LABEL[c.label]?.name === 'ONE EYED MECHANICAL MONSTER'),
  },

  // Sk-16 WAR DRAGON: "You can only play this card if you have at least two
  // BP 7 or BP 8 cards removed, and your opponent has at least one BP 7 or
  // BP 8 card removed." Reads the (face-up) banished piles, not the field.
  'Sk-16': {
    slot: 'a',
    check: (G, pid) => {
      const opp = pid === '0' ? '1' : '0';
      const isSevenOrEight = (label: string) => {
        const bp = CARD_BY_LABEL[label]?.bp;
        return bp === 7 || bp === 8;
      };
      const ownCount = G.public.banished[pid].filter(isSevenOrEight).length;
      const oppCount = G.public.banished[opp].filter(isSevenOrEight).length;
      return ownCount >= 2 && oppCount >= 1;
    },
  },
};

/** True if `pid` is allowed to play `label` right now — i.e. no gate entry,
 *  or its condition currently holds. playCard's single legality check. */
export function isPlayLegal(G: ShadowkhanG, pid: string, label: string): boolean {
  const gate = PLAY_GATES[label];
  return !gate || gate.check(G, pid);
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

  // Sk-05 DIVINE SKY STRIKE: "Remove one Battle Card from the field face-up."
  // Mandatory (no "may"), but which card is ambiguous — CHOICE_READY dispatch
  // pattern (same shape as Sk-10 below): check for legal targets on the
  // opponent's field first, and only open the pendingChoice if at least one
  // exists. RULING (per instruction): opponent's field only, restricted to
  // Battle Cards. If the opponent's field has no Battle Card, this quietly
  // fizzles — no prompt opens.
  'Sk-05': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const eligible = G.public.field[opp]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
        if (eligible.length === 0) return;
        openChoice(G, ctx, self, 'Sk-05', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-05']['a-target']);
      },
    },
  ],

  // Sk-07 ACE IN THE HOLE: two mutually exclusive onDraw branches, decided by
  // whether this draw emptied the deck.
  // effect a ("If you draw this card and it is your last card, you may
  //   select 10 of your face-up removed cards, shuffle them, and add them to
  //   your deck.") — read "last card" as the last card OF YOUR DECK, i.e.
  //   deck.length === 0 immediately after this draw. Needs a genuine
  //   multi-select (pick exactly 10 from an arbitrarily-sized removed pool),
  //   which the single-answer pendingChoice/dispatchSearch machinery can't
  //   express — left deferred rather than faking it with repeated prompts.
  // effect b ("If you draw this card normally, you may place it at the
  //   bottom of your deck...") — the complementary branch: deck still has
  //   cards after this draw. Wired below. No search involved — the target is
  //   always "the card that was just drawn" (self.slot, its hand index), so
  //   this is a plain yesNo confirm, same shape as Sk-25a. CAVEAT: "You
  //   cannot play other action cards this turn" is not modeled — no
  //   per-turn lock state exists for action-card plays.
  'Sk-07': [
    {
      slot: 'b',
      trigger: 'onDraw',
      auto: true,
      run: ({ G, ctx, self }) => {
        if (G.secret.decks[self.pid].length === 0) return; // branch a applies instead
        openChoice(G, ctx, self, 'Sk-07', 'b-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-07']['b-confirm']);
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

  // Sk-10 CYCLO OPTIC BEAM: effects b+c wired as a single dispatcher — no
  // "may"/"can" in either clause, so both are mandatory, but which target
  // qualifies depends on game state, which is why they were deferred as
  // NEEDS_CHOICE originally. "Remove one Battle Card on your opponent's
  // field with a BP of 7 or less. If there are no cards on your opponent's
  // field, remove one from their hand." This run() makes the (choice-free)
  // branch decision from state, then opens whichever target choice applies:
  // an opponentField choice filtered to BP<=7, or — when the opponent's
  // field is completely empty — an opponentHandIndex choice. If a branch has
  // zero legal targets the ability quietly fizzles (no pendingChoice opens).
  // effect a (the "only while you have One Eyed Mechanical Monster" play
  // requirement) remains an unenforced GATE, as with other play requirements.
  'Sk-10': [
    {
      slot: 'b',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const oppField = G.public.field[opp];
        const fieldIsEmpty = oppField.every((c) => c === null);
        if (fieldIsEmpty) {
          if (G.secret.hands[opp].length === 0) return;
          openChoice(G, ctx, self, 'Sk-10', 'hand-target', CHOICE_ABILITIES_BY_LABEL['Sk-10']['hand-target']);
        } else {
          const eligible = oppField
            .map((c, i) => (c && c.currentBp <= 7 ? i : null))
            .filter((i): i is number => i !== null);
          if (eligible.length === 0) return;
          openChoice(G, ctx, self, 'Sk-10', 'field-target', CHOICE_ABILITIES_BY_LABEL['Sk-10']['field-target']);
        }
      },
    },
  ],

  // Sk-11 CHOSEN CONDUIT: all three printed effects wired as one flow.
  // "Select one of those Battle Cards and increase its BP by the BP of your
  // other Battle Cards" (a) — gated on having 2+ own Battle Cards, dispatched
  // here; "only applied if the selected card's BP is 9 or less" (b) — checked
  // in the target step's resolve before computing anything; "if the selected
  // card's BP becomes more than 9, remove all cards from your field" (c) —
  // handled via a dynamically-registered yesNo confirm step (see 'a-target'
  // below) so the player is warned before their whole field is wiped.
  'Sk-11': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const battleSlots = G.public.field[self.pid]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
        if (battleSlots.length < 2) return;
        openChoice(G, ctx, self, 'Sk-11', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-11']['a-target']);
      },
    },
  ],

  // Sk-12 CURSE OF STONE: "Select one Battle Card on your opponent's field.
  // The selected card and any cards they control with the same BP cannot
  // attack, be attacked, or use card effects. This effect lasts until the
  // end of your opponent's turn after this card was activated." A power
  // card — playing it is its activation, same precedent as Sk-10/11/13.
  // Same CHOICE_READY pre-check shape as Sk-05/10/11 above: only opens the
  // target choice if the opponent has a Battle Card to select. The lock
  // applies to every one of the opponent's field cards sharing the
  // selected card's CURRENT BP, snapshotted once at that moment (not
  // re-evaluated as BP changes later), through the new persistent-effect
  // registry — see hasActiveEffect/expireTimedEffects/expireEffectsForSlot.
  'Sk-12': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const eligible = G.public.field[opp]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
        if (eligible.length === 0) return;
        openChoice(G, ctx, self, 'Sk-12', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-12']['a-target']);
      },
    },
  ],

  // Sk-14 ONE EYED MECHANICAL MONSTER, ability b: "When this card removes a
  // card by battle, you may remove 1 card from your opponent's hand or the
  // top of their deck." Dispatches the initial yesNo only if the opponent
  // has at least one legal source (hand or deck); if both are empty, no
  // prompt opens at all. (Ability a lives in CHOICE_ABILITIES_BY_LABEL below
  // as a plain trigger-bound entry, using its `leadsTo` field so fireTrigger's
  // generic pre-check looks ahead at 'a-target' before opening the yesNo —
  // see willHaveLegalOutcome in fireTrigger.)
  'Sk-14': [
    {
      slot: 'b',
      trigger: 'onBattleWin',
      auto: true,
      run: ({ G, ctx, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        if (G.secret.hands[opp].length === 0 && G.secret.decks[opp].length === 0) return;
        openChoice(G, ctx, self, 'Sk-14', 'b-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-14']['b-confirm']);
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

  // Sk-20 SAGE OF DARK OMEN, ability b: "Remove this card from the field and
  // add 1 Arrival Of Doom from your deck to your hand." Fires on the new
  // onActivate trigger (activateAbility move) — this ability has no
  // summon/battle/removal qualifier in the printed text, it's usable at
  // will. Both clauses are unconditional (no "may"): the field-removal
  // always happens; the deck retrieval is independently zero-gated by
  // dispatchSearch (no copy in deck -> silent fizzle, card is still
  // removed). Effect a ('you may remove 3 cards from your hand to remove up
  // to 2 BP7/8 cards from your deck') stays deferred — a multi-select cost
  // payment, not a name/attribute search.
  'Sk-20': [
    {
      slot: 'b',
      trigger: 'onActivate',
      auto: true,
      run: ({ G, ctx, self }) => {
        if (!G.public.field[self.pid][self.slot]) return;
        removeFieldCard(G, ctx, self.pid, self.slot, 'ability');
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-20',
          'b-search',
          'deck',
          self.pid,
          (label) => CARD_BY_LABEL[label]?.name === 'ARRIVAL OF DOOM',
          'Choose which Arrival Of Doom to add to your hand.',
          moveDeckCardToHand
        );
      },
    },
  ],

  // Sk-22 GARGOYLE THE WICKED: both effects wired.
  // effect a: "if your opponent has a card adjacent to this one, that card
  //   cannot attack while this card is on the field." Adjacency is read as
  //   the neighbouring slot indices on the opponent's field (no player
  //   choice — every qualifying card is locked, not a pick-one). Uses the
  //   persistent-effect registry (source-presence-only — no
  //   expiresAtGlobalTurn, since the printed duration is "while this card
  //   is on the field") rather than mutating the adjacent card's own
  //   canAttack flag directly: expireEffectsForSlot (called from every
  //   field removal) now correctly releases the lock the moment Gargoyle
  //   itself leaves the field — previously a stale-lock bug, since a raw
  //   flag mutation had no way to know when to reset itself.
  // effect b: "Remove the top card from your opponent's deck." (unconditional
  //   half) plus "This card cannot attack for the rest of the time it
  //   remains on the field" — a clean self-lock, fully correct since it's
  //   tied to this same FieldCard object (canAttack stays the right tool
  //   here: self-referential, no staleness risk).
  'Sk-22': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        const oppField = G.public.field[opp];
        for (const adjSlot of [self.slot - 1, self.slot + 1]) {
          if (!oppField[adjSlot]) continue;
          G.public.activeEffects.push({
            kinds: ['cannotAttack'],
            targetPid: opp,
            targetSlot: adjSlot,
            sourceLabel: 'Sk-22',
            sourcePid: self.pid,
            sourceSlot: self.slot,
          });
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

  // Sk-23 PORTAL MONARCH: "Discard 1 Battle Card, Action Card, or Power Card
  // from your hand to add 1 card of the same type from your deck to your
  // hand." Fires on onActivate (usable at will, no summon/battle qualifier
  // in the printed text). Two chained dispatchSearch calls: the discard step
  // searches owner's own HAND with an unfiltered predicate (every printed
  // card type is eligible, i.e. "any hand card") — zero hand cards fizzles
  // silently, one auto-discards, more than one opens a real choice. Once a
  // card is discarded, its recorded type drives a second dispatchSearch over
  // the DECK; that step's own zero/one/many handling covers "no matching
  // type in deck" for free. CAVEAT: "You cannot play the selected card this
  // turn" is not modeled — hand cards carry no per-turn lock state.
  'Sk-23': [
    {
      slot: 'a',
      trigger: 'onActivate',
      auto: true,
      run: ({ G, ctx, self }) => {
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-23',
          'a-discard',
          'hand',
          self.pid,
          () => true,
          'Choose a card from your hand to discard.',
          (G2, owner, handIndex) => {
            const label = discardOwnHandCard(G2, owner, handIndex);
            const type = CARD_BY_LABEL[label]?.type;
            if (!type) return;
            dispatchSearch(
              G2,
              ctx,
              self,
              'Sk-23',
              'a-retrieve',
              'deck',
              owner,
              (deckLabel) => CARD_BY_LABEL[deckLabel]?.type === type,
              'Choose a card of the same type to add to your hand.',
              moveDeckCardToHand
            );
          }
        );
      },
    },
  ],

  // Sk-24 BLAZING SKY GOBLIN: "If you play this card while Sand Squid or
  // Battle Shock Scorpion is on your field, you can add A Sinister Alliance
  // from your deck to your hand." Optional ("you can"), named deck search —
  // same CHOICE_READY pre-check shape as Sk-05/Sk-10/Sk-11/Sk-25: check the
  // board condition AND that the deck actually holds a copy before opening
  // the yesNo at all. The search itself (and the "found it, take it" step)
  // runs through the generic dispatchSearch primitive.
  'Sk-24': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const field = G.public.field[self.pid];
        const hasAlly = field.some(
          (c) =>
            c &&
            (CARD_BY_LABEL[c.label]?.name === 'SAND SQUID' ||
              CARD_BY_LABEL[c.label]?.name === 'BATTLE SHOCK SCORPION')
        );
        if (!hasAlly) return;
        const matches = searchIndices(
          G,
          'deck',
          self.pid,
          (label) => CARD_BY_LABEL[label]?.name === 'A SINISTER ALLIANCE'
        );
        if (matches.length === 0) return;
        openChoice(G, ctx, self, 'Sk-24', 'a-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-24']['a-confirm']);
      },
    },
  ],

  // Sk-25 BATTLE SHOCK SCORPION: "If this card removes a Battle Card, you can
  // remove the top card from your opponent's deck." "You can" = optional —
  // dispatch a yesNo confirm, but only if the opponent's deck actually has a
  // top card to take; otherwise no prompt opens.
  'Sk-25': [
    {
      slot: 'a',
      trigger: 'onBattleWin',
      auto: true,
      run: ({ G, ctx, self }) => {
        const opp = self.pid === '0' ? '1' : '0';
        if (G.secret.decks[opp].length === 0) return;
        openChoice(G, ctx, self, 'Sk-25', 'a-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-25']['a-confirm']);
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
          discardOwnHandCard(G, self.pid, hand.length - 1);
        }
        // Relocation, not a removal: Skullface leaves the field to be
        // planted in the opponent's deck (below), never banished — so this
        // doesn't go through removeFieldCard.
        G.public.field[self.pid][self.slot] = null;
        insertIntoOpponentDeck(G, opp, 'Sk-28', 4);
      },
    },
  ],
};

// Generic zero-target guard: if a step's own option list is empty, there is
// nothing legal to choose, so the ability resolves silently instead of
// opening an unanswerable prompt. This covers both the initial dispatch and
// any mid-chain openChoice() call from inside a resolve() — one place, no
// per-card special casing. yesNo entries always report `getOptions: () =>
// null` (no meaningful options list of their own), so they're unaffected
// here; their zero-target case is handled by willHaveLegalOutcome below,
// before openChoice is ever called.
function openChoice(
  G: ShadowkhanG,
  ctx: unknown,
  self: AbilitySelf,
  label: string,
  key: string,
  choice: ChoiceAbility
): void {
  const options = choice.getOptions(G, ctx, self);
  if (options !== null && options.length === 0) return;
  G.public.pendingChoice = {
    pid: self.pid,
    prompt: choice.prompt,
    kind: choice.kind,
    options,
    sourceLabel: label,
    sourceSlot: self.slot,
    abilitySlot: key,
  };
}

// For a trigger-bound yesNo entry, decides whether it should open at all.
// A yesNo with no `leadsTo` target step is judged solely on its own terms
// (always fine to open — e.g. Sk-25's confirm, which is pre-checked by its
// caller before reaching here). A yesNo with `leadsTo` looks ahead at that
// target step's option set: if answering Yes would leave nothing to select,
// the yesNo itself must not open.
function willHaveLegalOutcome(
  G: ShadowkhanG,
  ctx: unknown,
  self: AbilitySelf,
  label: string,
  choice: ChoiceAbility
): boolean {
  if (choice.kind !== 'yesNo' || !choice.leadsTo) return true;
  const next = CHOICE_ABILITIES_BY_LABEL[label]?.[choice.leadsTo];
  if (!next) return true;
  const options = next.getOptions(G, ctx, self);
  return options === null || options.length > 0;
}

// ---------------------------------------------------------------------------
// Removal replacement hook. Some cards intervene when THEY THEMSELVES are
// about to be removed from the field: redirect the removal (to hand, to
// deck), prevent it outright (stay on the field), or pay a cost to do so.
// One registry, keyed by the label of the card BEING REMOVED — same shape
// as every other *_BY_LABEL registry. removeFieldCard is the single choke
// point every field removal (battle loss, ability removal, self-removal)
// routes through; it checks this registry BEFORE any state change.
//
// Scope: field removals only. No currently-wireable card intervenes in a
// hand or deck removal, so REMOVAL_HOOKS isn't consulted by
// removeFromOpponentHand / removeOpponentDeckTop / discardOwnHandCard.
// Sk-29a and Sk-30a are NOT wired here even though their printed text is
// "intervene in a removal" shaped — see their DEFERRED_ABILITIES entries:
// both are "guardian" abilities that protect a DIFFERENT card elsewhere on
// the same field (Rarewolf substitutes itself for another BP<=4 card;
// Shadow's Mistress protects a Shadow Ghost that isn't itself), which would
// need a full field scan for a matching guardian on every removal, not a
// same-label self-hook — a different registry shape than the other three.
// ---------------------------------------------------------------------------

/** Why a field removal is being attempted. The printed replacement texts
 *  distinguish "removed by battle" from any other removal source, so every
 *  removal call site tags its own cause explicitly rather than a hook
 *  trying to infer it from context. */
export type RemovalCause = 'battle' | 'ability';

export interface RemovalOpts {
  /** Fire onRemoved (while the card is still field-resident, matching
   *  fireTrigger's own field lookup) once the removal is confirmed to
   *  proceed. Only the battle-combat call sites in game.ts pass this,
   *  preserving the pre-existing (if inconsistent) fact that ability-driven
   *  removals never fired onRemoved — not something this refactor changes. */
  fireOnRemoved?: boolean;
  /** Runs after the card has been banished, only if the removal actually
   *  went through (never on prevent/redirect) — e.g. attackBattleCard's
   *  onBattleWin for the attacker, which must not fire if the defender
   *  escaped instead of being removed. */
  afterRemoved?: (G: ShadowkhanG, ctx: unknown) => void;
}

export type FieldRemovalResult =
  | 'removed' // completed synchronously this dispatch (normal banish, or no hook applied)
  | 'pending'; // a hook opened a pendingChoice; finishing is deferred to its resolve()

export interface RemovalHook {
  slot: 'a' | 'b' | 'c' | 'd';
  /** Non-mutating pre-check: does this card's replacement even apply right
   *  now (matches the removal's cause, has any cost it needs, hasn't
   *  already used a one-time effect)? Mirrors the zero-target gate used
   *  everywhere else — a hook that can't apply must not open a prompt. */
  eligible: (G: ShadowkhanG, pid: string, card: FieldCard, cause: RemovalCause) => boolean;
  /** Opens the confirm prompt. Its resolve() owns finishing the removal on
   *  both branches: apply the replacement, or fall through to a normal
   *  removal via finishFieldRemoval. */
  openPrompt: (
    G: ShadowkhanG,
    ctx: unknown,
    pid: string,
    slot: number,
    opts: RemovalOpts | undefined
  ) => void;
}

const REMOVAL_HOOKS: Record<string, RemovalHook> = {
  // Sk-15 SHADOW GHOST, effect b: "While this card is on the field, if it
  // would be removed by battle, you may return it to your hand instead."
  // Repeatable (no "once"), battle-only.
  'Sk-15': {
    slot: 'b',
    eligible: (_G, _pid, _card, cause) => cause === 'battle',
    openPrompt: (G, ctx, pid, slot, opts) => {
      const key = 'removal-confirm';
      (CHOICE_ABILITIES_BY_LABEL['Sk-15'] ??= {})[key] = {
        needsChoice: true,
        prompt: 'Shadow Ghost would be removed by battle — return it to your hand instead?',
        kind: 'yesNo',
        getOptions: () => null,
        resolve: (G2, ctx2, self2, answer2) => {
          if (answer2 === true) {
            const c = G2.public.field[self2.pid][self2.slot];
            if (c) {
              G2.public.field[self2.pid][self2.slot] = null;
              G2.secret.hands[self2.pid].push(c.label);
            }
            return;
          }
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, opts);
        },
      };
      openChoice(G, ctx, { pid, slot }, 'Sk-15', key, CHOICE_ABILITIES_BY_LABEL['Sk-15'][key]);
    },
  },

  // Sk-19 THE HEADLESS HORSEMAN: "Once after this card is played, if it
  // would be removed by battle, it may remain on the field instead." A
  // one-time use — FieldCard.replacementUsed tracks it, set only when
  // actually applied (declining doesn't burn the one use).
  'Sk-19': {
    slot: 'a',
    eligible: (_G, _pid, card, cause) => cause === 'battle' && !card.replacementUsed,
    openPrompt: (G, ctx, pid, slot, opts) => {
      const key = 'removal-confirm';
      (CHOICE_ABILITIES_BY_LABEL['Sk-19'] ??= {})[key] = {
        needsChoice: true,
        prompt: 'The Headless Horseman would be removed by battle — remain on the field instead? (once only)',
        kind: 'yesNo',
        getOptions: () => null,
        resolve: (G2, ctx2, self2, answer2) => {
          if (answer2 === true) {
            const c = G2.public.field[self2.pid][self2.slot];
            if (c) c.replacementUsed = true;
            return;
          }
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, opts);
        },
      };
      openChoice(G, ctx, { pid, slot }, 'Sk-19', key, CHOICE_ABILITIES_BY_LABEL['Sk-19'][key]);
    },
  },

  // Sk-25 BATTLE SHOCK SCORPION, effect b: "You can remove face down one
  // Action Card in your hand to stop this card from being removed after
  // losing a battle." Battle-only, and only offered if there's an Action
  // Card in hand to pay with — the cost search reuses dispatchSearch.
  'Sk-25': {
    slot: 'b',
    eligible: (G, pid, _card, cause) =>
      cause === 'battle' && G.secret.hands[pid].some((label) => CARD_BY_LABEL[label]?.type === 'action'),
    openPrompt: (G, ctx, pid, slot, opts) => {
      const key = 'removal-confirm';
      (CHOICE_ABILITIES_BY_LABEL['Sk-25'] ??= {})[key] = {
        needsChoice: true,
        prompt: 'Battle Shock Scorpion would be removed after losing a battle — remove a face-down Action Card from your hand to stop it?',
        kind: 'yesNo',
        getOptions: () => null,
        resolve: (G2, ctx2, self2, answer2) => {
          if (answer2 === true) {
            dispatchSearch(
              G2,
              ctx2,
              self2,
              'Sk-25',
              'removal-cost',
              'hand',
              self2.pid,
              (label) => CARD_BY_LABEL[label]?.type === 'action',
              'Choose which Action Card to remove face down.',
              (G3, owner, handIndex) => banishHandCardFaceDown(G3, owner, handIndex)
            );
            return;
          }
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, opts);
        },
      };
      openChoice(G, ctx, { pid, slot }, 'Sk-25', key, CHOICE_ABILITIES_BY_LABEL['Sk-25'][key]);
    },
  },
};

// ---------------------------------------------------------------------------
// Persistent effects. Some abilities apply an ongoing restriction — a lock —
// to a card other than (or in addition to) themselves, lasting across
// turns rather than resolving immediately. Active effects live in
// G.public.activeEffects (visible to both players — a lock the opponent
// can't see would be unplayable) instead of being recomputed ad hoc, and
// every decision point that needs to know "is this card locked right now"
// consults the single hasActiveEffect query below, rather than each move
// re-deriving lock state inline.
//
// Two independent expiry conditions, either of which may apply to a given
// effect: a stated turn-based duration (expiresAtGlobalTurn, swept in
// turn.onEnd) and "the source or target card left this field slot" (swept
// in expireEffectsForSlot, called from finalizeFieldRemoval — the single
// removal choke point — so a stale aura from a removed source, or a stale
// entry for a slot a different card now occupies, can't linger). No
// separate registry for effect CREATION: Sk-12/Sk-22 create effects from a
// normal onSummon Ability/ChoiceAbility, the same registries every other
// card uses.
// ---------------------------------------------------------------------------

/** The one place every decision point checks whether pid/slot is currently
 *  restricted by an active effect of `kind`. */
export function hasActiveEffect(
  G: ShadowkhanG,
  pid: string,
  slot: number,
  kind: EffectKind
): boolean {
  return G.public.activeEffects.some(
    (e) => e.targetPid === pid && e.targetSlot === slot && e.kinds.includes(kind)
  );
}

/** Prunes any active effect sourced from, OR targeting, pid/slot — called
 *  whenever a card leaves that field slot. Covers both directions: a
 *  removed SOURCE's aura must not linger (Gargoyle leaving the field), and
 *  a removed TARGET's effect entry must not go stale and silently apply to
 *  whatever card is later played into that same slot. */
function expireEffectsForSlot(G: ShadowkhanG, pid: string, slot: number): void {
  G.public.activeEffects = G.public.activeEffects.filter(
    (e) => !((e.sourcePid === pid && e.sourceSlot === slot) || (e.targetPid === pid && e.targetSlot === slot))
  );
}

/** Prunes any active effect whose turn-based duration has elapsed. Called
 *  once from turn.onEnd, after turnsTaken has been incremented for the
 *  player whose turn just ended. */
export function expireTimedEffects(G: ShadowkhanG): void {
  const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
  G.public.activeEffects = G.public.activeEffects.filter(
    (e) => e.expiresAtGlobalTurn === undefined || e.expiresAtGlobalTurn > globalTurns
  );
}

/** Mechanical "make it gone": banishes the card at pid/slot. No hook check,
 *  no trigger — the low-level primitive both finishFieldRemoval and a
 *  declined replacement's own resolve() share. */
function finalizeFieldRemoval(G: ShadowkhanG, pid: string, slot: number): void {
  const card = G.public.field[pid][slot];
  if (!card) return;
  G.public.banished[pid].push(card.label);
  G.public.field[pid][slot] = null;
  expireEffectsForSlot(G, pid, slot);
}

/** Fires onRemoved (if requested, while the card is still field-resident),
 *  banishes it, then runs afterRemoved (if requested) — the exact sequence
 *  attackBattleCard has always used. Shared by removeFieldCard's
 *  synchronous path and every hook's "declined" resolve() branch. */
function finishFieldRemoval(
  G: ShadowkhanG,
  ctx: unknown,
  pid: string,
  slot: number,
  opts: RemovalOpts | undefined
): void {
  if (opts?.fireOnRemoved) fireTrigger(G, ctx, 'onRemoved', { pid, slot });
  finalizeFieldRemoval(G, pid, slot);
  opts?.afterRemoved?.(G, ctx);
}

/**
 * The single choke point for removing a card from a field slot. Checks
 * REMOVAL_HOOKS for the card being removed BEFORE any state change:
 *  - no hook, or the hook doesn't apply right now (eligible() is false):
 *    proceeds exactly as before (finishFieldRemoval), returns 'removed'.
 *  - hook applies: opens its confirm prompt and returns 'pending' —
 *    nothing about this removal has happened yet. Callers must not run any
 *    "this removal completed" logic in this dispatch when they see
 *    'pending' — see RemovalOpts.afterRemoved, which the hook's own
 *    resolve() invokes instead, once the outcome is known.
 * No infinite loops: REMOVAL_HOOKS is keyed by the REMOVED card's own
 * label, and none of the three wired hooks' replacements themselves cause
 * another field removal — Sk-15b/19a keep the card in play, Sk-25b's cost
 * is a hand discard (a different zone, never routed back through this
 * function) — so there's no path back into a hook for the same card.
 */
export function removeFieldCard(
  G: ShadowkhanG,
  ctx: unknown,
  pid: string,
  slot: number,
  cause: RemovalCause,
  opts?: RemovalOpts
): FieldRemovalResult {
  const card = G.public.field[pid][slot];
  if (!card) return 'removed';

  const hook = REMOVAL_HOOKS[card.label];
  if (hook && hook.eligible(G, pid, card, cause)) {
    hook.openPrompt(G, ctx, pid, slot, opts);
    return 'pending';
  }

  finishFieldRemoval(G, ctx, pid, slot, opts);
  return 'removed';
}

// ---------------------------------------------------------------------------
// Named/attribute card search primitive. A single reusable engine for every
// ability whose effect text is "find a card by name/type/BP/tier in a hand
// or deck" — one generic mechanism, no per-card search logic.
// ---------------------------------------------------------------------------

export type SearchZone = 'deck' | 'hand';

/** Scans `owner`'s deck or hand and returns the zone-relative indices of
 *  entries matching `predicate`, in zone order. This is the only place that
 *  reads a deck or hand array for search purposes — every search ability
 *  composes it instead of poking G.secret directly. */
function searchIndices(
  G: ShadowkhanG,
  zone: SearchZone,
  owner: string,
  predicate: (label: string) => boolean
): number[] {
  const source = zone === 'deck' ? G.secret.decks[owner] : G.secret.hands[owner];
  return source
    .map((label, i) => (predicate(label) ? i : null))
    .filter((i): i is number => i !== null);
}

/**
 * Runs a search over `zone` and drives it through the pendingChoice system
 * per the zero/one/many rule:
 *  - zero matches: no-op (silent fizzle — the same zero-target gate as
 *    everywhere else in this file).
 *  - exactly one match: applies immediately via `apply`, no prompt.
 *  - more than one match: opens a real choice among the matches.
 *
 * CRITICAL: deck order is secret state (G.secret) and must never reach
 * G.public — but every pendingChoice is broadcast to both players via
 * G.public.pendingChoice. So when `zone` is 'deck', the opened choice's
 * `options` are ORDINAL positions within the match list (0, 1, 2, ... —
 * "the 1st/2nd/3rd match"), never real deck indices. `resolve` re-derives
 * the real index by re-running the identical search against the secret deck
 * at answer time — safe, because no other move can run while a
 * pendingChoice is open, so the deck can't have changed underneath it. Hand
 * search reuses the same ordinal scheme for uniformity, even though a hand
 * search would be safe to reveal real indices for (it's already visible to
 * its own owner via playerView) — one code path, not two.
 */
function dispatchSearch(
  G: ShadowkhanG,
  ctx: unknown,
  self: AbilitySelf,
  label: string,
  key: string,
  zone: SearchZone,
  owner: string,
  predicate: (label: string) => boolean,
  prompt: string,
  apply: (G: ShadowkhanG, owner: string, realIndex: number) => void
): void {
  const matches = searchIndices(G, zone, owner, predicate);
  if (matches.length === 0) return;
  if (matches.length === 1) {
    apply(G, owner, matches[0]);
    return;
  }
  const searchChoice: ChoiceAbility = {
    needsChoice: true,
    prompt,
    kind: 'chooseAbility',
    getOptions: (G2) => searchIndices(G2, zone, owner, predicate).map((_, i) => i),
    resolve: (G2, _ctx2, _self2, answer) => {
      if (typeof answer !== 'number') return;
      const fresh = searchIndices(G2, zone, owner, predicate);
      const realIndex = fresh[answer];
      if (realIndex === undefined) return;
      apply(G2, owner, realIndex);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL[label] ??= {})[key] = searchChoice;
  openChoice(G, ctx, self, label, key, searchChoice);
}

function eligibleOwnBattleCardsAtOrBelow(
  G: ShadowkhanG,
  self: AbilitySelf,
  maxBp: number
): number[] {
  return G.public.field[self.pid]
    .map((c, i) => (c && c.currentBp <= maxBp ? i : null))
    .filter((i): i is number => i !== null);
}

const CHOICE_ABILITIES_BY_LABEL: Record<string, Record<string, ChoiceAbility>> = {
  // Sk-14 ONE EYED MECHANICAL MONSTER, ability a: "When this card is
  // summoned, you may remove 1 of your opponent's Battle Cards from the
  // field." A yesNo entry, chaining into an opponentField target pick.
  'Sk-14': {
    a: {
      needsChoice: true,
      trigger: 'onSummon',
      leadsTo: 'a-target',
      prompt: "One Eyed Mechanical Monster: remove one of your opponent's Battle Cards from the field?",
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        const opp = self.pid === '0' ? '1' : '0';
        const options = G.public.field[opp]
          .map((c, i) => (c ? i : null))
          .filter((i): i is number => i !== null);
        if (options.length === 0) return;
        openChoice(G, ctx, self, 'Sk-14', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-14']['a-target']);
      },
    },
    'a-target': {
      needsChoice: true,
      prompt: "Choose which of your opponent's Battle Cards to remove.",
      kind: 'opponentField',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.public.field[opp]
          .map((c, i) => (c ? i : null))
          .filter((i): i is number => i !== null);
      },
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        removeOpponentFieldCard(G, ctx, opp, answer);
      },
    },
    // ability b: "you may remove 1 card from your opponent's hand or the top
    // of their deck." Dispatched from ABILITIES_BY_LABEL['Sk-14'] above only
    // when at least one source is non-empty.
    'b-confirm': {
      needsChoice: true,
      prompt: "One Eyed Mechanical Monster: remove 1 card from your opponent's hand or the top of their deck?",
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        const opp = self.pid === '0' ? '1' : '0';
        const handEmpty = G.secret.hands[opp].length === 0;
        const deckEmpty = G.secret.decks[opp].length === 0;
        const options = [0, 1].filter((n) => (n === 0 ? !handEmpty : !deckEmpty));
        const prompt = handEmpty
          ? "Remove the top card of your opponent's deck."
          : deckEmpty
            ? "Remove 1 card from your opponent's hand."
            : "Choose a source: (0) opponent's hand, or (1) the top of their deck.";
        openChoice(G, ctx, self, 'Sk-14', 'b-source', {
          ...CHOICE_ABILITIES_BY_LABEL['Sk-14']['b-source'],
          prompt,
          getOptions: () => options,
        });
      },
    },
    'b-source': {
      needsChoice: true,
      prompt: "Choose a source: (0) opponent's hand, or (1) the top of their deck.",
      kind: 'chooseAbility',
      getOptions: () => [0, 1],
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        if (answer === 0) {
          if (G.secret.hands[opp].length === 0) return;
          openChoice(G, ctx, self, 'Sk-14', 'b-hand-target', CHOICE_ABILITIES_BY_LABEL['Sk-14']['b-hand-target']);
        } else {
          removeOpponentDeckTop(G, opp);
        }
      },
    },
    'b-hand-target': {
      needsChoice: true,
      prompt: "Choose which of your opponent's hand cards to remove.",
      kind: 'opponentHandIndex',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.secret.hands[opp].map((_c, i) => i);
      },
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        removeFromOpponentHand(G, opp, answer);
      },
    },
  },

  // Sk-13 MYSTICAL BLUE FLAME POWER CARD: "Choose one of the following
  // effects when activated: [0] Increase the BP of one of your Battle Cards
  // by +1 ... / [1] Restore the BP of one of your Battle Cards to its
  // original BP ..." Usable only on Battle Cards with BP<=6. A chooseAbility
  // entry, chaining into an ownField target pick for whichever branch was
  // picked. CAVEAT: both branches apply immediately in this pass — the
  // printed "until end of your turn" (branch 0) and "at the end of your
  // opponent's turn after activated" delay (branch 1) aren't modeled; there's
  // no temporary/delayed-effect scheduler yet.
  'Sk-13': {
    a: {
      needsChoice: true,
      trigger: 'onSummon',
      prompt: 'Mystical Blue Flame — choose an effect: (0) +1 BP to a Battle Card of yours, or (1) restore one of your Battle Cards to its original BP.',
      kind: 'chooseAbility',
      getOptions: () => [0, 1],
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const eligible = eligibleOwnBattleCardsAtOrBelow(G, self, 6);
        if (eligible.length === 0) return;
        const key = answer === 0 ? 'a-target-buff' : 'a-target-restore';
        openChoice(G, ctx, self, 'Sk-13', key, CHOICE_ABILITIES_BY_LABEL['Sk-13'][key]);
      },
    },
    'a-target-buff': {
      needsChoice: true,
      prompt: 'Choose one of your Battle Cards (BP 6 or less) to gain +1 BP.',
      kind: 'ownField',
      getOptions: (G, _ctx, self) => eligibleOwnBattleCardsAtOrBelow(G, self, 6),
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const card = G.public.field[self.pid][answer];
        if (card) modifyBp(card, 1);
      },
    },
    'a-target-restore': {
      needsChoice: true,
      prompt: 'Choose one of your Battle Cards (BP 6 or less) to restore to its original BP.',
      kind: 'ownField',
      getOptions: (G, _ctx, self) => eligibleOwnBattleCardsAtOrBelow(G, self, 6),
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const card = G.public.field[self.pid][answer];
        if (!card) return;
        const original = CARD_BY_LABEL[card.label]?.bp ?? card.currentBp;
        modifyBp(card, original - card.currentBp);
      },
    },
  },

  // Sk-07 ACE IN THE HOLE confirm step. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-07'] above.
  'Sk-07': {
    'b-confirm': {
      needsChoice: true,
      prompt: 'Ace In The Hole: place it at the bottom of your deck?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, _ctx, self, answer) => {
        if (answer !== true) return;
        const hand = G.secret.hands[self.pid];
        if (self.slot < 0 || self.slot >= hand.length) return;
        const [label] = hand.splice(self.slot, 1);
        G.secret.decks[self.pid].push(label);
      },
    },
  },

  // Sk-05 DIVINE SKY STRIKE target step. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-05'] above.
  'Sk-05': {
    'a-target': {
      needsChoice: true,
      prompt: "Divine Sky Strike: choose which of your opponent's Battle Cards to remove.",
      kind: 'opponentField',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.public.field[opp]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
      },
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        removeOpponentFieldCard(G, ctx, opp, answer);
      },
    },
  },

  // Sk-11 CHOSEN CONDUIT target step. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-11'] above. Its resolve() implements effects b
  // and c inline (the BP<=9 gate and the overflow field-wipe), and — only
  // when the buff would push BP past 9 — registers a one-shot yesNo confirm
  // entry under a dynamic key so the player is warned before losing their
  // whole field, per the ruling to make that consequence explicit.
  'Sk-11': {
    'a-target': {
      needsChoice: true,
      prompt: 'Chosen Conduit: choose one of your Battle Cards to increase its BP by the total BP of your other Battle Cards.',
      kind: 'ownField',
      getOptions: (G, _ctx, self) =>
        G.public.field[self.pid]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null),
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const card = G.public.field[self.pid][answer];
        if (!card) return;
        // effect b: only applies if the selected card's current BP is 9 or less.
        if (card.currentBp > 9) return;
        const others = G.public.field[self.pid].filter(
          (c, i): c is FieldCard => i !== answer && c !== null && CARD_BY_LABEL[c.label]?.type === 'battle'
        );
        const delta = others.reduce((sum, c) => sum + c.currentBp, 0);
        const newBp = card.currentBp + delta;
        if (newBp <= 9) {
          modifyBp(card, delta);
          return;
        }
        // effect c: would push BP above 9 — confirm before wiping the field.
        const targetSlot = answer;
        const cardName = CARD_BY_LABEL[card.label]?.name ?? card.label;
        const confirmKey = `a-confirm-${targetSlot}`;
        CHOICE_ABILITIES_BY_LABEL['Sk-11'][confirmKey] = {
          needsChoice: true,
          prompt: `Chosen Conduit will raise ${cardName} above BP 9, which removes every card from your field. Continue?`,
          kind: 'yesNo',
          getOptions: () => null,
          resolve: (G2, ctx2, self2, answer2) => {
            if (answer2 !== true) return;
            const target = G2.public.field[self2.pid][targetSlot];
            if (target) modifyBp(target, delta);
            const ownField = G2.public.field[self2.pid];
            for (let i = 0; i < ownField.length; i++) {
              if (!ownField[i]) continue;
              // No wired hook applies to an 'ability'-cause removal today,
              // so this always completes synchronously — the break guards
              // a future hook that might not, so a mid-wipe pendingChoice
              // can't be followed by further mutation in this dispatch.
              const result = removeFieldCard(G2, ctx2, self2.pid, i, 'ability');
              if (result === 'pending') break;
            }
          },
        };
        openChoice(G, ctx, self, 'Sk-11', confirmKey, CHOICE_ABILITIES_BY_LABEL['Sk-11'][confirmKey]);
      },
    },
  },

  // Sk-12 CURSE OF STONE target step. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-12'] above.
  'Sk-12': {
    'a-target': {
      needsChoice: true,
      prompt: "Curse of Stone: choose one of your opponent's Battle Cards. It, and every other of their cards sharing its BP, cannot attack, be attacked, or use card effects until the end of their next turn.",
      kind: 'opponentField',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.public.field[opp]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
      },
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        const target = G.public.field[opp][answer];
        if (!target) return;
        const bp = target.currentBp;
        const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
        const expiresAtGlobalTurn = globalTurns + 2; // through the rest of this turn, then all of the opponent's next turn
        const kinds: EffectKind[] = ['cannotAttack', 'cannotBeAttacked', 'cannotUseEffects'];
        G.public.field[opp].forEach((c, i) => {
          if (c && c.currentBp === bp) {
            G.public.activeEffects.push({
              kinds,
              targetPid: opp,
              targetSlot: i,
              sourceLabel: 'Sk-12',
              sourcePid: self.pid,
              sourceSlot: self.slot,
              expiresAtGlobalTurn,
            });
          }
        });
      },
    },
  },

  // Sk-25 BATTLE SHOCK SCORPION confirm step. Only reachable via the
  // dispatcher in ABILITIES_BY_LABEL['Sk-25'] above.
  'Sk-25': {
    'a-confirm': {
      needsChoice: true,
      prompt: "Battle Shock Scorpion: remove the top card of your opponent's deck?",
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, _ctx, self, answer) => {
        if (answer !== true) return;
        const opp = self.pid === '0' ? '1' : '0';
        removeOpponentDeckTop(G, opp);
      },
    },
  },

  // Sk-24 BLAZING SKY GOBLIN confirm step. Only reachable via the dispatcher
  // in ABILITIES_BY_LABEL['Sk-24'] above. On Yes, hands off to the generic
  // search primitive: with a singleton 30-card deck a named search can only
  // ever find 0 or 1 copies, so this always applies immediately with no
  // further prompt — the "more than one match" branch of dispatchSearch
  // exists for future BP/type-based searches, not this card.
  'Sk-24': {
    'a-confirm': {
      needsChoice: true,
      prompt: "Blazing Sky Goblin: add A Sinister Alliance from your deck to your hand?",
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-24',
          'a-search',
          'deck',
          self.pid,
          (label) => CARD_BY_LABEL[label]?.name === 'A SINISTER ALLIANCE',
          'Choose which A Sinister Alliance to add to your hand.',
          moveDeckCardToHand
        );
      },
    },
  },

  // Sk-10 CYCLO OPTIC BEAM target-selection steps. Only reachable via the
  // dispatcher in ABILITIES_BY_LABEL['Sk-10'] above (neither entry has a
  // `trigger`, so fireTrigger never opens them directly).
  'Sk-10': {
    'field-target': {
      needsChoice: true,
      prompt: "Choose which of your opponent's Battle Cards (BP 7 or less) to remove.",
      kind: 'opponentField',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.public.field[opp]
          .map((c, i) => (c && c.currentBp <= 7 ? i : null))
          .filter((i): i is number => i !== null);
      },
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        removeOpponentFieldCard(G, ctx, opp, answer);
      },
    },
    'hand-target': {
      needsChoice: true,
      prompt: "Your opponent's field is empty — choose which of their hand cards to remove.",
      kind: 'opponentHandIndex',
      getOptions: (G, _ctx, self) => {
        const opp = self.pid === '0' ? '1' : '0';
        return G.secret.hands[opp].map((_c, i) => i);
      },
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const opp = self.pid === '0' ? '1' : '0';
        removeFromOpponentHand(G, opp, answer);
      },
    },
  },
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
  if (abilities) {
    for (const ability of abilities) {
      if (ability.auto && ability.trigger === trigger) {
        ability.run({ G, ctx, self });
      }
    }
  }

  if (!G.public.pendingChoice) {
    const choices = CHOICE_ABILITIES_BY_LABEL[fieldCard.label];
    if (choices) {
      for (const [key, choice] of Object.entries(choices)) {
        if (choice.trigger === trigger) {
          if (willHaveLegalOutcome(G, ctx, self, fieldCard.label, choice)) {
            openChoice(G, ctx, self, fieldCard.label, key, choice);
          }
          break;
        }
      }
    }
  }

  syncCounts(G);
}

// ---------------------------------------------------------------------------
// Draw trigger. A card that's just been drawn is hand-resident, not
// field-resident — fireTrigger's very first line (`G.public.field[pid][slot]`)
// would immediately bail for it, so it can't be reused as-is. fireOnDraw is
// the parallel dispatcher: same two-pass shape (auto Ability entries, then a
// trigger-bound ChoiceAbility with the same willHaveLegalOutcome look-ahead),
// just sourced from G.secret.hands[pid][handIndex] instead of the field.
//
// For an onDraw ability's self context, self.slot carries the HAND INDEX of
// the drawn card — the one trigger where that's true; every other trigger
// keeps self.slot meaning field slot. This lets onDraw abilities reuse
// AbilitySelf/ChoiceAbility/openChoice/dispatchSearch/resolvePendingChoice
// completely unchanged (resolvePendingChoice already reconstructs self as
// {pid, slot: pending.sourceSlot}, which is exactly the hand index here).
//
// drawCardForPlayer is the single choke point every genuine draw goes
// through (the drawCard move and turn.onBegin's auto-draw — see game.ts).
// It is NOT used by the opening-hand deal (setup() mutates the raw deck/hand
// arrays directly, before G exists, entirely bypassing this function) and
// NOT used by moveDeckCardToHand (Sk-20b/23a/24a all say "add ... to your
// hand", never "draw"). Each call fires onDraw exactly once for exactly the
// card it just drew; there is no shared "currently drawing" state for a
// nested draw (e.g. a future "draw an additional card" ability) to
// collide with, so recursion is safe by construction — a nested call fires
// onDraw for its own, different card, and never replays the outer draw.
function fireOnDraw(
  G: ShadowkhanG,
  ctx: unknown,
  pid: string,
  handIndex: number
): void {
  const label = G.secret.hands[pid][handIndex];
  if (!label) return;
  const self: AbilitySelf = { pid, slot: handIndex };

  const abilities = ABILITIES_BY_LABEL[label];
  if (abilities) {
    for (const ability of abilities) {
      if (ability.auto && ability.trigger === 'onDraw') {
        ability.run({ G, ctx, self });
      }
    }
  }

  if (!G.public.pendingChoice) {
    const choices = CHOICE_ABILITIES_BY_LABEL[label];
    if (choices) {
      for (const [key, choice] of Object.entries(choices)) {
        if (choice.trigger === 'onDraw') {
          if (willHaveLegalOutcome(G, ctx, self, label, choice)) {
            openChoice(G, ctx, self, label, key, choice);
          }
          break;
        }
      }
    }
  }

  syncCounts(G);
}

/** Shifts the top card of owner's deck into their hand and fires onDraw for
 *  it. The single choke point for a genuine draw — see the block comment
 *  above for what does and doesn't route through here. */
export function drawCardForPlayer(
  G: ShadowkhanG,
  ctx: unknown,
  pid: string
): void {
  const deck = G.secret.decks[pid];
  if (deck.length === 0) return;
  const hand = G.secret.hands[pid];
  const label = deck.shift()!;
  const handIndex = hand.push(label) - 1;
  fireOnDraw(G, ctx, pid, handIndex);
}

/** Resolves G.public.pendingChoice with `answer`. Returns false (and leaves
 *  pendingChoice untouched) if there's nothing pending or the answer isn't a
 *  legal option, so the move layer can turn that into INVALID_MOVE. */
export function resolvePendingChoice(
  G: ShadowkhanG,
  ctx: unknown,
  answer: number | boolean
): boolean {
  const pending = G.public.pendingChoice;
  if (!pending) return false;

  const choice = CHOICE_ABILITIES_BY_LABEL[pending.sourceLabel]?.[pending.abilitySlot];
  if (!choice) {
    G.public.pendingChoice = null;
    return false;
  }

  if (pending.kind === 'yesNo') {
    if (typeof answer !== 'boolean') return false;
  } else {
    if (typeof answer !== 'number') return false;
    if (pending.options !== null && !pending.options.includes(answer)) return false;
  }

  const self: AbilitySelf = { pid: pending.pid, slot: pending.sourceSlot ?? -1 };
  G.public.pendingChoice = null;
  choice.resolve(G, ctx, self, answer);
  syncCounts(G);
  return true;
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
  ctx: unknown,
  targetLabel: string,
  attackerPid: string,
  attackerSlot: number
): boolean {
  if (targetLabel === 'Sk-02') {
    removeOpponentFieldCard(G, ctx, attackerPid, attackerSlot);
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
  { label: 'Sk-03', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Two independent selections, not one search: an own-field removal target (no search involved), plus a named search for War Dragon across TWO zones (face-up removed pile, which is public, OR the deck, which is secret) — dispatchSearch only takes a single zone, and folding the public removed-pile half in would silently misrepresent the other half as covered. Deferred as a whole rather than wiring the deck-only half and dropping the removed-pile branch." },
  { label: 'Sk-04', slot: 'a', classification: 'NEEDS_CHOICE', reason: 'Select which removed face-up card to return, and which field slot to return it to.' },
  { label: 'Sk-06', slot: 'a', classification: 'NEEDS_CHOICE', reason: "The search itself (BP<=8 Battle Card from your deck) is expressible with dispatchSearch, but the printed effect doesn't add the found card to hand — it's held for effect b's cost payment and a delayed 'considered played next turn' summon, neither of which exist. Wiring just the search with dispatchSearch's only real action (move-to-hand) would misrepresent the card." },
  { label: 'Sk-06', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Select hand/deck cards to remove equal to the selected card's BP; also needs a delayed 'start of next turn' summon not currently modeled." },
  { label: 'Sk-07', slot: 'a', classification: 'NEEDS_CHOICE', reason: "onDraw now exists and correctly identifies this branch (deck empty after the draw), but 'select 10 of your face-up removed cards' is a genuine multi-select — the single-answer pendingChoice/dispatchSearch machinery has no way to express picking 10 at once." },
  { label: 'Sk-08', slot: 'a', classification: 'NEEDS_CHOICE', reason: "The play-gate (own field has Blazing Sky Goblin/Sand Squid/Battle Shock Scorpion) is now enforced via PLAY_GATES/isPlayLegal. Still unwired: 'From your deck, you may play one of the above-mentioned cards that is not already on your field' — the named-card search over the deck is expressible with dispatchSearch, but the found card must be PLAYED directly to an empty own field slot (and fire onSummon), not added to hand — dispatchSearch's apply step only performs the caller-supplied action, and 'play to field' needs its own empty-slot target selection chained after the search, with its own zero-target case (no room to play it) layered on top." },
  { label: 'Sk-09', slot: 'a', classification: 'GATE', reason: "Only usable on Shadow Ghost — this is a targeting/attach requirement (which field card the Power Card enhances), not a boolean state condition, so it doesn't fit PLAY_GATES's check(G, pid) => boolean shape. playCard has no attach-target parameter for Power Cards to express 'only usable on card X' at all. Excluded from this pass rather than approximated as 'Shadow Ghost merely present somewhere on the field', which would misrepresent the attachment relationship." },
  { label: 'Sk-09', slot: 'b', classification: 'NEEDS_CHOICE', reason: "A continuous removal-immunity effect with a stated duration — the persistent-effect registry (hasActiveEffect/expiresAtGlobalTurn) added for Sk-12/Sk-22 could express it directly. Still blocked on the same unrelated gap as Sk-09a though: depends on Sk-09's attach targeting (which specific field card this protects), which isn't wired." },
  { label: 'Sk-15', slot: 'a', classification: 'NOT_IMPLEMENTED', reason: "\"Cannot be removed by Battle Card effects\" — same shape as Sk-16b's protectedFromBattleCardRemoval flag (a simple onSummon set-and-forget, no choice involved) and could be wired the same trivial way, but doing so is outside this pass's scope (the removal-REPLACEMENT hook system); not blocked by missing machinery, just not picked up here." },
  { label: 'Sk-16', slot: 'c', classification: 'NEEDS_CHOICE', reason: "'you may remove 1 face-down Power Card...to negate' — optional, needs a reactive negation system." },
  { label: 'Sk-16', slot: 'd', classification: 'NEEDS_CHOICE', reason: 'Same shape as slot c for Action Cards; printed text is also flagged low-confidence in cards.ts.' },
  { label: 'Sk-18', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may select 1 of your removed cards' to copy." },
  { label: 'Sk-18', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-18a's selection." },
  { label: 'Sk-20', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may remove 3 cards from your hand...' — optional, multi-select." },
  { label: 'Sk-21', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you may select...call it correctly' — optional guessing minigame." },
  { label: 'Sk-21', slot: 'b', classification: 'NEEDS_CHOICE', reason: "Depends on Sk-21a's guess outcome." },
  { label: 'Sk-25', slot: 'c', classification: 'NEEDS_CHOICE', reason: "'you can add one face-up removed Action Card...' — optional, selects from the removed pool." },
  { label: 'Sk-26', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can select one Battle Card...place it under this card' — optional target selection; also needs a new 'cards attached under this card' mechanic." },
  { label: 'Sk-26', slot: 'b', classification: 'NOT_IMPLEMENTED', reason: "Depends entirely on Sk-26a's 'place under this card' mechanic, which is deferred — nothing will ever be attached to return." },
  { label: 'Sk-28', slot: 'b', classification: 'NOT_IMPLEMENTED', reason: "onDraw now exists and would correctly fire when the opponent draws their planted copy (fireOnDraw dispatches by label regardless of whose deck the card came from), but 'within their next five turns' needs a per-instance countdown attached to that specific deck entry — decks are plain string[] with no per-card metadata slot to hold a planted-turn number. Out of scope for wiring a trigger alone." },
  { label: 'Sk-28', slot: 'c', classification: 'NOT_IMPLEMENTED', reason: 'Same missing infrastructure as slot b — and this branch is a turn-count timeout, not a draw event, so onDraw does not apply to it at all.' },
  { label: 'Sk-29', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can remove this card on the field instead' — a GUARDIAN ability protecting a DIFFERENT own card elsewhere on the field (any own BP<=4 Battle Card, not itself), not a self-protection hook. REMOVAL_HOOKS is keyed by the label of the card BEING removed, so it can't express 'watch for ANY other qualifying card being removed and offer to substitute' — that needs a full field scan on every removal, a different shape than the other three wired hooks." },
  { label: 'Sk-30', slot: 'a', classification: 'NEEDS_CHOICE', reason: "'you can add it to your deck instead...' — same guardian shape as Sk-29a: protects a Shadow Ghost elsewhere on the field, not itself. Same reason for staying out of REMOVAL_HOOKS." },
];
