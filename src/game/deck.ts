import { Card, CardColor, PlayerState } from './types';

const COLORS: CardColor[] = ['red', 'blue', 'green', 'yellow'];

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck(ownerId: string): Card[] {
  const cards: Card[] = [];
  for (const color of COLORS) {
    for (let number = 1; number <= 10; number++) {
      cards.push({ id: `${ownerId}-${color}-${number}`, color, number, ownerId });
    }
  }
  return shuffle(cards);
}

export function dealPlayer(
  id: string,
  name: string,
  isBot: boolean,
  botDifficulty?: PlayerState['botDifficulty'],
  totalScore = 0,
  faction?: PlayerState['faction'],
): PlayerState {
  const deck = createDeck(id);
  const blitzPile = deck.slice(0, 10);
  const postPiles: [Card[], Card[], Card[]] = [
    [deck[10]],
    [deck[11]],
    [deck[12]],
  ];
  const woodPile = deck.slice(13); // 27 cards

  return {
    id,
    name,
    isBot,
    botDifficulty,
    faction,
    blitzPile,
    postPiles,
    woodPile,
    woodActive: [],
    woodDiscard: [],
    cardsPlayedToCenter: 0,
    roundStartCards: blitzPile.length,
    totalScore,
  };
}
