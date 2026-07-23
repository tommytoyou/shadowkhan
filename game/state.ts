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
  | 'chooseAbility';

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
  turnsTaken: Record<string, number>;
  bottomUpUsed: Record<string, boolean>;
  attackedThisTurn: boolean;
  loser: string | null;
  /** Global rule flip from RULES OF ENGAGEMENT (Sk-01): losing the BP comparison
   *  reduces the defender's BP instead of removing the attacker. */
  rulesOfEngagementActive: boolean;
  /** Non-null while an ability is waiting on player input; blocks other moves until resolved. */
  pendingChoice: PendingChoice | null;
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
