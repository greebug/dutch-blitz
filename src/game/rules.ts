import { Card, CardColor, DutchPile } from './types';

const BOY_COLORS: CardColor[] = ['red', 'blue'];
const GIRL_COLORS: CardColor[] = ['green', 'yellow'];

export function isBoy(color: CardColor): boolean {
  return BOY_COLORS.includes(color);
}

export function isGirl(color: CardColor): boolean {
  return GIRL_COLORS.includes(color);
}

export function canPlayOnDutchPile(card: Card, pile: DutchPile): boolean {
  return card.color === pile.color && card.number === pile.topValue + 1;
}

export function canStartNewDutchPile(card: Card): boolean {
  return card.number === 1;
}

/** A card can go on a post pile if it's one lower and alternates boy/girl group. */
export function canPlayOnPostPile(card: Card, topCard: Card | null | undefined): boolean {
  if (!topCard) return true;
  if (card.number !== topCard.number - 1) return false;
  const topIsBoy = isBoy(topCard.color);
  const cardIsBoy = isBoy(card.color);
  return topIsBoy !== cardIsBoy;
}
