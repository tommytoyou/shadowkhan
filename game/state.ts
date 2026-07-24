export interface FieldCard {
  label: string;
  currentBp: number;
  /** Labels of cards attached to (not occupying their own field slot of)
   *  this card — Sk-09 "used on" Shadow Ghost, or a future Sk-26 "placed
   *  under this card". See ATTACH_TARGETS/attachCardToHost in effects.ts:
   *  playCard's own move body branches on whether a played card's label is
   *  registered there, rather than treating it as a normal placement.
   *  Banished face-up alongside the host when the host itself is removed —
   *  see finalizeFieldRemoval. */
  attached: string[];
  /** Number of this card owner's turns that have ended while this card was on the field. */
  turnsOnField: number;
  /** false = locked out of attacking (Gargoyle the Wicked). Undefined/true = can attack. */
  canAttack?: boolean;
  /** true = immune to removal via battle (War Dragon). */
  protectedFromBattleCardRemoval?: boolean;
  /** true once activateAbility has fired this card's onActivate trigger —
   *  enforces once-per-card activation without a new global flag. */
  activated?: boolean;
  /** true once this card has used up a one-time removal-replacement effect
   *  (e.g. The Headless Horseman's "once, remain on the field instead"). */
  replacementUsed?: boolean;
  /** Sk-18 EMPTY VESSEL: "This card's BP and effects become identical to the
   *  selected card." Label of the removed card this one is currently
   *  impersonating, or undefined if it hasn't copied anything (or is any
   *  other card). Deliberately NOT represented by overwriting `label` —
   *  `label` is this card's own physical identity, read by every
   *  label-keyed banished/removal/search mechanism (finalizeFieldRemoval,
   *  banishedFromField, PLAY_GATES, singleton-deck name searches like
   *  Sk-03b/Sk-20b); mutating it would make the card vanish from its own
   *  identity's tracking the moment it copies anything. See effectiveLabel
   *  in effects.ts — the one place that decides which label a field card's
   *  ABILITIES_BY_LABEL/CHOICE_ABILITIES_BY_LABEL/REMOVAL_HOOKS/GUARDIAN_HOOKS
   *  lookup uses, consulting this field instead of `label` when set. BP is
   *  copied by value into `currentBp` at selection time (the same field
   *  every other card's live BP already lives in), so battle comparisons
   *  need no special-casing at all. */
  copiedIdentity?: string;
}

export type PendingChoiceKind =
  | 'opponentField'
  | 'ownField'
  | 'opponentHandIndex'
  | 'ownHandIndex'
  | 'yesNo'
  | 'chooseAbility'
  /** Choose an EMPTY own field slot as a placement destination — distinct
   *  from 'ownField', which targets an existing (non-null) card. Offered
   *  options are always genuinely empty, legal slots; see dispatchPlacement
   *  in effects.ts, the single mechanism behind every card-placement effect. */
  | 'emptyOwnFieldSlot';

/** What an active persistent effect restricts (or, for 'bpModifier', changes
 *  the stats of) on its target. Distinct kinds (rather than one blanket
 *  "locked") so a narrow effect like Gargoyle's adjacency lock ("cannot
 *  attack") doesn't accidentally also block "be attacked" or "use card
 *  effects" the way Curse of Stone's full lock does.
 *
 *  'protectedFromRemoval' (Sk-09b) is the stated-duration counterpart to
 *  FieldCard.protectedFromBattleCardRemoval's permanent flag — same scope
 *  (checked only for cause === 'ability' in removeFieldCard; per the
 *  existing designer ruling "no card is unbanishable... losing an ordinary
 *  BP battle always banishes", applied consistently to Sk-09b's "cannot be
 *  removed by Battle Cards or card effects" the same way it already is to
 *  Sk-15a/Sk-16b's near-identical wording), just with an expiry instead of
 *  lasting forever. */
export type EffectKind =
  | 'cannotAttack'
  | 'cannotBeAttacked'
  | 'cannotUseEffects'
  | 'bpModifier'
  | 'protectedFromRemoval';

/** What happens to the target's currentBp when a 'bpModifier' effect
 *  expires (or is pruned early because its source/target left the field):
 *  'revertDelta' subtracts bpDelta back off — undoing a buff that was
 *  applied immediately at creation time (Sk-13b: "+1 until end of turn").
 *  'restoreOriginal' sets currentBp to the target's own printed BP — for an
 *  effect that changes nothing at creation and instead performs the whole
 *  action at expiry (Sk-13c: "restore ... at the end of ... turn", i.e. the
 *  restoration itself is the delayed event, not a reversal of one). */
export type BpExpiryCorrection =
  | { kind: 'revertDelta'; bpDelta: number }
  | { kind: 'restoreOriginal' };

/** A persistent, ongoing effect applied by one field card to another (or to
 *  itself), tracked in G.public so it's visible to both players and never
 *  ad-hoc recomputed. Expires either when `expiresAtGlobalTurn` is reached
 *  (a stated turn-based duration) or when its source or target card leaves
 *  the field slot recorded here (a "while this card is on the field" aura,
 *  or just avoiding a stale reference to a slot that gets reused) — see
 *  expireEffectsForSlot in effects.ts. */
export interface ActiveEffect {
  kinds: EffectKind[];
  targetPid: string;
  targetSlot: number;
  sourceLabel: string;
  sourcePid: string;
  sourceSlot: number;
  /** Prune once turnsTaken['0']+turnsTaken['1'] reaches this value (checked
   *  at turn.onEnd, after incrementing). Omitted for an effect that only
   *  expires when its source/target leaves the field. */
  expiresAtGlobalTurn?: number;
  /** For a 'bpModifier' effect: the BP correction to apply to the target
   *  when this effect is pruned, whether by reaching expiresAtGlobalTurn or
   *  by the source/target leaving the field early. Absent for non-BP kinds. */
  onExpire?: BpExpiryCorrection;
}

/** A card selected from a player's own deck, held in limbo (removed from the
 *  deck, not on any field, not in the removed pile) until it is "considered
 *  played" at the start of a later turn of its own (Sk-06a/b: "select one
 *  Battle Card... At the start of your next turn, the selected card is
 *  considered played"). Resolved from turn.onBegin using the SAME
 *  globalTurns math as ActiveEffect.expiresAtGlobalTurn — see
 *  resolveScheduledSummons in effects.ts.
 *
 *  Kept in G.secret, keyed by owner exactly like decks/hands: nothing in the
 *  printed text says the selected card is revealed, unlike an explicit
 *  "face-up" removal (compare banished vs. banishedFaceDown) — a card
 *  leaving a player's own deck for a new, unlisted destination stays hidden
 *  by default in this ruleset unless the text says otherwise. It carries no
 *  legality constraint on the OPPONENT's own moves either (unlike
 *  ActiveEffect, which must be public because a lock the opponent can't see
 *  would make their own moves unplayable) — so there is no comparable reason
 *  to make it public here. */
export interface ScheduledSummon {
  label: string;
  /** Fires once turnsTaken['0']+turnsTaken['1'] reaches this value, checked
   *  at turn.onBegin for whichever player's turn is starting — same
   *  arithmetic and same "<=" comparison as expireTimedEffects, just
   *  triggered from the opposite end of the turn. */
  summonAtGlobalTurn: number;
  /** Label of the card whose ability scheduled this (Sk-06 itself) — used as
   *  the CHOICE_ABILITIES_BY_LABEL registry key when the scheduled turn
   *  arrives and placement needs a real choice among several empty slots.
   *  Safe to key by label alone: singleton deck, so at most one instance of
   *  a given source label can ever have a scheduled entry outstanding. */
  sourceLabel: string;
  /** Field slot of the card whose ability scheduled this, checked so the
   *  entry can be pruned if that card leaves the field before its scheduled
   *  turn arrives — see expireScheduledSummonsForSlot. */
  sourceSlot: number;
}

export interface PendingChoice {
  /** Player who must answer. */
  pid: string;
  prompt: string;
  kind: PendingChoiceKind;
  /** Valid numeric answers (field slot / hand index / ability index), or null for yesNo. */
  options: number[] | null;
  /** Label of the card whose ability is waiting on this answer. */
  sourceLabel: string;
  /** Field slot of the card whose ability is waiting, if it's still field-resident. */
  sourceSlot: number | null;
  /** Registry key identifying which (possibly chained) choice step this is. */
  abilitySlot: string;
  /** Present only for a multi-select choice: collects several picks across
   *  multiple resolveChoice calls before resolving. Absent for every
   *  single-answer choice, which behaves exactly as before this field was
   *  added — see resolveMultiChoice in effects.ts. */
  multi?: {
    /** How many selections are required (exact) or capped at ("up to"). */
    count: number;
    /** true = must select exactly `count` before it can resolve.
     *  false = "up to `count`" — may finalize early with fewer (including
     *  zero) via a boolean `true` answer, or auto-resolves on reaching
     *  `count` the same as an exact choice. */
    exact: boolean;
    /** Indices into `options` picked so far — not yet resolved. */
    selected: number[];
  };
}

export interface SecretState {
  decks: Record<string, string[]>;
  hands: Record<string, string[]>;
  /** See ScheduledSummon. Keyed by owner, same shape as decks/hands. */
  scheduledSummons: Record<string, ScheduledSummon[]>;
}

export interface PublicState {
  deckCounts: Record<string, number>;
  handCounts: Record<string, number>;
  field: Record<string, (FieldCard | null)[]>;
  banished: Record<string, string[]>;
  banishedFaceDown: Record<string, number>;
  /** Labels currently present in banished[pid] that got there via a FIELD
   *  removal specifically (as opposed to a hand or deck removal) — the
   *  subset Sk-04a's "removed from your field" wording needs to search. Kept
   *  in sync at every removed-pile write: tagged once, in finalizeFieldRemoval
   *  (the sole choke point for every field removal), and purged wherever a
   *  label leaves `banished` (removeFromOwnRemovedPile /
   *  removeMultipleFromOwnRemovedPile in effects.ts) — a card can't stay
   *  tagged "field-origin" once it's no longer even in the removed pile.
   *  Safe to key purely by label: singleton deck, so a label can only be in
   *  the removed pile from one removal event at a time. */
  banishedFromField: Record<string, string[]>;
  turnsTaken: Record<string, number>;
  bottomUpUsed: Record<string, boolean>;
  attackedThisTurn: boolean;
  loser: string | null;
  /** Global rule flip from RULES OF ENGAGEMENT (Sk-01): losing the BP comparison
   *  reduces the defender's BP instead of removing the attacker. */
  rulesOfEngagementActive: boolean;
  /** Non-null while an ability is waiting on player input; blocks other moves until resolved. */
  pendingChoice: PendingChoice | null;
  /** Ongoing effects currently in force — see ActiveEffect. Public so a lock
   *  is visible to both players, not just its caster. */
  activeEffects: ActiveEffect[];
}

export interface ShadowkhanG {
  secret: SecretState;
  public: PublicState;
}

export function syncCounts(G: ShadowkhanG): void {
  for (const pid of Object.keys(G.secret.decks)) {
    G.public.deckCounts[pid] = G.secret.decks[pid].length;
    G.public.handCounts[pid] = G.secret.hands[pid].length;
  }
}
