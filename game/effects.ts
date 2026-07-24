import { CARD_BY_LABEL } from './cards';
import type { ActiveEffect, EffectKind, FieldCard, PendingChoice, PendingChoiceKind, ShadowkhanG } from './state';
import { syncCounts } from './state';
import type { Ctx, FnContext } from 'boardgame.io';
import { Stage } from 'boardgame.io/core';

/** boardgame.io's deterministic random plugin — Shuffle/Die/etc. Derived
 *  from FnContext rather than importing the plugin's own internal type
 *  directly, since that's not part of the package's public export surface. */
type RandomAPI = FnContext<ShadowkhanG>['random'];

/** boardgame.io's events API (setActivePlayers, etc.) — same derivation
 *  reasoning as RandomAPI. Used to grant a pendingChoice's owner move access
 *  even when they don't hold the turn — see syncActivePlayersToPendingChoice. */
type EventsAPI = FnContext<ShadowkhanG>['events'];

/**
 * The single opaque "engine context" threaded through every ability code
 * path in this file, replacing the old bare `ctx: unknown` parameter.
 * `random` and `events` ride along the same plumbing ctx always did, so any
 * card effect, however deeply chained (fireTrigger -> run -> openChoice ->
 * ... -> resolve -> dispatchSearch -> apply), has access to both without a
 * parallel threading mechanism. Card effects must use `ctx.random`, never
 * Math.random — the latter would desync replay and multiplayer clients,
 * since only the plugin's calls are captured/replayed by boardgame.io's
 * engine. `ctx.ctx` is boardgame.io's own Ctx (currentPlayer, activePlayers,
 * etc.) — typed for real now (previously `unknown`, since nothing read it)
 * because syncActivePlayersToPendingChoice needs ctx.currentPlayer.
 */
export interface EngineCtx {
  ctx: Ctx;
  random: RandomAPI;
  events: EventsAPI;
}

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
  ctx: EngineCtx;
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
  getOptions: (G: ShadowkhanG, ctx: EngineCtx, self: AbilitySelf) => number[] | null;
  /** answer is number[] only for a multi-select choice's final resolution
   *  (see PendingChoice.multi) — every existing single-answer resolve()
   *  already rejects a non-number/non-boolean answer via its own
   *  `typeof answer !== ...` guard, so widening this type is safe and
   *  requires no changes to any existing resolve() body. */
  resolve: (
    G: ShadowkhanG,
    ctx: EngineCtx,
    self: AbilitySelf,
    answer: number | boolean | number[]
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
  ctx: EngineCtx,
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

/** Discards multiple cards from owner's own hand, face-up, by LABEL rather
 *  than index — safe regardless of processing order, since each hand entry
 *  is unique per player. The multi-select counterpart to
 *  discardOwnHandCard, used by dispatchMultiSearch's apply callbacks. */
export function discardMultipleFromOwnHand(
  G: ShadowkhanG,
  owner: string,
  labels: string[]
): void {
  for (const removedLabel of labels) {
    const hand = G.secret.hands[owner];
    const idx = hand.indexOf(removedLabel);
    if (idx === -1) continue;
    const [l] = hand.splice(idx, 1);
    G.public.banished[owner].push(l);
  }
}

/** Removes multiple cards from owner's own deck, face-up, by LABEL — same
 *  order-independence reasoning as discardMultipleFromOwnHand. The
 *  multi-select counterpart to moveDeckCardToHand's "remove" shape (there's
 *  no existing single-card "remove own deck card to banished" helper to
 *  pair with, since no prior ability needed one). */
export function removeMultipleFromOwnDeck(
  G: ShadowkhanG,
  owner: string,
  labels: string[]
): void {
  for (const removedLabel of labels) {
    const deck = G.secret.decks[owner];
    const idx = deck.indexOf(removedLabel);
    if (idx === -1) continue;
    const [l] = deck.splice(idx, 1);
    G.public.banished[owner].push(l);
  }
}

/** Removes multiple cards from owner's own hand AND/OR deck, face-up, by
 *  LABEL — tries hand first, falls back to deck, same order-independence
 *  reasoning as discardMultipleFromOwnHand/removeMultipleFromOwnDeck. The
 *  multi-select counterpart to zone: 'handOrDeck' (see SearchZone), used by
 *  Sk-06b's "remove from your hand and/or deck" cost, where a single label
 *  could be in either zone and the player chooses freely between them. */
export function removeMultipleFromHandOrDeck(
  G: ShadowkhanG,
  owner: string,
  labels: string[]
): void {
  for (const removedLabel of labels) {
    const hand = G.secret.hands[owner];
    const handIdx = hand.indexOf(removedLabel);
    if (handIdx !== -1) {
      const [l] = hand.splice(handIdx, 1);
      G.public.banished[owner].push(l);
      continue;
    }
    const deck = G.secret.decks[owner];
    const deckIdx = deck.indexOf(removedLabel);
    if (deckIdx !== -1) {
      const [l] = deck.splice(deckIdx, 1);
      G.public.banished[owner].push(l);
    }
  }
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

/** The label whose ABILITIES_BY_LABEL / CHOICE_ABILITIES_BY_LABEL /
 *  REMOVAL_HOOKS / GUARDIAN_HOOKS entry a field card currently resolves
 *  through: its own printed `label`, unless Sk-18a's copy-identity effect
 *  has set `copiedIdentity`, in which case every identity-DRIVEN lookup
 *  (which ability fires, which hook protects it) uses the COPIED label
 *  instead. This is the one place that decision is made — fireTrigger and
 *  removeFieldCard both call this instead of reading `card.label` directly,
 *  so a copy's abilities/hooks work through the exact same dispatch every
 *  other card uses, with zero per-card special-casing anywhere else.
 *  Deliberately NOT applied to physical-identity lookups (banished-pile
 *  tracking, PLAY_GATES, singleton-deck name searches) — those must keep
 *  reading `card.label` so the copying card is tracked as what it actually
 *  is. PLAY_GATES specifically never needs this at all: gates are checked
 *  only at play time, before Sk-18's onSummon copy effect has fired, so a
 *  copy never retroactively changes what's needed to have played it. */
export function effectiveLabel(card: FieldCard): string {
  return card.copiedIdentity ?? card.label;
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

/** Places `label` onto pid's field at `slot` and fires onSummon for it — the
 *  EXACT construction/sequencing playCard's own move body uses (see
 *  playCard in game.ts), factored out so an ability-driven placement (Sk-04a
 *  returning a removed card to the field, Sk-08a playing a searched one) is
 *  indistinguishable from a normally-played card: same FieldCard shape, same
 *  syncCounts call, same onSummon firing. One placement mechanism, not a
 *  parallel one — playCard itself now calls this too. Caller's
 *  responsibility to have already confirmed `slot` is empty and `label`'s
 *  source zone has been emptied of it (removed pile, deck, etc.). */
export function placeCardOnField(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  slot: number,
  label: string,
  /** suppressOnSummon: true delays the onSummon firing to a later, separate
   *  call the caller makes itself — used only by playCard's Power-card path
   *  (see offerSk16Negation) so a card can be genuinely PLAYED (occupying
   *  its slot, exactly like any other card in this engine — see Sk-05a's own
   *  established precedent of a resolved Action Card staying on the field)
   *  while its own onSummon effect stays paused behind Sk-16c's reactive
   *  interrupt window. Every other caller omits this and keeps the original
   *  atomic behavior unchanged. */
  opts?: { suppressOnSummon?: boolean }
): void {
  const printed = CARD_BY_LABEL[label];
  G.public.field[pid][slot] = {
    label,
    currentBp: printed?.bp ?? 0,
    attached: [],
    turnsOnField: 0,
  };
  syncCounts(G);
  if (!opts?.suppressOnSummon) {
    fireTrigger(G, ctx, 'onSummon', { pid, slot });
  }
}

// ---------------------------------------------------------------------------
// Attach targets. Some cards are never placed onto their own field slot at
// all: their printed text is "used on" / "placed under" another field card
// (Sk-09 "can only be used on Shadow Ghost"; a future Sk-26 "place it under
// this card"). One registry, keyed by the ATTACHING card's own label —
// playCard's move body checks this BEFORE treating a play as a normal
// placement, so `slot` in that case means "attach to whatever occupies this
// slot" instead of "place into this empty slot". No second play path: it's
// still the same playCard move, same handIndex/slot argument shape, just a
// different branch through the same body.
//
// Scope for this pass: Sk-09 only. Sk-26a also needs this exact mechanism
// (an opponent-field target, repeatable, with cards later returned from
// under it — see its own DEFERRED_ABILITIES entry) but is deliberately not
// wired here.
// ---------------------------------------------------------------------------

export interface AttachTarget {
  /** Printed slot letter, for traceability — not read by playCard itself. */
  slot: 'a' | 'b' | 'c' | 'd';
  /** Does field slot `targetSlot` on pid's own field hold a legal target for
   *  this card right now? The broad "is there a legal target ANYWHERE"
   *  precondition lives in PLAY_GATES instead (same shape every other "can
   *  only play if..." card already uses) — this is the more precise check
   *  that the SPECIFIC slot argument actually points at one. */
  isValidTarget: (G: ShadowkhanG, pid: string, targetSlot: number) => boolean;
  /** Applies this card's own effect once attached. Runs synchronously, no
   *  trigger/choice machinery — every currently-wireable attach effect is
   *  immediate and unconditional (no "you may" branching at attach time),
   *  so this doesn't need the fireTrigger/ABILITIES_BY_LABEL machinery,
   *  which looks abilities up by whatever's field-resident at self.slot —
   *  the attaching card never is. */
  onAttach: (G: ShadowkhanG, pid: string, hostSlot: number) => void;
}

const ATTACH_TARGETS: Record<string, AttachTarget> = {
  // Sk-09 POWER OF THE SHADOWS: "Shadow Ghost cannot be removed by Battle
  // Cards or card effects until the end of your opponent's turn after this
  // card was activated." Read consistently with the existing designer
  // ruling on Sk-15a/Sk-16b's near-identical wording ("no card is
  // unbanishable... losing an ordinary BP battle always banishes"):
  // 'protectedFromRemoval' is checked only for cause === 'ability' in
  // removeFieldCard, same scope as protectedFromBattleCardRemoval. "Until
  // the end of your opponent's turn after this card was activated" is the
  // same window as Sk-12/Sk-13c's "until the end of the opponent's next
  // turn" — expiresAtGlobalTurn = globalTurns + 2, "activated" read as the
  // moment this card is attached (it has no activateAbility path of its
  // own: no field slot, so no cardFieldIndex to activate by).
  'Sk-09': {
    slot: 'a',
    isValidTarget: (G, pid, targetSlot) => {
      const card = G.public.field[pid][targetSlot];
      return !!card && CARD_BY_LABEL[card.label]?.name === 'SHADOW GHOST';
    },
    onAttach: (G, pid, hostSlot) => {
      const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
      G.public.activeEffects.push({
        kinds: ['protectedFromRemoval'],
        targetPid: pid,
        targetSlot: hostSlot,
        sourceLabel: 'Sk-09',
        sourcePid: pid,
        sourceSlot: hostSlot,
        expiresAtGlobalTurn: globalTurns + 2,
      });
    },
  },
};

/** True if `label` is an attach-target card (see ATTACH_TARGETS) — playCard's
 *  single check for which branch a play takes. Mirrors isPlayLegal's own
 *  role as the one encapsulated entry point into a *_BY_LABEL registry, so
 *  game.ts never reaches into ATTACH_TARGETS directly. */
export function getAttachTarget(label: string): AttachTarget | undefined {
  return ATTACH_TARGETS[label];
}

/** Attaches `label` to the field card at pid/hostSlot — pushes it onto the
 *  host's own `attached` list and runs the attaching card's own onAttach
 *  effect (see ATTACH_TARGETS). The single mechanism behind every
 *  attach-target card; playCard calls this instead of placeCardOnField when
 *  the played label has an ATTACH_TARGETS entry. */
export function attachCardToHost(G: ShadowkhanG, pid: string, hostSlot: number, label: string): void {
  const host = G.public.field[pid][hostSlot];
  if (!host) return;
  host.attached.push(label);
  ATTACH_TARGETS[label]?.onAttach(G, pid, hostSlot);
}

/** Purges `label` from owner's banishedFromField, if present — called
 *  wherever a label leaves `banished`, so the tag never outlives the removed
 *  card it describes (see banishedFromField's doc comment in state.ts). */
function untagBanishedFromField(G: ShadowkhanG, owner: string, label: string): void {
  const tagged = G.public.banishedFromField[owner];
  const idx = tagged.indexOf(label);
  if (idx !== -1) tagged.splice(idx, 1);
}

/** Removes the label at `index` from owner's own face-up removed pile
 *  (G.public.banished) and returns it, so the caller can place it wherever
 *  the specific card's text says (hand, field, deck) — there's no single
 *  "found it, take it" destination the way moveDeckCardToHand has one,
 *  since different removed-pile abilities send the card different places.
 *  Public state — no ordinal secrecy concern here (see zoneIsSecret). */
export function removeFromOwnRemovedPile(
  G: ShadowkhanG,
  owner: string,
  index: number
): string | undefined {
  const pile = G.public.banished[owner];
  if (index < 0 || index >= pile.length) return undefined;
  const [label] = pile.splice(index, 1);
  untagBanishedFromField(G, owner, label);
  return label;
}

/** Removes multiple cards from owner's own face-up removed pile, by LABEL —
 *  the multi-select counterpart to removeFromOwnRemovedPile, order-independent
 *  the same way as discardMultipleFromOwnHand/removeMultipleFromOwnDeck
 *  (each removed-pile entry is unique per player, so splicing by indexOf is
 *  safe regardless of processing order). Used by Sk-07a's shuffle-into-deck. */
export function removeMultipleFromOwnRemovedPile(
  G: ShadowkhanG,
  owner: string,
  labels: string[]
): void {
  for (const label of labels) {
    const pile = G.public.banished[owner];
    const idx = pile.indexOf(label);
    if (idx === -1) continue;
    pile.splice(idx, 1);
    untagBanishedFromField(G, owner, label);
  }
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
  // from your deck — is a separate search+play effect, wired in
  // ABILITIES_BY_LABEL['Sk-08']; this gate only covers whether Sk-08 itself
  // may be played.)
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

  // Sk-11 CHOSEN CONDUIT: "You can only play this card when you have two or
  // more Battle Cards on the field." Moved here to match the other
  // structurally identical "can only play if/when..." clauses (Sk-03/08/10/
  // 16), which all reject the move outright via PLAY_GATES rather than
  // letting the card onto the field and having its own ability silently
  // fizzle. Sk-11 itself is a Power Card, never counted here regardless of
  // whether it's already been placed by the time this runs (isPlayLegal is
  // checked before placement anyway).
  'Sk-11': {
    slot: 'a',
    check: (G, pid) =>
      G.public.field[pid].filter((c) => c && CARD_BY_LABEL[c.label]?.type === 'battle').length >= 2,
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

  // Sk-09 POWER OF THE SHADOWS: "This card can only be used on Shadow
  // Ghost." The BROAD precondition — is there a Shadow Ghost anywhere on
  // pid's own field at all — lives here, matching every other "can only
  // play if..." card. This does NOT verify that the SPECIFIC slot the
  // player targets is that Shadow Ghost — that's a distinct, more precise
  // failure mode (Shadow Ghost exists, but you pointed at the wrong slot),
  // checked separately by ATTACH_TARGETS['Sk-09'].isValidTarget in playCard.
  'Sk-09': {
    slot: 'a',
    check: (G, pid) =>
      G.public.field[pid].some((c) => c && CARD_BY_LABEL[c.label]?.name === 'SHADOW GHOST'),
  },
};

/** True if `pid` is allowed to play `label` right now — i.e. no gate entry,
 *  or its condition currently holds. playCard's single legality check. */
export function isPlayLegal(G: ShadowkhanG, pid: string, label: string): boolean {
  const gate = PLAY_GATES[label];
  return !gate || gate.check(G, pid);
}

/** Labels whose activateAbility usage resets every turn instead of the
 *  normal once-EVER FieldCard.activated flag — currently just Sk-26a
 *  ("Once per turn, you can..."). activateAbility's own move body (game.ts)
 *  skips setting/checking `activated` entirely for a repeatable card; the
 *  actual once-per-turn cap reuses the SAME hasActiveEffect('cannotUseEffects')
 *  check that move already runs for every card, driven by a short-lived
 *  ActiveEffect Sk-26a's own onActivate handler creates on itself (expires
 *  at the end of the current turn) — no new gate, no new flag. */
const REPEATABLE_ACTIVATIONS = new Set<string>(['Sk-26']);

export function isRepeatableActivation(label: string): boolean {
  return REPEATABLE_ACTIVATIONS.has(label);
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

  // Sk-03 ARRIVAL OF DOOM, effect b: "Remove one card on your field and add
  // one War Dragon (that was removed or in your deck) to your hand."
  // Mandatory (no "may"), two independent steps chained via resolve():
  //  1. an 'ownField' target pick for which own card to remove — always at
  //     least one legal target, since PLAY_GATES['Sk-03'] already requires
  //     Sage of Dark Omen on the field to play this card at all;
  //  2. a named search for WAR DRAGON, tried against the now-public 'removed'
  //     zone first and falling back to 'deck' only if the removed pile has no
  //     match. Singleton-deck property makes this safe: WAR DRAGON can only
  //     ever be in exactly one zone at a time, so "removed, else deck" is an
  //     unambiguous per-card composition, not a new parallel search
  //     primitive — it's two ordinary dispatchSearch calls, at most one of
  //     which ever actually finds anything. If it's in neither (already on a
  //     field, in a hand, or simply doesn't exist for this player), step 2
  //     silently fizzles — the removal in step 1 still stands, same
  //     independent-clause treatment used elsewhere in this file.
  'Sk-03': [
    {
      slot: 'b',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        openChoice(G, ctx, self, 'Sk-03', 'b-remove', CHOICE_ABILITIES_BY_LABEL['Sk-03']['b-remove']);
      },
    },
  ],

  // Sk-04 PURGATORY UNDONE, effect a: "Add one removed face-up card that was
  // removed from your field back to your field." Mandatory (no "may"/"can").
  // CHOICE_READY pre-check on BOTH halves before opening anything (an empty
  // own field slot to place into, AND a field-origin removed card to place)
  // — same shape as Sk-05/08/10/11/20a/24/25c above, and deliberately not
  // "search first, discover no room mid-chain": the new emptyOwnFieldSlot
  // choice's own zero-option gate would also catch that, but checking both
  // up front avoids answering the search question only to watch the
  // follow-up silently do nothing.
  // "removed from your field" is read via G.public.banishedFromField, tagged
  // once at the sole field-removal choke point (finalizeFieldRemoval) and
  // purged wherever a label leaves the removed pile — see state.ts. A card
  // placed this way goes through placeCardOnField, the exact function
  // playCard itself calls, so it fires onSummon like any other placement —
  // there is no "entered the field without being played" concept anywhere
  // in this engine, and the printed "back to your field" reads naturally as
  // the same action, not a quieter variant of it.
  'Sk-04': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const hasEmptySlot = G.public.field[self.pid].some((c) => c === null);
        if (!hasEmptySlot) return;
        // Snapshotted as a plain array, not read live off G inside the
        // predicate: getOptions/resolve below may run later, from a SEPARATE
        // resolveChoice move dispatch, against a fresh Immer draft — a
        // predicate closing over this run()'s own G would be reading a
        // stale/revoked reference by then. A snapshot is safe because
        // nothing can mutate banishedFromField while this pendingChoice is
        // open (every move rejects outright while one is pending).
        const fieldOriginLabels = [...G.public.banishedFromField[self.pid]];
        const isFieldOrigin = (l: string) => fieldOriginLabels.includes(l);
        const matches = searchIndices(G, 'removed', self.pid, isFieldOrigin);
        if (matches.length === 0) return;
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-04',
          'a-search',
          'removed',
          self.pid,
          isFieldOrigin,
          'Purgatory Undone: choose which removed face-up card (removed from your field) to return to your field.',
          (G2, freshCtx, owner, realIndex) => {
            const label = removeFromOwnRemovedPile(G2, owner, realIndex);
            if (!label) return;
            dispatchPlacement(
              G2,
              freshCtx,
              self,
              'Sk-04',
              'a-place',
              owner,
              label,
              `Purgatory Undone: choose which empty field slot to return ${label} to.`
            );
          }
        );
      },
    },
  ],

  // Sk-06 TRANSFORMATION CHAMBER, effects a+b: ONE chained ability across
  // two printed clauses, not two independent effects — effect b explicitly
  // refers back to "the selected card" from effect a for both its cost
  // count and its delayed-summon target. "Play this card on the field" (the
  // start of effect a) is just Sk-06 itself being played, handled
  // generically by playCard — the ability's own content starts at "select
  // one Battle Card with BP 8 or lower from your deck."
  //
  // Mandatory throughout (no "may"/"can" anywhere in either clause). Effect
  // a's own search predicate pre-filters for cost-payability too, not just
  // BP<=8 and Battle type: a candidate is only offered if enough combined
  // hand+deck cards exist to pay its OWN BP as the effect-b cost (accounting
  // for the candidate itself still sitting in the deck at evaluation time,
  // so it can't pay for itself). This guarantees effect b's exact-count
  // multi-select can never fizzle for an unpayable candidate — the printed
  // text never describes what happens to a selected-but-unaffordable card,
  // so this pre-filter avoids inventing that edge case rather than resolving
  // it one way or another.
  //
  // Selection removes the card from the deck immediately — see
  // ScheduledSummon's doc comment in state.ts for where it lives from then
  // on — and the found label's own printed BP becomes the mandatory EXACT
  // count for a zone: 'handOrDeck' multi-select (effect b's "hand and/or
  // deck", freely mixed — see SearchZone). Only once that cost is actually
  // paid does the scheduled-summon entry get created, at
  // globalTurns + 2 — same "your next turn" arithmetic as Sk-12/Sk-13c's
  // "until the end of the opponent's next turn", just resolved from
  // turn.onBegin instead of turn.onEnd (see resolveScheduledSummons).
  'Sk-06': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const isEligible = (label: string): boolean => {
          const card = CARD_BY_LABEL[label];
          if (!card || card.type !== 'battle' || (card.bp ?? 0) > 8) return false;
          const bp = card.bp ?? 0;
          // -1: the candidate itself is still physically in the deck at
          // this evaluation point (search only scans, never mutates), so it
          // must not count toward its own cost pool.
          const availableForCost =
            G.secret.hands[self.pid].length + G.secret.decks[self.pid].length - 1;
          return availableForCost >= bp;
        };
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-06',
          'a-search',
          'deck',
          self.pid,
          isEligible,
          'Transformation Chamber: choose which Battle Card (BP 8 or lower) to select.',
          (G2, ctx2, owner, realIndex) => {
            const [selectedLabel] = G2.secret.decks[owner].splice(realIndex, 1);
            const selectedBp = CARD_BY_LABEL[selectedLabel]?.bp ?? 0;
            const selectedName = CARD_BY_LABEL[selectedLabel]?.name ?? selectedLabel;
            dispatchMultiSearch(
              G2,
              ctx2,
              self,
              'Sk-06',
              'b-cost',
              'handOrDeck',
              owner,
              () => true,
              selectedBp,
              true, // exact
              `Transformation Chamber: remove ${selectedBp} card(s) from your hand and/or deck to pay for ${selectedName}.`,
              (G3, owner3, labels) => {
                removeMultipleFromHandOrDeck(G3, owner3, labels);
                G3.secret.scheduledSummons[owner3].push({
                  label: selectedLabel,
                  summonAtGlobalTurn: G3.public.turnsTaken['0'] + G3.public.turnsTaken['1'] + 2,
                  sourceLabel: 'Sk-06',
                  sourceSlot: self.slot,
                });
              }
            );
          }
        );
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
  //   deck.length === 0 immediately after this draw. Now wired: dispatchMultiSearch
  //   expresses the exact-10 pick over zone: 'removed', and EngineCtx threads
  //   boardgame.io's random plugin all the way from resolveChoice into the
  //   apply closure below for the shuffle itself — see EngineCtx at the top
  //   of this file. CHOICE_READY pre-check shape (same as Sk-05/10/11/20a/24
  //   above): only opens the yesNo if the removed pile actually has 10 cards
  //   to offer — dispatchMultiSearch's own exact-count zero-target gate would
  //   catch this too, but checking up front avoids opening a yesNo whose
  //   "yes" branch could never be paid.
  // effect b ("If you draw this card normally, you may place it at the
  //   bottom of your deck...") — the complementary branch: deck still has
  //   cards after this draw. Wired below. No search involved — the target is
  //   always "the card that was just drawn" (self.slot, its hand index), so
  //   this is a plain yesNo confirm, same shape as Sk-25a. CAVEAT: "You
  //   cannot play other action cards this turn" is not modeled — no
  //   per-turn lock state exists for action-card plays.
  'Sk-07': [
    {
      slot: 'a',
      trigger: 'onDraw',
      auto: true,
      run: ({ G, ctx, self }) => {
        if (G.secret.decks[self.pid].length !== 0) return; // branch b applies instead
        if (G.public.banished[self.pid].length < 10) return;
        openChoice(G, ctx, self, 'Sk-07', 'a-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-07']['a-confirm']);
      },
    },
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

  // Sk-08 A SINISTER ALLIANCE. Both halves of effect a are now wired, plus
  // effect b unchanged.
  // effect a, first clause (the play-gate: at least one of the three allies
  //   already on your field to play Sk-08 at all) is enforced via
  //   PLAY_GATES/isPlayLegal, not here.
  // effect a, second clause ("From your deck, you may play one of the
  //   above-mentioned cards that is not already on your field.") — optional
  //   ("you may"). CHOICE_READY pre-check on BOTH halves (an eligible ally
  //   in the deck AND an empty own field slot) before opening the yesNo, for
  //   the same reason as Sk-04a above: the invariant holds for the whole
  //   chain since no other move can run while a pendingChoice is open, so
  //   it's safe for the search's apply step to pull the card out of the deck
  //   before the placement step confirms a slot — dispatchPlacement's own
  //   zero-slot fizzle is defense in depth, not the primary guard.
  // effect b: "If you have all three of the above-mentioned cards on your
  //   field, their BP each becomes 9." Fully fixed condition and targets, no
  //   player choice. NOT implemented: the "until end of your turn" reversion
  //   (no temporary-effect expiry existed when this was first wired, so it
  //   sets BP to 9 permanently) — unrelated to this pass, left as-is.
  'Sk-08': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const hasEmptySlot = G.public.field[self.pid].some((c) => c === null);
        if (!hasEmptySlot) return;
        const allies = ['BLAZING SKY GOBLIN', 'SAND SQUID', 'BATTLE SHOCK SCORPION'];
        const ownFieldAllyNames = new Set(
          G.public.field[self.pid]
            .filter((c): c is FieldCard => c !== null)
            .map((c) => CARD_BY_LABEL[c.label]?.name)
            .filter((n): n is string => n !== undefined)
        );
        const eligible = (l: string) => {
          const name = CARD_BY_LABEL[l]?.name;
          return !!name && allies.includes(name) && !ownFieldAllyNames.has(name);
        };
        if (!G.secret.decks[self.pid].some(eligible)) return;
        openChoice(G, ctx, self, 'Sk-08', 'a-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-08']['a-confirm']);
      },
    },
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
  // other Battle Cards" (a) — the "2+ Battle Cards" precondition is now
  // enforced via PLAY_GATES['Sk-11'] (playCard rejects the move outright),
  // so by the time this onSummon ability runs it's guaranteed to hold —
  // opens the target choice unconditionally, no internal fizzle needed;
  // "only applied if the selected card's BP is 9 or less" (b) — checked
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

  // Sk-15 SHADOW GHOST, effect a: "This card cannot be removed by Battle Card
  // effects." Same shape as Sk-16b below — an unconditional, self-targeted
  // permanent flag, reusing protectedFromBattleCardRemoval rather than a
  // second protection mechanism. RULING: NO CARD IS UNBANISHABLE — this
  // flag protects only against an ABILITY-DRIVEN removal (cause: 'ability'
  // in removeFieldCard — Sk-05/Sk-10/Sk-14 and similar "remove one Battle
  // Card" effects), never against losing an ordinary BP battle (cause:
  // 'battle'). The check lives inside removeFieldCard itself, not here.
  // Sk-15b (below, via REMOVAL_HOOKS) covers the battle-loss case
  // separately with its own "you may return it to hand instead" choice —
  // the two operate on disjoint causes and don't contradict each other.
  'Sk-15': [
    {
      slot: 'a',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, self }) => {
        const card = G.public.field[self.pid][self.slot];
        if (card) card.protectedFromBattleCardRemoval = true;
      },
    },
  ],

  // Sk-16 WAR DRAGON: "This card cannot be removed by Battle Cards." (effect
  // b only — a and unlike its neighbours, has no "may"/"can".) Unconditional,
  // self-targeted. Implemented as a permanent flag, checked inside
  // removeFieldCard and scoped to ability-driven removal only — per ruling,
  // no card is unbanishable in an ordinary BP battle, so this does not
  // protect War Dragon from losing one.
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

  // Sk-20 SAGE OF DARK OMEN. Both effects fire on the new onActivate
  // trigger (activateAbility move) — neither printed clause has a
  // summon/battle/removal qualifier, so both are usable at will, same
  // ruling as before for effect b.
  //
  // effect a ("While this is the only card on your side of the field, you
  //   may remove 3 cards from your hand to remove up to 2 BP 7 or BP 8
  //   Battle Cards from your deck.") — an EXACT-3 multi-select hand cost
  //   chaining into an UP-TO-2 multi-select deck removal, both via
  //   dispatchMultiSearch. CHOICE_READY pre-check shape (same as
  //   Sk-05/10/11/24 above): only opens the yesNo if the "only card on my
  //   field" precondition holds AND there are at least 3 hand cards to pay
  //   with — dispatchMultiSearch's own exact-count zero-target gate would
  //   catch the hand-size case too, but checking up front avoids opening a
  //   yesNo whose "yes" branch could never be paid.
  //
  // effect a is listed BEFORE effect b so its precondition is read at the
  // field state AS OF ACTIVATION, before b's unconditional self-removal
  // changes it. This is safe to run alongside b in the same onActivate
  // dispatch: b's own search (a NAMED lookup — "Arrival Of Doom" — against
  // a singleton 30-card deck) can only ever match 0 or 1 cards, so
  // dispatchSearch's "many matches, open a competing choice" branch is
  // provably unreachable for it — b can never clobber a's pendingChoice.
  // And a's own resolve chain only touches hand/deck, never self.slot's
  // field presence, so it's unaffected by b removing Sk-20 from the field
  // in the same dispatch.
  //
  // effect b ("Remove this card from the field and add 1 Arrival Of Doom
  //   from your deck to your hand.") — unconditional (no "may"): the
  //   field-removal always happens; the deck retrieval is independently
  //   zero-gated by dispatchSearch (no copy in deck -> silent fizzle, card
  //   is still removed).
  'Sk-20': [
    {
      slot: 'a',
      trigger: 'onActivate',
      auto: true,
      run: ({ G, ctx, self }) => {
        const onlyCardOnField = G.public.field[self.pid].filter((c) => c !== null).length === 1;
        if (!onlyCardOnField) return;
        if (G.secret.hands[self.pid].length < 3) return;
        openChoice(G, ctx, self, 'Sk-20', 'a-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-20']['a-confirm']);
      },
    },
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
          (G2, _ctx2, owner, realIndex) => moveDeckCardToHand(G2, owner, realIndex)
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
          (G2, freshCtx, owner, handIndex) => {
            const label = discardOwnHandCard(G2, owner, handIndex);
            const type = CARD_BY_LABEL[label]?.type;
            if (!type) return;
            dispatchSearch(
              G2,
              freshCtx,
              self,
              'Sk-23',
              'a-retrieve',
              'deck',
              owner,
              (deckLabel) => CARD_BY_LABEL[deckLabel]?.type === type,
              'Choose a card of the same type to add to your hand.',
              (G3, _ctx3, owner3, realIndex) => moveDeckCardToHand(G3, owner3, realIndex)
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

  // Sk-25 BATTLE SHOCK SCORPION.
  // effect a: "If this card removes a Battle Card, you can remove the top
  //   card from your opponent's deck." "You can" = optional — dispatch a
  //   yesNo confirm, but only if the opponent's deck actually has a top card
  //   to take; otherwise no prompt opens.
  // effect c: "If you play this card while Blazing Sky Goblin and Sand Squid
  //   are on your field, you can add one face-up removed Action Card to your
  //   hand." Same CHOICE_READY pre-check shape as effect a and Sk-24a: check
  //   the board condition AND that the removed pile actually holds a
  //   matching card before opening the yesNo. Separate onSummon trigger,
  //   doesn't interact with effect a's onBattleWin or effect b's
  //   REMOVAL_HOOKS entry at all.
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
    {
      slot: 'c',
      trigger: 'onSummon',
      auto: true,
      run: ({ G, ctx, self }) => {
        const field = G.public.field[self.pid];
        const hasAllies = field.some((c) => c && CARD_BY_LABEL[c.label]?.name === 'BLAZING SKY GOBLIN')
          && field.some((c) => c && CARD_BY_LABEL[c.label]?.name === 'SAND SQUID');
        if (!hasAllies) return;
        const matches = searchIndices(
          G,
          'removed',
          self.pid,
          (l) => CARD_BY_LABEL[l]?.type === 'action'
        );
        if (matches.length === 0) return;
        openChoice(G, ctx, self, 'Sk-25', 'c-confirm', CHOICE_ABILITIES_BY_LABEL['Sk-25']['c-confirm']);
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

  // Sk-26 ABDUCTION SAUCER, effect a: "Once per turn, you can select one
  // Battle Card on your opponent's field and place it under this card. When
  // this card is removed, remove all cards under this card." Optional ("you
  // can"), onActivate-triggered — see isRepeatableActivation for how "once
  // per turn" (not activateAbility's usual once-EVER) is enforced: the
  // self-imposed 'cannotUseEffects' lock below, expiring at the end of THIS
  // turn, is what actually caps it.
  //
  // CHOICE_READY pre-check: does the opponent have any Battle Card at all?
  // Deliberately NOT pre-filtered for protection (protectedFromBattleCardRemoval
  // / an active protectedFromRemoval effect) — same shape as Sk-05a, which
  // already offers every opposing Battle Card regardless and lets
  // removeFieldCard's own check silently block a protected one. "A card
  // protected from removal must not be silently stealable" is satisfied by
  // that SAME existing check, reused unchanged: the take routes through
  // removeFieldCard('ability') exactly like any other ability-driven
  // removal, so a protected card is never actually taken — the option can be
  // chosen, but nothing happens.
  //
  // "Place it under this card" only happens via afterRemoved, which
  // removeFieldCard only ever invokes once a removal has GENUINELY
  // completed — never on 'prevented', and (this is the important part) not
  // even on 'pending' unless the ORIGINAL target is what actually got
  // banished. A self-hook never intervenes here (Sk-15b/19a/25b are all
  // battle-only, and this is always cause: 'ability'), but a GUARDIAN can
  // (Sk-29a/30a place no cause restriction) — if the guardian substitutes
  // itself instead, afterRemoved still fires, but for the GUARDIAN's own
  // banished label, not the originally-targeted card's. Matching by label
  // (not by "a removal happened") is what makes this correct with no
  // guardian-specific special-casing: the label search below simply finds
  // nothing and does nothing when the original target was saved.
  'Sk-26': [
    {
      slot: 'a',
      trigger: 'onActivate',
      auto: true,
      run: ({ G, ctx, self }) => {
        const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
        G.public.activeEffects.push({
          kinds: ['cannotUseEffects'],
          targetPid: self.pid,
          targetSlot: self.slot,
          sourceLabel: 'Sk-26',
          sourcePid: self.pid,
          sourceSlot: self.slot,
          expiresAtGlobalTurn: globalTurns + 1,
        });

        const opp = self.pid === '0' ? '1' : '0';
        const options = G.public.field[opp]
          .map((c, i) => (c && CARD_BY_LABEL[c.label]?.type === 'battle' ? i : null))
          .filter((i): i is number => i !== null);
        if (options.length === 0) return;
        openChoice(G, ctx, self, 'Sk-26', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-26']['a-target']);
      },
    },
  ],

  // Sk-28 SKULLFACE. Effect a: "Remove all cards in your hand and place this
  // card in your opponent's deck." Unconditional, no target choice ("all"
  // cards, and the card relocates itself rather than a chosen target).
  // Implemented as: banish the whole hand face-up, pull Skullface off its
  // own field slot, insert it 5 cards deep into the opponent's deck, and
  // record the plant (see SkullfacePlant/checkSkullfacePlants) — globalTurns
  // captured here, BEFORE this turn's own onEnd increment, is the basis both
  // b (below, onDraw-triggered) and c (checkSkullfacePlants, a periodic
  // sweep) measure their five-turn window from.
  //
  // Effect b: "If they draw this card in their next five turns, remove the
  // top three cards from THEIR deck" — a plain onDraw entry, gated on the
  // plant still being active (skullfacePlant[self.pid] non-null); onDraw's
  // self.pid is the drawer, who can only ever be the TARGET here, since
  // Sk-28 is only ever inserted into an OPPONENT's deck, never one's own.
  //
  // Effect c ("...they must remove this card face down and YOU remove the
  // top three cards of YOUR deck") lives entirely in checkSkullfacePlants,
  // not here — it's a turn-count timeout with no draw involved, so onDraw
  // doesn't apply to it at all.
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
        G.secret.skullfacePlant[opp] = {
          plantedAtGlobalTurn: G.public.turnsTaken['0'] + G.public.turnsTaken['1'],
          plantedByPid: self.pid,
        };
      },
    },
    {
      slot: 'b',
      trigger: 'onDraw',
      auto: true,
      run: ({ G, self }) => {
        if (!G.secret.skullfacePlant[self.pid]) return;
        G.secret.skullfacePlant[self.pid] = null;
        removeDeckTopCards(G, self.pid, 3);
      },
    },
  ],
};

/** Removes up to `count` cards from the TOP of pid's own deck, face-up,
 *  banishing each — stops early if the deck runs out, the same graceful
 *  "as many as exist" handling every other top-of-deck primitive in this
 *  file already has. Used by Sk-28b ("remove the top three cards from
 *  THEIR deck" — the target's own) and Sk-28c ("YOU remove the top three
 *  cards of YOUR deck" — the planter's own) — the same primitive for both,
 *  since neither clause removes from an OPPONENT'S deck the way
 *  removeOpponentDeckTop does; `pid` here is just whichever player the
 *  printed text names for that clause. */
function removeDeckTopCards(G: ShadowkhanG, pid: string, count: number): void {
  const deck = G.secret.decks[pid];
  for (let i = 0; i < count && deck.length > 0; i++) {
    const label = deck.shift()!;
    G.public.banished[pid].push(label);
  }
}

/** Sk-28c's own periodic sweep — turn-count timeout, not a draw event, so it
 *  is checked once per turn boundary (turn.onEnd, matching
 *  expireTimedEffects's exact shape) rather than hooked into every
 *  individual deck mutation. Fires once globalTurns has reached the plant's
 *  own +10 window close (see SkullfacePlant's doc comment for the ×2-per-
 *  "their next turn" arithmetic) with Sk-28 still unresolved.
 *
 *  Guards on Sk-28 STILL being physically present in the target's deck
 *  before actually firing: several existing abilities can remove a card
 *  from a deck (by position or by name) without that counting as "drawn" —
 *  attackDeck, Sk-25a/Sk-14b's own "remove the top of your opponent's deck"
 *  rewards, a future named search — and if one of those happened to take
 *  Sk-28 out along the way, "they must remove this card face down" no
 *  longer has a card left to remove. The printed text never addresses that
 *  overlap; silently clearing the tracking without firing either payoff is
 *  the conservative reading for an interaction the card was never written
 *  for, not an invented penalty. */
export function checkSkullfacePlants(G: ShadowkhanG): void {
  const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
  for (const targetPid of Object.keys(G.secret.skullfacePlant)) {
    const plant = G.secret.skullfacePlant[targetPid];
    if (!plant) continue;
    if (globalTurns < plant.plantedAtGlobalTurn + 10) continue;

    G.secret.skullfacePlant[targetPid] = null;
    const deck = G.secret.decks[targetPid];
    const idx = deck.indexOf('Sk-28');
    if (idx === -1) continue;
    deck.splice(idx, 1);
    G.public.banishedFaceDown[targetPid]++;
    removeDeckTopCards(G, plant.plantedByPid, 3);
  }
  syncCounts(G);
}

/**
 * Keeps boardgame.io's ctx.activePlayers in sync with WHOEVER currently owns
 * G.public.pendingChoice — the one mechanism behind "a pendingChoice is
 * resolvable by its owner regardless of whose turn it is" (see
 * resolveChoice in game.ts, which no longer needs its own
 * pending.pid/ctx.currentPlayer comparison as the access gate).
 *
 * A pendingChoice's owner (`pid`) is not always ctx.currentPlayer: a
 * self-hook or guardian can open a choice for the DEFENDER while the
 * ATTACKER still holds the turn (Sk-15b/19a/25b/29a/30a — see their
 * eligible()/guards() checks, none of which require the acting player to be
 * the card's own owner). boardgame.io's own base access control only lets
 * ctx.currentPlayer submit a move unless ctx.activePlayers says otherwise,
 * so without this, the choice's owner could never answer it.
 *
 *  - a pendingChoice is open: grant its OWNER (and only its owner) active
 *    status via events.setActivePlayers({ value: { [pid]: Stage.NULL } }).
 *    Stage.NULL means "active, no stage restricting which moves they may
 *    submit" — not narrowed to a specific move subset. When pid IS
 *    ctx.currentPlayer (the ordinary case), this is a no-op in effect: the
 *    same single player who could already move is the only one still able
 *    to.
 *  - no pendingChoice: revert to boardgame.io's own default (only
 *    ctx.currentPlayer active) via events.setActivePlayers({ currentPlayer:
 *    Stage.NULL }), so a temporary off-turn grant never lingers once
 *    answered.
 *
 * Called from exactly two places: the end of openChoice (whenever a new
 * pendingChoice is set, or a would-be one fizzles) and the end of every
 * resolvePendingChoice/resolveMultiChoice exit that mutates pendingChoice
 * (resolved to null, cancelled, or chained into a new one via a nested
 * openChoice call — which already re-syncs for the new owner, making a
 * second call here idempotent). One mechanism, no per-card handling: no
 * hook or ability calls this directly.
 */
function syncActivePlayersToPendingChoice(G: ShadowkhanG, ctx: EngineCtx): void {
  const pending = G.public.pendingChoice;
  if (pending) {
    ctx.events.setActivePlayers({ value: { [pending.pid]: Stage.NULL } });
  } else {
    ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
  }
}

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
  ctx: EngineCtx,
  self: AbilitySelf,
  label: string,
  key: string,
  choice: ChoiceAbility,
  /** Present only for a multi-select choice (see dispatchMultiSearch below).
   *  Extends this same zero-target gate: for an EXACT count, fewer
   *  candidates than required is treated the same as zero candidates — a
   *  silent fizzle, since the requirement could never be satisfied. An "up
   *  to N" choice never has this problem — it opens with whatever's
   *  available, capped at N. */
  multi?: { count: number; exact: boolean }
): void {
  const options = choice.getOptions(G, ctx, self);
  if (options !== null && options.length === 0) {
    syncActivePlayersToPendingChoice(G, ctx);
    return;
  }
  if (multi?.exact && options !== null && options.length < multi.count) {
    syncActivePlayersToPendingChoice(G, ctx);
    return;
  }
  G.public.pendingChoice = {
    pid: self.pid,
    prompt: choice.prompt,
    kind: choice.kind,
    options,
    sourceLabel: label,
    sourceSlot: self.slot,
    abilitySlot: key,
    ...(multi ? { multi: { count: multi.count, exact: multi.exact, selected: [] } } : {}),
  };
  syncActivePlayersToPendingChoice(G, ctx);
}

// For a trigger-bound yesNo entry, decides whether it should open at all.
// A yesNo with no `leadsTo` target step is judged solely on its own terms
// (always fine to open — e.g. Sk-25's confirm, which is pre-checked by its
// caller before reaching here). A yesNo with `leadsTo` looks ahead at that
// target step's option set: if answering Yes would leave nothing to select,
// the yesNo itself must not open.
function willHaveLegalOutcome(
  G: ShadowkhanG,
  ctx: EngineCtx,
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
//
// GUARDIAN_HOOKS (below REMOVAL_HOOKS) is the sibling registry for the other
// shape: a card elsewhere on the field intervening in a DIFFERENT card's
// removal (Sk-29a Rarewolf, Sk-30a Shadow's Mistress). See removeFieldCard
// for how the two registries are consulted in order.
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
  afterRemoved?: (G: ShadowkhanG, ctx: EngineCtx) => void;
}

export type FieldRemovalResult =
  | 'removed' // completed synchronously this dispatch (normal banish, or no hook applied)
  | 'pending' // a hook opened a pendingChoice; finishing is deferred to its resolve()
  | 'prevented'; // protectedFromBattleCardRemoval blocked an ability-driven removal outright

export interface RemovalHook {
  slot: 'a' | 'b' | 'c' | 'd';
  /** Non-mutating pre-check: does this card's replacement even apply right
   *  now (matches the removal's cause, has any cost it needs, hasn't
   *  already used a one-time effect)? Mirrors the zero-target gate used
   *  everywhere else — a hook that can't apply must not open a prompt. */
  eligible: (G: ShadowkhanG, pid: string, card: FieldCard, cause: RemovalCause) => boolean;
  /** Opens the confirm prompt. Its resolve() owns finishing the removal on
   *  both branches: apply the replacement, or fall through to a normal
   *  removal via finishFieldRemoval — which now needs `cause` too (see
   *  ATTACHED_CARDS_ON_REMOVAL), so it's threaded through here even though
   *  every currently-wired RemovalHook only ever fires for cause ===
   *  'battle' (their own eligible() already guarantees that). */
  openPrompt: (
    G: ShadowkhanG,
    ctx: EngineCtx,
    pid: string,
    slot: number,
    cause: RemovalCause,
    opts: RemovalOpts | undefined
  ) => void;
}

const REMOVAL_HOOKS: Record<string, RemovalHook> = {
  // Sk-15 SHADOW GHOST, effect b: "While this card is on the field, if it
  // would be removed by battle, you may return it to your hand instead."
  // Repeatable (no "once"), battle-only. Coexists with effect a's
  // protectedFromBattleCardRemoval without contradiction: that flag is now
  // scoped (in removeFieldCard) to cause === 'ability' only, so a
  // 'battle'-cause removal always reaches this hook normally — a battle
  // loss is either replaced (return to hand) or, if declined, banished
  // like any other card.
  'Sk-15': {
    slot: 'b',
    eligible: (_G, _pid, _card, cause) => cause === 'battle',
    openPrompt: (G, ctx, pid, slot, cause, opts) => {
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
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, cause, opts);
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
    openPrompt: (G, ctx, pid, slot, cause, opts) => {
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
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, cause, opts);
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
    openPrompt: (G, ctx, pid, slot, cause, opts) => {
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
              (G3, _ctx3, owner, handIndex) => banishHandCardFaceDown(G3, owner, handIndex)
            );
            return;
          }
          finishFieldRemoval(G2, ctx2, self2.pid, self2.slot, cause, opts);
        },
      };
      openChoice(G, ctx, { pid, slot }, 'Sk-25', key, CHOICE_ABILITIES_BY_LABEL['Sk-25'][key]);
    },
  },
};

// ---------------------------------------------------------------------------
// Guardian removal hook. The sibling of REMOVAL_HOOKS above, for a card that
// intervenes in a DIFFERENT card's removal rather than its own: Sk-29a
// Rarewolf ("a Battle Card with BP 4 or less on your field were to be
// removed, you can remove this card... instead") and Sk-30a Shadow's
// Mistress ("a Shadow Ghost on your field were to be removed, you can add it
// to your deck instead and remove one card face down from your hand").
// Still keyed by label — the GUARDIAN's own label, not the removed card's —
// but reached by scanning the OTHER slots on pid's own field for a matching
// guardian, since which card the guardian protects isn't fixed to any one
// label the way REMOVAL_HOOKS's "this card protects itself" shape is.
// ---------------------------------------------------------------------------

export interface GuardianHook {
  slot: 'a' | 'b' | 'c' | 'd';
  /** Non-mutating pre-check, mirroring RemovalHook.eligible's zero-target
   *  gate: does the card at guardianSlot (never the slot being removed —
   *  removeFieldCard's scan skips that slot entirely, so a guardian can
   *  never be asked to protect itself) protect `removedCard` right now?
   *  Any cost the guardian would need to pay (e.g. Sk-30a's hand discard)
   *  must be checked here too, so an unpayable guardian never offers its
   *  prompt at all. */
  guards: (
    G: ShadowkhanG,
    pid: string,
    guardianSlot: number,
    removedCard: FieldCard,
    cause: RemovalCause
  ) => boolean;
  /** Opens the confirm prompt. Its resolve() owns finishing on both
   *  branches, exactly like RemovalHook.openPrompt: apply the guardian's
   *  substitution/redirect, or fall through to the ORIGINAL removal via
   *  finishFieldRemoval(G, ctx, pid, removedSlot, cause, opts) — never a
   *  recursive call back into removeFieldCard, for the same no-infinite-loop
   *  reason RemovalHook's resolve()s call finishFieldRemoval directly.
   *  Unlike RemovalHook, guards() is never cause-restricted, so `cause` here
   *  can genuinely be either value — threaded through so finalizeFieldRemoval
   *  (via ATTACHED_CARDS_ON_REMOVAL) sees the real one, not an assumption. */
  openPrompt: (
    G: ShadowkhanG,
    ctx: EngineCtx,
    pid: string,
    guardianSlot: number,
    removedSlot: number,
    cause: RemovalCause,
    opts: RemovalOpts | undefined
  ) => void;
}

const GUARDIAN_HOOKS: Record<string, GuardianHook> = {
  // Sk-29 RAREWOLF: "If a Battle Card with a BP of 4 or less on your field
  // were to be removed, you can remove this card on the field instead." No
  // "by battle" qualifier in the printed text (unlike Sk-15b/19a/25b above),
  // so this applies to both removal causes. No cost. Accepting substitutes
  // Rarewolf itself for the original target — a removal still genuinely
  // happens, just redirected to a different slot, so it reuses the ORIGINAL
  // opts (fireOnRemoved/afterRemoved) exactly as declining would. currentBp
  // is checked (not printed bp), matching how live BP-threshold checks work
  // elsewhere (e.g. eligibleOwnBattleCardsAtOrBelow).
  'Sk-29': {
    slot: 'a',
    guards: (_G, _pid, _guardianSlot, removedCard, _cause) =>
      CARD_BY_LABEL[effectiveLabel(removedCard)]?.type === 'battle' && removedCard.currentBp <= 4,
    openPrompt: (G, ctx, pid, guardianSlot, removedSlot, cause, opts) => {
      const key = 'guard-confirm';
      (CHOICE_ABILITIES_BY_LABEL['Sk-29'] ??= {})[key] = {
        needsChoice: true,
        prompt: 'Rarewolf can be removed instead to save the targeted card — remove Rarewolf on the field instead?',
        kind: 'yesNo',
        getOptions: () => null,
        resolve: (G2, ctx2, _self2, answer2) => {
          if (answer2 === true) {
            finishFieldRemoval(G2, ctx2, pid, guardianSlot, cause, opts);
            return;
          }
          finishFieldRemoval(G2, ctx2, pid, removedSlot, cause, opts);
        },
      };
      openChoice(G, ctx, { pid, slot: guardianSlot }, 'Sk-29', key, CHOICE_ABILITIES_BY_LABEL['Sk-29'][key]);
    },
  },

  // Sk-30 SHADOW'S MISTRESS: "If a Shadow Ghost on your field were to be
  // removed, you can add it to your deck instead and remove one card face
  // down from your hand." Named-card guard (not BP-based), no "by battle"
  // qualifier either. Unlike Sk-29a, Shadow's Mistress does NOT sacrifice
  // itself — the GUARDED card is redirected to the deck instead of being
  // banished, so accepting is a prevent/redirect (no removal actually
  // completes for either card): no finishFieldRemoval call, no afterRemoved,
  // mirroring Sk-15b's own accept branch (return to hand) directly above.
  // The hand cost is checked in `guards` itself — a guardian that can't pay
  // must not offer the choice at all — then paid via the same dispatchSearch
  // + banishHandCardFaceDown shape Sk-25b's cost payment already uses, just
  // without Sk-25b's Action-Card-only restriction (this card's text has no
  // type restriction: "one card", not "one Action Card").
  'Sk-30': {
    slot: 'a',
    guards: (G, pid, _guardianSlot, removedCard, _cause) =>
      CARD_BY_LABEL[effectiveLabel(removedCard)]?.name === 'SHADOW GHOST' && G.secret.hands[pid].length > 0,
    openPrompt: (G, ctx, pid, guardianSlot, removedSlot, cause, opts) => {
      const key = 'guard-confirm';
      (CHOICE_ABILITIES_BY_LABEL['Sk-30'] ??= {})[key] = {
        needsChoice: true,
        prompt: "Shadow's Mistress can save your Shadow Ghost — add it to your deck instead, paying one face-down card from your hand?",
        kind: 'yesNo',
        getOptions: () => null,
        resolve: (G2, ctx2, _self2, answer2) => {
          if (answer2 !== true) {
            finishFieldRemoval(G2, ctx2, pid, removedSlot, cause, opts);
            return;
          }
          // Defensive re-check: `guards` already gates on hand.length > 0
          // before this prompt can even open, so this should never trigger.
          if (G2.secret.hands[pid].length === 0) {
            finishFieldRemoval(G2, ctx2, pid, removedSlot, cause, opts);
            return;
          }
          const removedCard = G2.public.field[pid][removedSlot];
          if (!removedCard) return;
          G2.public.field[pid][removedSlot] = null;
          G2.secret.decks[pid].push(removedCard.label);
          dispatchSearch(
            G2,
            ctx2,
            { pid, slot: guardianSlot },
            'Sk-30',
            'guard-cost',
            'hand',
            pid,
            () => true,
            'Choose which card to remove face down from your hand.',
            (G3, _ctx3, owner, handIndex) => banishHandCardFaceDown(G3, owner, handIndex)
          );
        },
      };
      openChoice(G, ctx, { pid, slot: guardianSlot }, 'Sk-30', key, CHOICE_ABILITIES_BY_LABEL['Sk-30'][key]);
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

/** Applies a 'bpModifier' effect's BP correction to its target, if it has
 *  one, when the effect is about to be pruned — whether by reaching its
 *  stated duration or by its source/target leaving the field early. A
 *  no-op for non-BP effects (no onExpire) and for a target that's already
 *  gone (nothing left to correct — the field-removal path that triggered
 *  this already nulled the slot before pruning). */
function applyExpiryCorrection(G: ShadowkhanG, effect: ActiveEffect): void {
  if (!effect.onExpire) return;
  const card = G.public.field[effect.targetPid][effect.targetSlot];
  if (!card) return;
  if (effect.onExpire.kind === 'revertDelta') {
    modifyBp(card, -effect.onExpire.bpDelta);
  } else {
    const original = CARD_BY_LABEL[card.label]?.bp ?? card.currentBp;
    modifyBp(card, original - card.currentBp);
  }
}

/** Prunes any active effect sourced from, OR targeting, pid/slot — called
 *  whenever a card leaves that field slot. Covers both directions: a
 *  removed SOURCE's aura must not linger (Gargoyle leaving the field), and
 *  a removed TARGET's effect entry must not go stale and silently apply to
 *  whatever card is later played into that same slot. Applies each pruned
 *  effect's BP correction first (e.g. if a Mystical Blue Flame buff's
 *  source is removed early, the +1 it applied must not be stuck forever). */
function expireEffectsForSlot(G: ShadowkhanG, pid: string, slot: number): void {
  const remaining: ActiveEffect[] = [];
  for (const effect of G.public.activeEffects) {
    const matches =
      (effect.sourcePid === pid && effect.sourceSlot === slot) ||
      (effect.targetPid === pid && effect.targetSlot === slot);
    if (matches) {
      applyExpiryCorrection(G, effect);
    } else {
      remaining.push(effect);
    }
  }
  G.public.activeEffects = remaining;
}

/** Prunes any active effect whose turn-based duration has elapsed, applying
 *  its BP correction (if any) first. Called once from turn.onEnd, after
 *  turnsTaken has been incremented for the player whose turn just ended. */
export function expireTimedEffects(G: ShadowkhanG): void {
  const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
  const remaining: ActiveEffect[] = [];
  for (const effect of G.public.activeEffects) {
    if (effect.expiresAtGlobalTurn !== undefined && effect.expiresAtGlobalTurn <= globalTurns) {
      applyExpiryCorrection(G, effect);
    } else {
      remaining.push(effect);
    }
  }
  G.public.activeEffects = remaining;
}

/** Drops any of pid's scheduled summons sourced from `slot` — called
 *  whenever a card leaves that field slot, the same way expireEffectsForSlot
 *  prunes stale ActiveEffects. RULE (Sk-06's printed text never addresses
 *  this): if the card that scheduled a summon (Transformation Chamber
 *  itself) is removed from the field before the scheduled turn arrives, the
 *  scheduled card is lost — no refund to deck/hand. It was already spent
 *  (removed from the deck, cost already paid) at selection time; "the
 *  chamber" no longer exists to complete the transformation. Silent: this is
 *  a side effect of removal, not its own player-facing event. */
function expireScheduledSummonsForSlot(G: ShadowkhanG, pid: string, slot: number): void {
  G.secret.scheduledSummons[pid] = G.secret.scheduledSummons[pid].filter(
    (entry) => entry.sourceSlot !== slot
  );
}

/**
 * Sk-26b: "If this card is removed by a card effect, return as many of your
 * opponent's cards to their field as possible, with the rest going back to
 * the deck." A MORE SPECIFIC override of Sk-26a's own generic "when this
 * card is removed, remove all cards under this card" — applies only for
 * cause === 'ability' ("card effect"); a battle-loss removal falls through
 * to the generic banish in finalizeFieldRemoval instead (see
 * ATTACHED_CARDS_ON_REMOVAL).
 *
 * Processes `labels` (the cards that were held) one at a time: while the
 * opponent's field has an empty slot, places the next one via
 * placeCardOnField directly (single slot) or a real 'emptyOwnFieldSlot'
 * choice (2+ slots, exactly what dispatchPlacement itself would open) —
 * either way the card fires onSummon like any other placement. Once no
 * empty slot remains, every remaining label goes to the BOTTOM of the
 * opponent's deck instead (the printed text names no position; this matches
 * Sk-07b's own "place it at the bottom of your deck" as the closest existing
 * convention in this ruleset rather than inventing a new one). Recurses into
 * the rest of the list from inside a multi-slot choice's own resolve — the
 * same chained-choice shape already used elsewhere (e.g. Sk-03b's
 * search-then-placement chain), not a new pattern. The choice belongs to
 * `opp` (their own field, their own decision which empty slot) — sourceSlot
 * -1 is the existing "no field-resident source" sentinel already used by
 * resolvePendingChoice's own self reconstruction.
 */
function returnHeldCardsToOpponent(
  G: ShadowkhanG,
  ctx: EngineCtx,
  opp: string,
  labels: string[]
): void {
  if (labels.length === 0) return;
  const [label, ...rest] = labels;

  const emptySlots = (G2: ShadowkhanG) =>
    G2.public.field[opp].map((c, i) => (c === null ? i : null)).filter((i): i is number => i !== null);

  const slots = emptySlots(G);
  if (slots.length === 0) {
    G.secret.decks[opp].push(label); // bottom of the deck
    returnHeldCardsToOpponent(G, ctx, opp, rest);
    return;
  }
  if (slots.length === 1) {
    placeCardOnField(G, ctx, opp, slots[0], label);
    returnHeldCardsToOpponent(G, ctx, opp, rest);
    return;
  }

  const key = `b-return-${label}`;
  const placementChoice: ChoiceAbility = {
    needsChoice: true,
    prompt: `Abduction Saucer: choose which empty field slot to return ${label} to.`,
    kind: 'emptyOwnFieldSlot',
    getOptions: (G2) => emptySlots(G2),
    resolve: (G2, ctx2, _self2, answer) => {
      if (typeof answer !== 'number') return;
      if (!emptySlots(G2).includes(answer)) return;
      placeCardOnField(G2, ctx2, opp, answer, label);
      returnHeldCardsToOpponent(G2, ctx2, opp, rest);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL['Sk-26'] ??= {})[key] = placementChoice;
  openChoice(G, ctx, { pid: opp, slot: -1 }, 'Sk-26', key, placementChoice);
}

/** Card-specific handling for what happens to a REMOVED card's own attached
 *  cards, keyed by the HOST's label — consulted inside finalizeFieldRemoval
 *  BEFORE its default (banish them all face-up) applies. Returns true if it
 *  fully handled the attached cards itself (skip the default banish); false
 *  to fall through to it. Currently just Sk-26 — see
 *  returnHeldCardsToOpponent's own doc comment for the two-tier reading
 *  (effect a's generic "remove" vs effect b's more specific "return"). */
const ATTACHED_CARDS_ON_REMOVAL: Record<
  string,
  (G: ShadowkhanG, ctx: EngineCtx, pid: string, cause: RemovalCause, attachedLabels: string[]) => boolean
> = {
  'Sk-26': (G, ctx, pid, cause, attachedLabels) => {
    if (cause !== 'ability') return false; // battle loss: fall through to the default banish
    const opp = pid === '0' ? '1' : '0';
    returnHeldCardsToOpponent(G, ctx, opp, attachedLabels);
    return true;
  },
};

/** Mechanical "make it gone": banishes the card at pid/slot. No hook check,
 *  no trigger — the low-level primitive both finishFieldRemoval and a
 *  declined replacement's own resolve() share. The sole choke point for
 *  every field removal, so it's also the single place that tags a label as
 *  field-origin in banishedFromField (see its doc comment in state.ts) —
 *  every other path into `banished` (hand/deck removal) leaves it untagged.
 *
 *  Any cards attached to this one (see FieldCard.attached / ATTACH_TARGETS)
 *  are handled next: ATTACHED_CARDS_ON_REMOVAL[card.label], if the removed
 *  card has an entry there, decides what happens to them (Sk-26b's
 *  "return" — see returnHeldCardsToOpponent). Absent an entry, or if the
 *  entry declines to handle it (Sk-26's own battle-cause case), the default
 *  applies: banished face-up alongside the host, and tagged field-origin
 *  too, same as the host — the printed text generally never says what
 *  becomes of an attach-target card once its host is gone, but "used on" /
 *  "place it under this card" language implies it was consumed as an
 *  enhancement, not left to persist independently (nothing else in this
 *  engine has a card outlive the field slot it depends on). */
function finalizeFieldRemoval(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  slot: number,
  cause: RemovalCause,
  /** true for Sk-18b's own removal (see removeFieldCardFaceDown) — banishes
   *  face-down (count-only, no label revealed) instead of face-up, and skips
   *  ATTACHED_CARDS_ON_REMOVAL (a face-down self-correction isn't the kind
   *  of "removed by a card effect" Sk-26b's override text describes; no
   *  currently-wireable card can have both an attach-target and a copied
   *  identity anyway, but this keeps the branch honest either way). */
  faceDown = false
): void {
  const card = G.public.field[pid][slot];
  if (!card) return;
  if (faceDown) {
    G.public.banishedFaceDown[pid]++;
  } else {
    G.public.banished[pid].push(card.label);
    G.public.banishedFromField[pid].push(card.label);
  }

  const attachedLabels = card.attached;
  const handled = !faceDown && (ATTACHED_CARDS_ON_REMOVAL[card.label]?.(G, ctx, pid, cause, attachedLabels) ?? false);
  if (!handled) {
    for (const attachedLabel of attachedLabels) {
      if (faceDown) {
        G.public.banishedFaceDown[pid]++;
      } else {
        G.public.banished[pid].push(attachedLabel);
        G.public.banishedFromField[pid].push(attachedLabel);
      }
    }
  }

  G.public.field[pid][slot] = null;
  expireEffectsForSlot(G, pid, slot);
  expireScheduledSummonsForSlot(G, pid, slot);
}

/** Sk-18b: "If the selected removed card is no longer removed, remove this
 *  card face-down." The removal itself: unconditional, bypasses
 *  REMOVAL_HOOKS/GUARDIAN_HOOKS entirely — same precedent as
 *  banishHandCardFaceDown/removeOwnDeckTopFaceDown, which also skip the
 *  hook pipeline for a face-down removal. This isn't a battle loss or an
 *  opposing card's effect targeting Sk-18 (neither RemovalCause value
 *  describes "the thing I copied stopped being in the removed pile"); it's
 *  a self-correcting state-integrity rule, so it isn't something Sk-18's own
 *  (or a copied) removal-replacement/protection should be able to answer. */
function removeFieldCardFaceDown(G: ShadowkhanG, ctx: EngineCtx, pid: string, slot: number): void {
  finalizeFieldRemoval(G, ctx, pid, slot, 'ability', true);
}

/** Sk-18b's own condition check, run once per turn boundary (turn.onEnd —
 *  see expireTimedEffects, the same periodic-sweep shape) rather than
 *  hooked into every individual place a label can leave a removed pile.
 *  That set is not one choke point: removeFromOwnRemovedPile,
 *  removeMultipleFromOwnRemovedPile, AND Sk-26a's own direct splice (moving
 *  a just-banished card into `attached`) all mutate G.public.banished
 *  independently, and hooking all three (plus any future one) would be
 *  exactly the per-case special-casing this codebase avoids elsewhere. The
 *  printed text states a condition to check, not an event to react to
 *  instantly, so a once-per-turn sweep is faithful to the text and far more
 *  robust. Scans BOTH players every call, not just ctx.currentPlayer's own
 *  side: Sk-26a can redirect a card out of ITS TARGET's removed pile, which
 *  may belong to either player relative to whoever's turn is ending. */
export function checkCopyIdentityIntegrity(G: ShadowkhanG, ctx: EngineCtx): void {
  for (const pid of Object.keys(G.public.field)) {
    const field = G.public.field[pid];
    for (let slot = 0; slot < field.length; slot++) {
      const card = field[slot];
      if (card?.copiedIdentity && !G.public.banished[pid].includes(card.copiedIdentity)) {
        removeFieldCardFaceDown(G, ctx, pid, slot);
      }
    }
  }
}

/** Fires onRemoved (if requested, while the card is still field-resident),
 *  banishes it, then runs afterRemoved (if requested) — the exact sequence
 *  attackBattleCard has always used. Shared by removeFieldCard's
 *  synchronous path and every hook's "declined" resolve() branch. */
function finishFieldRemoval(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  slot: number,
  cause: RemovalCause,
  opts: RemovalOpts | undefined
): void {
  if (opts?.fireOnRemoved) fireTrigger(G, ctx, 'onRemoved', { pid, slot });
  finalizeFieldRemoval(G, ctx, pid, slot, cause);
  opts?.afterRemoved?.(G, ctx);
}

/**
 * The single choke point for removing a card from a field slot. Checks, in
 * order, BEFORE any state change:
 *  1. protectedFromBattleCardRemoval (Sk-15a, Sk-16b — "cannot be removed
 *     by Battle Card[s]/effects") OR an active 'protectedFromRemoval' effect
 *     (Sk-09b — same wording shape, "cannot be removed by Battle Cards or
 *     card effects", just with a stated duration instead of lasting
 *     forever). RULING: no card is unbanishable in an ordinary BP battle —
 *     both protect ONLY against an ability-driven removal (cause ===
 *     'ability'; the Sk-05/Sk-10/Sk-14 style of "remove one Battle Card"
 *     effect), never a battle loss (cause === 'battle', which
 *     attackBattleCard always passes and never gates on either mechanism
 *     itself — see game.ts). If either applies, the removal is blocked
 *     outright and this returns 'prevented'.
 *  2. REMOVAL_HOOKS for the card being removed (a SELF-hook):
 *     - no hook, or the hook doesn't apply right now (eligible() is false):
 *       falls through to step 3.
 *     - hook applies: opens its confirm prompt and returns 'pending' —
 *       nothing about this removal has happened yet. Callers must not run
 *       any "this removal completed" logic in this dispatch when they see
 *       'pending' — see RemovalOpts.afterRemoved, which the hook's own
 *       resolve() invokes instead, once the outcome is known.
 *  3. GUARDIAN_HOOKS: scans pid's OTHER field slots (never the slot being
 *     removed) for a card whose guardian hook applies to this removal.
 *     ORDERING: a self-hook always wins over a guardian when both could
 *     apply — this step is only reached if step 2 found no eligible
 *     self-hook. This is deliberate, not incidental: a card's own printed
 *     defense should get first refusal before a DIFFERENT card's
 *     substitution kicks in, and it keeps the three existing self-hooks
 *     (Sk-15b, Sk-19a, Sk-25b) running through the exact same path with
 *     zero behavior change — the guardian scan is purely an additional
 *     fallback, never consulted when a self-hook already handled it. The
 *     only current overlap in the card set is Sk-15 (self-hook) guarded by
 *     Sk-30 (guardian) — Sk-15b is offered, Sk-30a never runs for that
 *     removal. If exactly one guardian slot matches, its hook applies the
 *     same way a self-hook would; slots are scanned in field order (0, 1,
 *     2) for a deterministic pick if more than one guardian ever qualifies
 *     simultaneously (not reachable with the current card set).
 * No infinite loops: REMOVAL_HOOKS is keyed by the REMOVED card's own
 * label, and none of the wired self-hooks' replacements themselves cause
 * another field removal — Sk-15b/19a keep the card in play, Sk-25b's cost
 * is a hand discard (a different zone, never routed back through this
 * function). GUARDIAN_HOOKS is the same: the scan explicitly excludes the
 * slot being removed (a guardian can never protect itself), and a
 * guardian's own resolve() calls finishFieldRemoval directly — never a
 * recursive removeFieldCard call — so a guardian substituting itself (Sk-29a)
 * can't re-trigger the hook/guardian pipeline for its own removal.
 */
export function removeFieldCard(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  slot: number,
  cause: RemovalCause,
  opts?: RemovalOpts
): FieldRemovalResult {
  const card = G.public.field[pid][slot];
  if (!card) return 'removed';

  if (
    cause === 'ability' &&
    (card.protectedFromBattleCardRemoval || hasActiveEffect(G, pid, slot, 'protectedFromRemoval'))
  ) {
    return 'prevented';
  }

  const hook = REMOVAL_HOOKS[effectiveLabel(card)];
  if (hook && hook.eligible(G, pid, card, cause)) {
    hook.openPrompt(G, ctx, pid, slot, cause, opts);
    return 'pending';
  }

  const field = G.public.field[pid];
  for (let guardianSlot = 0; guardianSlot < field.length; guardianSlot++) {
    if (guardianSlot === slot) continue;
    const guardianCard = field[guardianSlot];
    if (!guardianCard) continue;
    const guardianHook = GUARDIAN_HOOKS[effectiveLabel(guardianCard)];
    if (guardianHook && guardianHook.guards(G, pid, guardianSlot, card, cause)) {
      guardianHook.openPrompt(G, ctx, pid, guardianSlot, slot, cause, opts);
      return 'pending';
    }
  }

  finishFieldRemoval(G, ctx, pid, slot, cause, opts);
  return 'removed';
}

/**
 * The ordinary BP-comparison combat resolution attackBattleCard has always
 * run — factored out here (rather than left inline in game.ts) so Sk-21a's
 * gambit (below) can re-invoke the SAME normal-combat logic once its own
 * shuffle-guess resolves, without duplicating it. Exported for game.ts's
 * attackBattleCard move to call directly for every OTHER attacker.
 *
 * Safe to call even if the original attacker or defender is already gone
 * (e.g. a correct Sk-21a guess just removed the defender, along with the
 * rest of the opponent's field) — it simply no-ops, since there is no
 * meaningful "attack" left to resolve.
 */
export function resolveBattleOutcome(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  mySlot: number,
  opp: string,
  theirSlot: number
): void {
  const attacker = G.public.field[pid][mySlot];
  const defender = G.public.field[opp][theirSlot];
  if (!attacker || !defender) return;

  if (attacker.currentBp > defender.currentBp) {
    removeFieldCard(G, ctx, opp, theirSlot, 'battle', {
      fireOnRemoved: true,
      afterRemoved: (G2, ctx2) => fireTrigger(G2, ctx2, 'onBattleWin', { pid, slot: mySlot }),
    });
  } else if (attacker.currentBp < defender.currentBp) {
    if (G.public.rulesOfEngagementActive) {
      // RULES OF ENGAGEMENT (Sk-01): attacking a higher-BP card reduces the
      // defender's BP by the attacker's BP instead of removing the
      // attacker; the defender is only removed once its BP hits zero.
      modifyBp(defender, -attacker.currentBp);
      if (defender.currentBp <= 0) {
        removeFieldCard(G, ctx, opp, theirSlot, 'battle', { fireOnRemoved: true });
      }
    } else {
      removeFieldCard(G, ctx, pid, mySlot, 'battle', { fireOnRemoved: true });
    }
  } else {
    // Shockwave: both lose top deck card face-down
    removeOwnDeckTopFaceDown(G, pid);
    removeOwnDeckTopFaceDown(G, opp);
    syncCounts(G);
  }
}

/** Recursively removes each of `remainingSlots` from opp's field, ability-
 *  caused, routing every single one through removeFieldCard so protection,
 *  self-hooks and guardians all get their normal say — no bulk-removal
 *  shortcut that would bypass them. Continues to the next slot once the
 *  current one's fate is fully settled: immediately for a synchronous
 *  'removed' (via afterRemoved, which finishFieldRemoval always invokes
 *  before returning) or 'prevented' result, or — for a 'pending' result — only
 *  if the hook/guardian's OWN choice ends with the card actually being
 *  removed (afterRemoved fires from THAT resolution too, since hooks/
 *  guardians preserve `opts` through their decline branch). If a card's own
 *  replacement hook is instead ACCEPTED (it stays on the field, e.g. The
 *  Headless Horseman "remain instead"), afterRemoved never fires for it by
 *  design (RemovalOpts.afterRemoved's own contract: "never on prevent/
 *  redirect") — so this sweep deliberately STOPS at that card rather than
 *  skipping past it to remove the rest. Sk-21a's text never addresses a
 *  targeted card that explicitly declines its own removal via a printed
 *  replacement effect; stopping there is the more conservative reading,
 *  since it doesn't silently bypass that card's own stated protection just
 *  to keep the sweep going. `whenDone` fires once the whole sweep has
 *  settled (empty list, including immediately if `remainingSlots` starts
 *  empty) — carries Sk-21a's own continuation into normal combat resolution. */
function removeAllAbilityTargets(
  G: ShadowkhanG,
  ctx: EngineCtx,
  opp: string,
  remainingSlots: number[],
  whenDone: (G: ShadowkhanG, ctx: EngineCtx) => void
): void {
  if (remainingSlots.length === 0) {
    whenDone(G, ctx);
    return;
  }
  const [slot, ...rest] = remainingSlots;
  const card = G.public.field[opp][slot];
  if (!card) {
    removeAllAbilityTargets(G, ctx, opp, rest, whenDone);
    return;
  }
  const result = removeFieldCard(G, ctx, opp, slot, 'ability', {
    afterRemoved: (G2, ctx2) => removeAllAbilityTargets(G2, ctx2, opp, rest, whenDone),
  });
  if (result === 'prevented') {
    removeAllAbilityTargets(G, ctx, opp, rest, whenDone);
  }
  // 'pending': see doc comment — continuation depends on the hook/guardian's
  // own outcome, not decided here.
}

/**
 * Sk-21 SAND SQUID, effect a: "When this card battles, you may select all
 * Battle Cards on your opponent's field and shuffle them face-down. Flip the
 * top card face-up, and if you call it correctly, remove all cards on your
 * opponent's field." Effect b: "If your guess is incorrect, decrease this
 * card's BP by 2."
 *
 * Hooked directly into attackBattleCard (as the ATTACKER only — "your
 * opponent's field" reads from the attacking player's own perspective, and
 * nothing in the text describes a defensive/being-attacked version) rather
 * than through fireTrigger's generic dispatch: this is the only ability in
 * the card set that needs to PAUSE the shared combat resolution itself
 * (not just react before/after it), and fireTrigger's AbilitySelf carries no
 * way to thread `opp`/`theirSlot` through a later, separate resolveChoice
 * dispatch — so this is called directly from game.ts's attackBattleCard,
 * closing over pid/mySlot/opp/theirSlot as plain primitives (safe to close
 * over across a later, separate move dispatch — unlike G/ctx, which are
 * never captured here for that reason).
 *
 * "Shuffle them face-down" is implemented as a single hidden random draw
 * (ctx.random.Shuffle(candidateLabels)[0]) rather than a persisted, fully
 * shuffled array: "shuffle N cards and flip the top one" and "draw 1 of N
 * uniformly at random" are the same distribution, so this is an
 * implementation simplification, not an approximation of the rules outcome.
 * The field's own real card identities are never actually hidden from
 * G.public.field during this — nothing else in this engine has a concept of
 * an "unknown" field card, and inventing one wasn't needed for the same
 * observable behavior: the specific draw stays unknown to BOTH players
 * (matching this codebase's other face-down precedent — banishedFaceDown
 * never records a label for anyone either) until it's compared against the
 * guess, which is the only part of "face-down" that actually matters
 * mechanically. The guess's own pendingChoice therefore offers real,
 * already-public field slots as its options (kind: 'opponentField', the
 * existing shape) — nothing new is leaked, since the guesser already knew
 * the candidate set beforehand (the field is always public); only the
 * SPECIFIC draw is hidden, and that never appears in pendingChoice at all.
 *
 * The hidden draw lives in G.secret.pendingFlip, keyed by the guesser's own
 * pid — the one field in this codebase playerView never exposes to ANY
 * playerID, not even its own owner (see SecretState.pendingFlip and
 * playerView in game.ts), because the guesser specifically must not see
 * their own outcome before committing a guess.
 *
 * The flipped card's identity is never separately exposed as its own piece
 * of revealed state on a WRONG guess — only the ability's actual outcome is
 * public (a removal on success, Sk-21's own BP-2 on failure), both already
 * visible through ordinary G.public state. No rule depends on either player
 * knowing specifically which card was drawn once the guess is known to be
 * wrong, so this deliberately doesn't invent a new "reveal without removing"
 * concept for it.
 *
 * Returns true if the gambit was offered (a pendingChoice is now open —
 * caller must not also run normal combat resolution this dispatch) or false
 * if there was nothing to offer (attacker isn't Sk-21, or the opponent's
 * field has no Battle Cards — the zero-target gate), so the caller should
 * proceed straight to resolveBattleOutcome instead. Normal combat resolution
 * is always attempted again at the very end of every branch (decline,
 * correct guess, wrong guess) via resolveBattleOutcome — safe even when the
 * original defender is already gone.
 */
export function offerSk21Gambit(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pid: string,
  mySlot: number,
  opp: string,
  theirSlot: number
): boolean {
  const attacker = G.public.field[pid][mySlot];
  if (!attacker || effectiveLabel(attacker) !== 'Sk-21') return false;

  const candidateSlots = (G2: ShadowkhanG): number[] =>
    G2.public.field[opp]
      .map((c, i) => (c && CARD_BY_LABEL[effectiveLabel(c)]?.type === 'battle' ? i : null))
      .filter((i): i is number => i !== null);

  if (candidateSlots(G).length === 0) return false;

  const confirmKey = 'a-confirm';
  const confirmChoice: ChoiceAbility = {
    needsChoice: true,
    prompt: "Sand Squid: shuffle all of your opponent's Battle Cards face-down and call the top card?",
    kind: 'yesNo',
    getOptions: () => null,
    resolve: (G2, ctx2, _self2, answer) => {
      const candidates = answer === true ? candidateSlots(G2) : [];
      if (answer !== true || candidates.length === 0) {
        resolveBattleOutcome(G2, ctx2, pid, mySlot, opp, theirSlot);
        return;
      }

      const labels = candidates.map((slot) => G2.public.field[opp][slot]!.label);
      const [flipped] = ctx2.random.Shuffle(labels);
      G2.secret.pendingFlip[pid] = flipped;

      const guessKey = 'a-guess';
      const guessChoice: ChoiceAbility = {
        needsChoice: true,
        prompt: "Call which of your opponent's Battle Cards will be flipped face-up.",
        kind: 'opponentField',
        getOptions: (G3) => candidateSlots(G3),
        resolve: (G3, ctx3, _self3, guessAnswer) => {
          const flippedLabel = G3.secret.pendingFlip[pid] ?? null;
          G3.secret.pendingFlip[pid] = null;

          const guessedLabel =
            typeof guessAnswer === 'number' ? G3.public.field[opp][guessAnswer]?.label : undefined;

          if (guessedLabel !== undefined && flippedLabel !== null && guessedLabel === flippedLabel) {
            removeAllAbilityTargets(G3, ctx3, opp, candidateSlots(G3), (G4, ctx4) =>
              resolveBattleOutcome(G4, ctx4, pid, mySlot, opp, theirSlot)
            );
            return;
          }

          const self = G3.public.field[pid][mySlot];
          if (self) modifyBp(self, -2);
          resolveBattleOutcome(G3, ctx3, pid, mySlot, opp, theirSlot);
        },
      };
      (CHOICE_ABILITIES_BY_LABEL['Sk-21'] ??= {})[guessKey] = guessChoice;
      openChoice(G2, ctx2, { pid, slot: mySlot }, 'Sk-21', guessKey, guessChoice);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL['Sk-21'] ??= {})[confirmKey] = confirmChoice;
  openChoice(G, ctx, { pid, slot: mySlot }, 'Sk-21', confirmKey, confirmChoice);
  return true;
}

/**
 * Sk-16 WAR DRAGON, effects c and d — the shared reactive-interrupt shape
 * behind both: "You may remove 1 face-down [Power|Action] Card from your
 * hand [during either player's turn, for d] to negate [an opponent's Power
 * Card's effect | your opponent's Action Card removing 1 card from the
 * field]." Neither prints "once" anywhere (unlike Sk-19a's explicit "Once
 * after..."), so both are repeatable — bounded only by having another
 * payable face-down card in hand each time, the same natural self-limiting
 * every other hand-cost ability in this file already has, with no separate
 * once-only flag invented.
 *
 * `actingPid` is whoever's card is being negated (the Power card's own
 * player for c, or the Action card's own player for d) — "your opponent's
 * ..." reads from WAR DRAGON's controller's own perspective, so the
 * defender this window is offered to is always actingPid's OPPONENT.
 *
 * `effectIfNotNegated` runs exactly once: immediately, with no prompt at
 * all, if the defender has no War Dragon or nothing to pay with (the
 * zero-target gate — "the window only opens when the defender can actually
 * pay"); from the yesNo's own decline branch; or never, if the defender
 * successfully negates. `afterEither`, when given, ALWAYS runs once the
 * whole window has fully settled either way — Sk-16d needs this because
 * Sk-03b's own War Dragon retrieval is a SEPARATE clause of its own effect,
 * not itself part of what gets negated, and must still happen regardless.
 *
 * PAUSE, not undo: this is called from inside the acting card's own resolve,
 * BEFORE the real effect (placing a Power Card's onSummon fire, or an Action
 * Card's field removal) has happened at all — see the two call sites
 * (playCard in game.ts for c; CHOICE_ABILITIES_BY_LABEL['Sk-03']['b-remove']
 * and ['Sk-05']['a-target'] for d). Resumption is exactly `effectIfNotNegated`
 * running, from inside this SAME function's own resolve chain — there is no
 * separate "undo" path, because nothing ever ran to undo.
 *
 * Cost payment reuses dispatchSearch over the defender's own hand (zone:
 * 'hand', predicate: matching costType) — the SAME ordinal-secrecy scheme
 * every other secret-zone search in this file already uses, so the specific
 * face-down card's identity is never exposed to pendingChoice.options, and
 * banishHandCardFaceDown (also pre-existing, Sk-25b's own cost shape) never
 * writes the label anywhere public — only the face-down COUNT increments.
 *
 * Not itself re-interruptible: the cost payment removes a card from the
 * defender's own HAND via banishHandCardFaceDown, never a field slot and
 * never a Power Card being played — so nothing this function does can ever
 * satisfy the trigger condition for ANOTHER Sk-16c/d offer. This function is
 * only ever called FROM a Power-card play or an Action-card removal, never
 * from within its own resolve chain, so there is no path back into itself.
 */
export function offerSk16Negation(
  G: ShadowkhanG,
  ctx: EngineCtx,
  actingPid: string,
  costType: 'power' | 'action',
  effectIfNotNegated: (G: ShadowkhanG, ctx: EngineCtx) => void,
  afterEither?: (G: ShadowkhanG, ctx: EngineCtx) => void
): void {
  const defender = actingPid === '0' ? '1' : '0';

  const hasWarDragon = (G2: ShadowkhanG): boolean =>
    G2.public.field[defender].some((c) => c && CARD_BY_LABEL[effectiveLabel(c)]?.name === 'WAR DRAGON');
  const payableCount = (G2: ShadowkhanG): number =>
    G2.secret.hands[defender].filter((l) => CARD_BY_LABEL[l]?.type === costType).length;

  const proceed = (G2: ShadowkhanG, ctx2: EngineCtx): void => {
    effectIfNotNegated(G2, ctx2);
    afterEither?.(G2, ctx2);
  };

  if (!hasWarDragon(G) || payableCount(G) === 0) {
    proceed(G, ctx);
    return;
  }

  const key = costType === 'power' ? 'c-confirm' : 'd-confirm';
  const costKey = costType === 'power' ? 'c-cost' : 'd-cost';
  const confirmChoice: ChoiceAbility = {
    needsChoice: true,
    prompt:
      costType === 'power'
        ? "War Dragon: remove 1 face-down Power Card from your hand to negate your opponent's Power Card?"
        : "War Dragon: remove 1 face-down Action Card from your hand to negate your opponent's Action Card removing a card from the field?",
    kind: 'yesNo',
    getOptions: () => null,
    resolve: (G2, ctx2, self2, answer) => {
      if (answer !== true) {
        proceed(G2, ctx2);
        return;
      }
      dispatchSearch(
        G2,
        ctx2,
        self2,
        'Sk-16',
        costKey,
        'hand',
        defender,
        (l) => CARD_BY_LABEL[l]?.type === costType,
        costType === 'power'
          ? 'Choose which face-down Power Card to remove.'
          : 'Choose which face-down Action Card to remove.',
        (G3, ctx3, owner, handIndex) => {
          banishHandCardFaceDown(G3, owner, handIndex);
          afterEither?.(G3, ctx3);
        }
      );
    },
  };
  (CHOICE_ABILITIES_BY_LABEL['Sk-16'] ??= {})[key] = confirmChoice;
  const warDragonSlot = G.public.field[defender].findIndex(
    (c) => c && CARD_BY_LABEL[effectiveLabel(c)]?.name === 'WAR DRAGON'
  );
  openChoice(G, ctx, { pid: defender, slot: warDragonSlot }, 'Sk-16', key, confirmChoice);
}

// ---------------------------------------------------------------------------
// Named/attribute card search primitive. A single reusable engine for every
// ability whose effect text is "find a card by name/type/BP/tier in a hand,
// deck, or your face-up removed pile" — one generic mechanism, no per-card
// search logic.
//
// 'removed' reads G.public.banished[owner] — the face-up removed pile,
// which is PUBLIC (see PublicState in state.ts), unlike deck/hand which are
// secret. Face-down removals never enter this array at all: they only ever
// increment G.public.banishedFaceDown[owner], a bare counter with no label
// stored anywhere — see removeOwnDeckTopFaceDown / banishHandCardFaceDown.
// So "face-up only" isn't a distinction this search primitive has to add;
// it's already structural — a face-down removal has no identity left to
// search for or select, in any zone, by construction.
// ---------------------------------------------------------------------------

/** 'handOrDeck' is a VIRTUAL zone for an effect text like Sk-06b's "select
 *  and remove from your hand and/or deck" — the player freely mixes which
 *  zone each pick comes from, so search/select needs the UNION of both, not
 *  two separate steps that would force a rigid split. readZoneSource
 *  concatenates hand then deck into a fresh array (hand indices first, then
 *  deck indices) purely for search/selection purposes; removeFromHandOrDeck
 *  is the matching removal step, since a combined-zone index isn't a real
 *  index into either underlying array on its own. */
export type SearchZone = 'deck' | 'hand' | 'removed' | 'handOrDeck';

/** The single place that maps a zone to its underlying array. Replaces the
 *  `zone === 'deck' ? ... : ...` ternary that only had room for two zones. */
function readZoneSource(G: ShadowkhanG, zone: SearchZone, owner: string): readonly string[] {
  if (zone === 'deck') return G.secret.decks[owner];
  if (zone === 'hand') return G.secret.hands[owner];
  if (zone === 'handOrDeck') return [...G.secret.hands[owner], ...G.secret.decks[owner]];
  return G.public.banished[owner];
}

/** True for a zone whose real index must never reach G.public as-is (deck,
 *  hand, and handOrDeck — all secret). False for 'removed', which is
 *  already fully public — see dispatchSearch/dispatchMultiSearch for what
 *  this changes. */
function zoneIsSecret(zone: SearchZone): boolean {
  return zone !== 'removed';
}

/** Scans `owner`'s zone and returns the zone-relative indices of entries
 *  matching `predicate`, in zone order. This is the only place that reads a
 *  deck, hand, or removed-pile array for search purposes — every search
 *  ability composes it instead of poking G.secret/G.public.banished directly. */
function searchIndices(
  G: ShadowkhanG,
  zone: SearchZone,
  owner: string,
  predicate: (label: string) => boolean
): number[] {
  const source = readZoneSource(G, zone, owner);
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
 * CRITICAL: deck (and hand) order is secret state (G.secret) and must never
 * reach G.public — but every pendingChoice is broadcast to both players via
 * G.public.pendingChoice. So for those zones, the opened choice's `options`
 * are ORDINAL positions within the match list (0, 1, 2, ... — "the
 * 1st/2nd/3rd match"), never real indices. `resolve` re-derives the real
 * index by re-running the identical search at answer time — safe, because
 * no other move can run while a pendingChoice is open. Hand search reuses
 * this scheme for uniformity even though it's not strictly required for
 * hand (visible to its own owner via playerView already).
 *
 * 'removed' is different on purpose: G.public.banished is ALREADY fully
 * public to both players (see zoneIsSecret) — wrapping it in the same
 * ordinal indirection would hide nothing real and just be pointless
 * misdirection, so for 'removed' the choice's `options` ARE the real
 * indices directly, and `resolve` still re-validates against a fresh
 * search (for consistency/robustness) but skips the ordinal translation.
 */
/**
 * `apply` receives ctx FRESH from whichever call actually invokes it — the
 * initiating call's own ctx for the 0/1-match fast path, or the searchChoice
 * resolve's own ctx2 for the many-match path (which may run in a LATER,
 * separate resolveChoice move dispatch). This matters for any apply that
 * itself needs to chain into another ctx-dependent step (e.g.
 * dispatchPlacement, which calls fireTrigger for the newly-placed card) —
 * closing over the ORIGINATING call's ctx instead would hand later code a
 * reference tied to an already-finished move dispatch. Every existing apply
 * closure that doesn't need ctx simply ignores the extra parameter.
 */
function dispatchSearch(
  G: ShadowkhanG,
  ctx: EngineCtx,
  self: AbilitySelf,
  label: string,
  key: string,
  zone: SearchZone,
  owner: string,
  predicate: (label: string) => boolean,
  prompt: string,
  apply: (G: ShadowkhanG, ctx: EngineCtx, owner: string, realIndex: number) => void
): void {
  const matches = searchIndices(G, zone, owner, predicate);
  if (matches.length === 0) return;
  if (matches.length === 1) {
    apply(G, ctx, owner, matches[0]);
    return;
  }
  const secret = zoneIsSecret(zone);
  const searchChoice: ChoiceAbility = {
    needsChoice: true,
    prompt,
    kind: 'chooseAbility',
    getOptions: (G2) => {
      const real = searchIndices(G2, zone, owner, predicate);
      return secret ? real.map((_, i) => i) : real;
    },
    resolve: (G2, ctx2, _self2, answer) => {
      if (typeof answer !== 'number') return;
      const fresh = searchIndices(G2, zone, owner, predicate);
      const realIndex = secret ? fresh[answer] : answer;
      if (realIndex === undefined || !fresh.includes(realIndex)) return;
      apply(G2, ctx2, owner, realIndex);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL[label] ??= {})[key] = searchChoice;
  openChoice(G, ctx, self, label, key, searchChoice);
}

/**
 * The MULTI-select counterpart to dispatchSearch — reuses the exact same
 * search primitive, pendingChoice, zero-target gate, and ordinal-secrecy
 * scheme; the only new thing is `count`/`exact` (see PendingChoice.multi).
 *
 * Zero/forced/enough gating, generalized for a required count instead of a
 * single pick (mirroring dispatchSearch's own zero/one/many rule):
 *  - zero candidates: silent fizzle (openChoice's existing zero-target gate).
 *  - fewer candidates than an EXACT count requires: also a silent fizzle —
 *    the requirement could never be satisfied.
 *  - an EXACT count with EXACTLY that many candidates: no real choice to
 *    make (every one of them must be picked) — applies immediately, same
 *    as dispatchSearch's own single-match case, no prompt.
 *  - "up to N" with fewer than N candidates: opens normally, capped at
 *    whatever's available — "up to" never requires hitting N, and never
 *    auto-forces a selection the player might want to decline (0 of 1
 *    available is still a legal answer).
 *  - otherwise (exact with more candidates than count, or "up to" with any
 *    candidates present): opens a real multi-select choice.
 *
 * CRITICAL (same as dispatchSearch): for deck/hand, `options` are ORDINAL
 * positions within the match list, never real indices. `resolve` receives
 * the final picked ORDINALS (as number[], from resolveMultiChoice) and
 * re-derives real matches with a fresh search, then translates to LABELS
 * (not raw indices) before calling `apply` — labels are unique per player's
 * deck/hand/removed pile, so removing several by label is safe regardless
 * of processing order, unlike raw indices which shift as earlier ones are
 * spliced out. For 'removed' (already fully public — see dispatchSearch),
 * the same ordinal step is skipped: options and picks are real indices
 * throughout, with no indirection to hide anything that isn't secret.
 */
function dispatchMultiSearch(
  G: ShadowkhanG,
  ctx: EngineCtx,
  self: AbilitySelf,
  label: string,
  key: string,
  zone: SearchZone,
  owner: string,
  predicate: (label: string) => boolean,
  count: number,
  exact: boolean,
  prompt: string,
  apply: (G: ShadowkhanG, owner: string, labels: string[]) => void
): void {
  const matches = searchIndices(G, zone, owner, predicate);
  if (matches.length === 0) return;
  if (exact && matches.length < count) return;
  if (exact && matches.length === count) {
    const source = readZoneSource(G, zone, owner);
    apply(G, owner, matches.map((i) => source[i]));
    return;
  }

  const secret = zoneIsSecret(zone);
  const multiChoice: ChoiceAbility = {
    needsChoice: true,
    prompt,
    kind: 'chooseAbility',
    getOptions: (G2) => {
      const real = searchIndices(G2, zone, owner, predicate);
      return secret ? real.map((_, i) => i) : real;
    },
    resolve: (G2, _ctx2, _self2, answer) => {
      if (!Array.isArray(answer)) return;
      const fresh = searchIndices(G2, zone, owner, predicate);
      const source = readZoneSource(G2, zone, owner);
      const realIndices = secret
        ? answer.map((ordinal) => fresh[ordinal]).filter((i): i is number => i !== undefined)
        : answer.filter((i) => fresh.includes(i));
      const labels = realIndices.map((realIndex) => source[realIndex]);
      apply(G2, owner, labels);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL[label] ??= {})[key] = multiChoice;
  openChoice(G, ctx, self, label, key, multiChoice, { count, exact });
}

/**
 * Opens a placement choice among owner's own EMPTY field slots for
 * `cardLabel`, applying it via placeCardOnField (the exact function playCard
 * itself uses) once answered — the single placement mechanism, so a card
 * entering the field this way is indistinguishable from one played normally,
 * onSummon included. Mirrors dispatchSearch's own zero/one/many shape:
 *  - zero empty slots: silent fizzle (the same zero-target gate as
 *    everywhere else — a full field means nothing legal to choose).
 *  - exactly one empty slot: applies immediately, no prompt.
 *  - more than one: opens a real 'emptyOwnFieldSlot' choice among them.
 * Always public (a field slot's occupancy is visible to both players), so —
 * like the 'removed' zone — no ordinal-secrecy indirection is needed; the
 * offered options are real slot indices directly.
 */
function dispatchPlacement(
  G: ShadowkhanG,
  ctx: EngineCtx,
  self: AbilitySelf,
  label: string,
  key: string,
  owner: string,
  cardLabel: string,
  prompt: string
): void {
  const emptySlots = (G2: ShadowkhanG) =>
    G2.public.field[owner].map((c, i) => (c === null ? i : null)).filter((i): i is number => i !== null);

  const slots = emptySlots(G);
  if (slots.length === 0) return;
  if (slots.length === 1) {
    placeCardOnField(G, ctx, owner, slots[0], cardLabel);
    return;
  }

  const placementChoice: ChoiceAbility = {
    needsChoice: true,
    prompt,
    kind: 'emptyOwnFieldSlot',
    getOptions: (G2) => emptySlots(G2),
    resolve: (G2, ctx2, _self2, answer) => {
      if (typeof answer !== 'number') return;
      if (!emptySlots(G2).includes(answer)) return;
      placeCardOnField(G2, ctx2, owner, answer, cardLabel);
    },
  };
  (CHOICE_ABILITIES_BY_LABEL[label] ??= {})[key] = placementChoice;
  openChoice(G, ctx, self, label, key, placementChoice);
}

/**
 * Resolves any of pid's scheduled summons whose turn has arrived — the
 * turn.onBegin counterpart to expireTimedEffects (turn.onEnd), using the
 * exact same globalTurns arithmetic (turnsTaken['0'] + turnsTaken['1']),
 * just checked from the opposite end of a turn: "at the start of your next
 * turn" is naturally an onBegin-time condition, not an onEnd-time one.
 *
 * Each due entry is popped off the queue, then placed via dispatchPlacement
 * — the SAME placement mechanism playCard/Sk-04a/Sk-08a all share, so the
 * scheduled card fires onSummon exactly like any other placement (see
 * placeCardOnField's own doc comment). dispatchPlacement's own zero/one/many
 * shape already covers "the field is full when the scheduled turn arrives":
 * zero empty slots is its existing silent fizzle — the card is lost, no
 * retry, no stranded entry, since the entry has already been removed from
 * the queue by the time dispatchPlacement is even called.
 *
 * Processes entries one at a time and stops as soon as a placement opens a
 * real pendingChoice (2+ empty slots) — the rest of this dispatch would
 * otherwise collide with that open choice. Not reachable with the current
 * card set (Sk-06 is a singleton, so at most one entry can ever be
 * scheduled by it), but any remaining due entries are simply left queued —
 * still "due" next time (summonAtGlobalTurn <= globalTurns only ever
 * becomes MORE true), so a later onBegin check picks them up rather than
 * losing them.
 */
export function resolveScheduledSummons(G: ShadowkhanG, ctx: EngineCtx, pid: string): void {
  const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
  const queue = G.secret.scheduledSummons[pid];
  while (!G.public.pendingChoice) {
    const dueIndex = queue.findIndex((entry) => entry.summonAtGlobalTurn <= globalTurns);
    if (dueIndex === -1) return;
    const [entry] = queue.splice(dueIndex, 1);
    const sourceName = CARD_BY_LABEL[entry.sourceLabel]?.name ?? entry.sourceLabel;
    dispatchPlacement(
      G,
      ctx,
      { pid, slot: entry.sourceSlot },
      entry.sourceLabel,
      'scheduled-summon',
      pid,
      entry.label,
      `${sourceName}: choose which empty field slot to place ${entry.label} into.`
    );
  }
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
  // Sk-03 ARRIVAL OF DOOM confirm steps. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-03'] above. The removal step is Sk-16d's own
  // target — "remove 1 card from the field" — regardless of whose field
  // it's from; the War Dragon search that follows is a SEPARATE clause of
  // Sk-03's own effect ("add one War Dragon...to your hand"), never itself
  // negated, so it's threaded through as offerSk16Negation's `afterEither`,
  // running whether the removal was negated or not.
  'Sk-03': {
    'b-remove': {
      needsChoice: true,
      prompt: 'Arrival of Doom: choose one card on your field to remove.',
      kind: 'ownField',
      getOptions: (G, _ctx, self) =>
        G.public.field[self.pid]
          .map((c, i) => (c ? i : null))
          .filter((i): i is number => i !== null),
      resolve: (G, ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const removeSlot = answer;
        offerSk16Negation(
          G,
          ctx,
          self.pid,
          'action',
          (G2, ctx2) => {
            removeFieldCard(G2, ctx2, self.pid, removeSlot, 'ability');
          },
          (G2, ctx2) => {
            const isWarDragon = (l: string) => CARD_BY_LABEL[l]?.name === 'WAR DRAGON';
            const inRemoved = searchIndices(G2, 'removed', self.pid, isWarDragon);
            const zone: SearchZone = inRemoved.length > 0 ? 'removed' : 'deck';
            dispatchSearch(
              G2,
              ctx2,
              self,
              'Sk-03',
              'b-warDragon',
              zone,
              self.pid,
              isWarDragon,
              'Arrival of Doom: add your War Dragon to your hand.',
              (G3, _ctx3, owner, realIndex) => {
                if (zone === 'removed') {
                  const found = removeFromOwnRemovedPile(G3, owner, realIndex);
                  if (found) G3.secret.hands[owner].push(found);
                } else {
                  moveDeckCardToHand(G3, owner, realIndex);
                }
              }
            );
          }
        );
      },
    },
  },

  // Sk-26 ABDUCTION SAUCER target step. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-26'] above. `targetLabel` is captured BEFORE the
  // removal, from this resolve's own fresh G — a plain string, safe to
  // close over in afterRemoved even if a guardian defers this to a later
  // move dispatch (see the ordering note on ABILITIES_BY_LABEL['Sk-26']).
  'Sk-26': {
    'a-target': {
      needsChoice: true,
      prompt: "Abduction Saucer: choose one of your opponent's Battle Cards to place under this card.",
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
        const hostPid = self.pid;
        const hostSlot = self.slot;
        const targetCard = G.public.field[opp][answer];
        if (!targetCard) return;
        const targetLabel = targetCard.label;
        removeFieldCard(G, ctx, opp, answer, 'ability', {
          afterRemoved: (G2) => {
            const pile = G2.public.banished[opp];
            const idx = pile.indexOf(targetLabel);
            if (idx === -1) return; // the original target was saved (e.g. a guardian substituted itself) — nothing to take
            pile.splice(idx, 1);
            untagBanishedFromField(G2, opp, targetLabel);
            const host = G2.public.field[hostPid][hostSlot];
            if (!host) {
              // Sk-26 itself is somehow gone by the time this resolves —
              // not reachable today (nothing before this removes it), but
              // fall back to leaving the card banished rather than losing
              // it silently.
              G2.public.banished[opp].push(targetLabel);
              G2.public.banishedFromField[opp].push(targetLabel);
              return;
            }
            host.attached.push(targetLabel);
          },
        });
      },
    },
  },

  // Sk-08 A SINISTER ALLIANCE confirm step. Only reachable via the
  // dispatcher in ABILITIES_BY_LABEL['Sk-08'] above. The eligible-ally
  // predicate snapshots "which ally names are already on the field" as a
  // plain Set at construction time (this resolve's own fresh G), rather than
  // reading G.public.field again inside the predicate body — the predicate
  // may be re-run later by dispatchSearch's own getOptions/resolve from a
  // separate resolveChoice move if the deck holds more than one eligible
  // card, and closing over a stale G there would be wrong (see dispatchSearch's
  // own doc comment on why apply receives ctx fresh, same underlying issue).
  'Sk-08': {
    'a-confirm': {
      needsChoice: true,
      prompt: 'A Sinister Alliance: from your deck, play one of Blazing Sky Goblin, Sand Squid, or Battle Shock Scorpion that is not already on your field?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        const allies = ['BLAZING SKY GOBLIN', 'SAND SQUID', 'BATTLE SHOCK SCORPION'];
        const ownFieldAllyNames = new Set(
          G.public.field[self.pid]
            .filter((c): c is FieldCard => c !== null)
            .map((c) => CARD_BY_LABEL[c.label]?.name)
            .filter((n): n is string => n !== undefined)
        );
        const eligible = (l: string) => {
          const name = CARD_BY_LABEL[l]?.name;
          return !!name && allies.includes(name) && !ownFieldAllyNames.has(name);
        };
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-08',
          'a-search',
          'deck',
          self.pid,
          eligible,
          'Choose which card to play from your deck.',
          (G2, ctx2, owner, deckIndex) => {
            const deck = G2.secret.decks[owner];
            const [label] = deck.splice(deckIndex, 1);
            dispatchPlacement(
              G2,
              ctx2,
              self,
              'Sk-08',
              'a-place',
              owner,
              label,
              `Choose which empty field slot to play ${label} into.`
            );
          }
        );
      },
    },
  },

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

  // Sk-18 EMPTY VESSEL, effect a: "When you play this card, you may select
  // 1 of your removed cards. This card's BP and effects become identical to
  // the selected card." Optional even when eligible removed cards exist
  // ("you may"), so this is the same yesNo -> leadsTo target shape as Sk-14
  // above, not a bare dispatchSearch (which would force a pick the instant
  // exactly one candidate exists, with no way to decline). The zero-target
  // gate still applies via willHaveLegalOutcome's leadsTo look-ahead: an
  // empty removed pile means the yesNo itself never opens — "no eligible
  // copy target: resolves silently" falls out of the existing mechanism,
  // no special-casing needed.
  //
  // 'removed' is already fully public (see zoneIsSecret) so, like every
  // other 'removed'-zone selection in this file, the target step's options
  // are real indices directly, no ordinal indirection.
  //
  // The copy itself: sets FieldCard.copiedIdentity (see effectiveLabel) and
  // assigns currentBp from the selected card's PRINTED bp — the selected
  // card is removed, not field-resident, so there's no "live" BP to copy,
  // only its printed value, same as every other "become/summon a copy of
  // label X" pattern in this file (e.g. Sk-06a's selectedBp).
  'Sk-18': {
    a: {
      needsChoice: true,
      trigger: 'onSummon',
      leadsTo: 'a-target',
      prompt: 'Empty Vessel: copy the BP and effects of one of your removed cards?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        openChoice(G, ctx, self, 'Sk-18', 'a-target', CHOICE_ABILITIES_BY_LABEL['Sk-18']['a-target']);
      },
    },
    'a-target': {
      needsChoice: true,
      prompt: 'Choose which of your removed cards to copy.',
      kind: 'chooseAbility',
      getOptions: (G, _ctx, self) => G.public.banished[self.pid].map((_l, i) => i),
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const pile = G.public.banished[self.pid];
        const selectedLabel = pile[answer];
        if (selectedLabel === undefined) return;
        const card = G.public.field[self.pid][self.slot];
        if (!card) return;
        card.copiedIdentity = selectedLabel;
        card.currentBp = CARD_BY_LABEL[selectedLabel]?.bp ?? 0;
      },
    },
  },

  // Sk-13 MYSTICAL BLUE FLAME POWER CARD: "Choose one of the following
  // effects when activated: [0] Increase the BP of one of your Battle Cards
  // by +1 ... / [1] Restore the BP of one of your Battle Cards to its
  // original BP ..." Usable only on Battle Cards with BP<=6. A chooseAbility
  // entry, chaining into an ownField target pick for whichever branch was
  // picked. Both branches are now timed ActiveEffects (same turn-counting
  // math as Sk-12), reusing hasActiveEffect's registry rather than a
  // parallel mechanism — see the 'bpModifier' EffectKind and
  // ActiveEffect.onExpire in state.ts, applied by applyExpiryCorrection.
  //
  // The two branches name DIFFERENT windows and are implemented differently
  // as a result:
  //  - branch 0 ("+1 BP ... until the end of YOUR turn"): the buff applies
  //    NOW (this is still the activating player's own turn in progress) and
  //    reverts when THAT SAME turn ends — one onEnd away, so
  //    expiresAtGlobalTurn = globalTurns + 1 (not +2 — this window is
  //    shorter than Sk-12's "until the end of the opponent's turn", it ends
  //    at the end of the activator's OWN current turn).
  //  - branch 1 ("Restore ... at the end of YOUR OPPONENT'S turn after this
  //    card is activated"): this phrasing matches Sk-12's exactly, so it
  //    uses the same expiresAtGlobalTurn = globalTurns + 2. Nothing happens
  //    at creation — the restoration itself IS the delayed event named in
  //    the text, not a reversal of something applied now.
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
      prompt: 'Choose one of your Battle Cards (BP 6 or less) to gain +1 BP until the end of your turn.',
      kind: 'ownField',
      getOptions: (G, _ctx, self) => eligibleOwnBattleCardsAtOrBelow(G, self, 6),
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const card = G.public.field[self.pid][answer];
        if (!card) return;
        modifyBp(card, 1);
        const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
        G.public.activeEffects.push({
          kinds: ['bpModifier'],
          targetPid: self.pid,
          targetSlot: answer,
          sourceLabel: 'Sk-13',
          sourcePid: self.pid,
          sourceSlot: self.slot,
          expiresAtGlobalTurn: globalTurns + 1,
          onExpire: { kind: 'revertDelta', bpDelta: 1 },
        });
      },
    },
    'a-target-restore': {
      needsChoice: true,
      prompt: "Choose one of your Battle Cards (BP 6 or less) to restore to its original BP at the end of your opponent's next turn.",
      kind: 'ownField',
      getOptions: (G, _ctx, self) => eligibleOwnBattleCardsAtOrBelow(G, self, 6),
      resolve: (G, _ctx, self, answer) => {
        if (typeof answer !== 'number') return;
        const card = G.public.field[self.pid][answer];
        if (!card) return;
        const globalTurns = G.public.turnsTaken['0'] + G.public.turnsTaken['1'];
        G.public.activeEffects.push({
          kinds: ['bpModifier'],
          targetPid: self.pid,
          targetSlot: answer,
          sourceLabel: 'Sk-13',
          sourcePid: self.pid,
          sourceSlot: self.slot,
          expiresAtGlobalTurn: globalTurns + 2,
          onExpire: { kind: 'restoreOriginal' },
        });
      },
    },
  },

  // Sk-07 ACE IN THE HOLE confirm steps. Only reachable via the dispatcher in
  // ABILITIES_BY_LABEL['Sk-07'] above.
  'Sk-07': {
    'a-confirm': {
      needsChoice: true,
      prompt: 'Ace In The Hole: this drew your last deck card — select 10 of your face-up removed cards, shuffle them, and add them to your deck?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        dispatchMultiSearch(
          G,
          ctx,
          self,
          'Sk-07',
          'a-search',
          'removed',
          self.pid,
          () => true, // any face-up removed card qualifies — no name/type/BP filter in the printed text
          10,
          true, // exact
          'Choose exactly 10 of your face-up removed cards to shuffle into your deck.',
          (G2, owner, labels) => {
            removeMultipleFromOwnRemovedPile(G2, owner, labels);
            // ctx (EngineCtx) is captured from the enclosing resolve() — the
            // ONLY source of randomness any card effect may use, never
            // Math.random (see EngineCtx's doc comment at the top of this file).
            const shuffled = ctx.random.Shuffle(labels);
            G2.secret.decks[owner].push(...shuffled);
          }
        );
      },
    },
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
  // ABILITIES_BY_LABEL['Sk-05'] above. The removal itself is Sk-16d's own
  // target ("your opponent's Action Card['s] remove 1 card from the
  // field") — routed through offerSk16Negation rather than calling
  // removeOpponentFieldCard directly, so War Dragon gets first say. No
  // afterEither: this removal IS the entirety of Sk-05's own effect, unlike
  // Sk-03b below.
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
        offerSk16Negation(G, ctx, self.pid, 'action', (G2, ctx2) => {
          removeOpponentFieldCard(G2, ctx2, opp, answer);
        });
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
              // Sk-30a (Shadow's Mistress) can now apply to an
              // 'ability'-cause removal if a Shadow Ghost is being wiped and
              // a guardian is present — this break is exactly why the loop
              // stops instead of continuing to mutate remaining slots once a
              // guardian (or self-hook) opens a pendingChoice: the rest of
              // the wipe is deferred to whatever finishes that choice, not
              // resumed here.
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
    'c-confirm': {
      needsChoice: true,
      prompt: 'Battle Shock Scorpion: add one face-up removed Action Card to your hand?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        dispatchSearch(
          G,
          ctx,
          self,
          'Sk-25',
          'c-search',
          'removed',
          self.pid,
          (l) => CARD_BY_LABEL[l]?.type === 'action',
          'Choose which face-up removed Action Card to add to your hand.',
          (G2, _ctx2, owner, realIndex) => {
            const found = removeFromOwnRemovedPile(G2, owner, realIndex);
            if (found) G2.secret.hands[owner].push(found);
          }
        );
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
          (G2, _ctx2, owner, realIndex) => moveDeckCardToHand(G2, owner, realIndex)
        );
      },
    },
  },

  // Sk-20 SAGE OF DARK OMEN confirm step. Only reachable via the dispatcher
  // in ABILITIES_BY_LABEL['Sk-20'] above. On Yes, chains an exact-3
  // multi-select hand cost into an up-to-2 multi-select deck removal.
  'Sk-20': {
    'a-confirm': {
      needsChoice: true,
      prompt: 'Sage of Dark Omen: remove 3 cards from your hand to remove up to 2 BP 7/8 Battle Cards from your deck?',
      kind: 'yesNo',
      getOptions: () => null,
      resolve: (G, ctx, self, answer) => {
        if (answer !== true) return;
        dispatchMultiSearch(
          G,
          ctx,
          self,
          'Sk-20',
          'a-cost',
          'hand',
          self.pid,
          () => true, // any hand card qualifies as the cost
          3,
          true, // exact 3
          'Choose 3 cards from your hand to remove.',
          (G2, owner, labels) => {
            discardMultipleFromOwnHand(G2, owner, labels);
            dispatchMultiSearch(
              G2,
              ctx,
              self,
              'Sk-20',
              'a-deck-target',
              'deck',
              owner,
              (deckLabel) => {
                const c = CARD_BY_LABEL[deckLabel];
                return c?.type === 'battle' && (c.bp === 7 || c.bp === 8);
              },
              2,
              false, // up to 2
              'Choose up to 2 BP 7/8 Battle Cards to remove from your deck.',
              (G3, owner2, deckLabels) => removeMultipleFromOwnDeck(G3, owner2, deckLabels)
            );
          }
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
  ctx: EngineCtx,
  trigger: Trigger,
  self: AbilitySelf
): void {
  const fieldCard = G.public.field[self.pid][self.slot];
  if (!fieldCard) return;
  const label = effectiveLabel(fieldCard);

  const abilities = ABILITIES_BY_LABEL[label];
  if (abilities) {
    for (const ability of abilities) {
      if (ability.auto && ability.trigger === trigger) {
        ability.run({ G, ctx, self });
      }
    }
  }

  if (!G.public.pendingChoice) {
    const choices = CHOICE_ABILITIES_BY_LABEL[label];
    if (choices) {
      for (const [key, choice] of Object.entries(choices)) {
        if (choice.trigger === trigger) {
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
  ctx: EngineCtx,
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
  ctx: EngineCtx,
  pid: string
): void {
  const deck = G.secret.decks[pid];
  if (deck.length === 0) return;
  const hand = G.secret.hands[pid];
  const label = deck.shift()!;
  const handIndex = hand.push(label) - 1;
  fireOnDraw(G, ctx, pid, handIndex);
}

/**
 * Handles one resolveChoice call against a MULTI-select pendingChoice
 * (pending.multi is set — see openChoice/dispatchMultiSearch). The same
 * `number | boolean` answer type as every other choice is reused, just
 * given a second meaning in this context:
 *  - a number: one more pick. Must be a legal, not-already-picked option,
 *    with room left. The choice auto-resolves the instant the required
 *    count is reached (exact or "up to" alike — there's nothing more to
 *    add once the cap is hit either way).
 *  - `true`: finalize now with whatever's been picked so far. Only legal
 *    for "up to N" — REJECTED (INVALID_MOVE) if exact and the count hasn't
 *    been reached yet, so a client can't accidentally under-pay an exact
 *    cost.
 *  - `false`: cancel the whole choice. pendingChoice is cleared and
 *    resolve() is never called — nothing tentatively picked takes effect.
 *    Always legal; this is the clean cancel path for an optional ("may")
 *    multi-select.
 */
function resolveMultiChoice(
  G: ShadowkhanG,
  ctx: EngineCtx,
  pending: PendingChoice,
  choice: ChoiceAbility,
  answer: number | boolean
): boolean {
  const multi = pending.multi!;

  if (typeof answer === 'boolean') {
    if (answer === false) {
      G.public.pendingChoice = null;
      syncActivePlayersToPendingChoice(G, ctx);
      return true;
    }
    if (multi.exact && multi.selected.length !== multi.count) return false;
    const self: AbilitySelf = { pid: pending.pid, slot: pending.sourceSlot ?? -1 };
    const finalSelected = multi.selected;
    G.public.pendingChoice = null;
    choice.resolve(G, ctx, self, finalSelected);
    syncActivePlayersToPendingChoice(G, ctx);
    syncCounts(G);
    return true;
  }

  if (typeof answer !== 'number') return false;
  if (pending.options !== null && !pending.options.includes(answer)) return false;
  if (multi.selected.includes(answer)) return false;
  if (multi.selected.length >= multi.count) return false;

  multi.selected.push(answer);

  if (multi.selected.length === multi.count) {
    const self: AbilitySelf = { pid: pending.pid, slot: pending.sourceSlot ?? -1 };
    const finalSelected = multi.selected;
    G.public.pendingChoice = null;
    choice.resolve(G, ctx, self, finalSelected);
    syncActivePlayersToPendingChoice(G, ctx);
    syncCounts(G);
  }
  return true;
}

/** Resolves G.public.pendingChoice with `answer`. Returns false (and leaves
 *  pendingChoice untouched) if there's nothing pending or the answer isn't a
 *  legal option, so the move layer can turn that into INVALID_MOVE. */
export function resolvePendingChoice(
  G: ShadowkhanG,
  ctx: EngineCtx,
  answer: number | boolean
): boolean {
  const pending = G.public.pendingChoice;
  if (!pending) return false;

  const choice = CHOICE_ABILITIES_BY_LABEL[pending.sourceLabel]?.[pending.abilitySlot];
  if (!choice) {
    G.public.pendingChoice = null;
    syncActivePlayersToPendingChoice(G, ctx);
    return false;
  }

  if (pending.multi) {
    return resolveMultiChoice(G, ctx, pending, choice, answer);
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
  syncActivePlayersToPendingChoice(G, ctx);
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
  ctx: EngineCtx,
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
];
