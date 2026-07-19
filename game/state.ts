export interface FieldCard {
  label: string;
  currentBp: number;
  attached: string[];
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
