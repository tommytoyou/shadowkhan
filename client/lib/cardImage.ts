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
