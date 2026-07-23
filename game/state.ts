export interface FieldCard {
  label: string;
  currentBp: number;
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
 *  effects" the way Curse of Stone's full lock does. */
export type EffectKind = 'cannotAttack' | 'cannotBeAttacked' | 'cannotUseEffects' | 'bpModifier';

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
