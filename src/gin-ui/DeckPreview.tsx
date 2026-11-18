import { SUITS, RANKS, SUIT_LABELS, RANK_LABELS, makeDeck } from '../gin/cards';
import { CardFace } from './CardFace';
import DeckDefs from './deck/DeckDefs';
import { SUIT_ACCENT } from './deck/suitArt';

/** Traditional names, next to the ones we use in play. */
const ITALIAN: Record<string, string> = {
  su: 'denari',
  go: 'coppe',
  ro: 'bastoni',
  sw: 'spade',
};

/**
 * Every card at once, laid out suit by suit the way a deck photo is.
 *
 * Reachable at /gin/?deck. Proofing forty hand-drawn faces by dealing hands
 * until each one happens to turn up is not a workable way to check artwork.
 */
export default function DeckPreview() {
  const deck = makeDeck();
  // Coins, cups, batons, swords -- the order the printed decks are photographed
  // in, rather than the internal order the engine happens to use.
  const order = ['su', 'go', 'ro', 'sw'] as const;

  return (
    <div className="gin" style={{ maxWidth: 1180 }}>
      <DeckDefs />
      <header>
        <h1 className="gin-title">Napoletane deck</h1>
        <p className="gin-sub">
          40 cards — 1 to 7, then Fante, Cavallo and Re. Face cards score 8; runs read
          1…7, Fante, Cavallo, Re.
        </p>
      </header>

      {order.map((suit) => (
        <section key={suit} style={{ marginBottom: 6 }}>
          <h2
            className="gw-eyebrow"
            style={{
              margin: '0 0 6px',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: SUIT_ACCENT[suit],
            }}
          >
            {SUIT_LABELS[suit]} <span style={{ opacity: 0.55 }}>· {ITALIAN[suit]}</span>
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RANKS.map((rank) => {
              const card = deck.find((c) => c.suit === suit && c.rank === rank)!;
              return (
                <figure key={rank} style={{ margin: 0, textAlign: 'center' }}>
                  <CardFace card={card} />
                  <figcaption
                    style={{ fontSize: 10, color: 'rgba(243,234,214,0.5)', marginTop: 3 }}
                  >
                    {RANK_LABELS[rank]}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
