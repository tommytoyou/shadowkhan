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
