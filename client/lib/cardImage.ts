import { CARD_BY_LABEL } from '@shadowkhan/game';

export function cardImageSrc(label: string): string {
  const card = CARD_BY_LABEL[label];
  if (card) return card.image;
  return `/cards/${label}.png`;
}

/** Real card name for display, e.g. 'Sk-20' -> 'SAGE OF DARK OMEN'. Falls back
 *  to the raw label so an unrecognized label never renders blank or throws. */
export function cardDisplayName(label: string): string {
  const card = CARD_BY_LABEL[label];
  return card ? card.name : label;
}

/** Display name with " - BP N" appended for Battle Cards only — Action and
 *  Power cards carry no meaningful BP and must not show one. `liveBp` is the
 *  field card's current (possibly buffed/debuffed) BP; omit it when the card
 *  isn't on the field (e.g. a banished-pile entry) to fall back to the
 *  card's printed BP. */
export function cardDisplayNameWithBp(label: string, liveBp?: number): string {
  const card = CARD_BY_LABEL[label];
  const name = card ? card.name : label;
  if (!card || card.type !== 'battle') return name;
  return `${name} - BP ${liveBp ?? card.bp ?? 0}`;
}
