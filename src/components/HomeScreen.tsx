import React from 'react';
import { PersonIcon, LinkIcon } from './icons';

interface Props {
  onSolo: () => void;
  onMulti: () => void;
}

export function HomeScreen({ onSolo, onMulti }: Props) {
  return (
    <div className="home-screen">
      <div className="home-title">Dutch Blitz</div>
      <div className="home-subtitle">A fast-paced competitive card game</div>

      <div className="home-modes">
        <button className="home-mode-btn home-mode-solo" onClick={onSolo}>
          <span className="home-mode-icon"><PersonIcon size={28} /></span>
          <span className="home-mode-label">Play vs Bots</span>
          <span className="home-mode-desc">Single player · local game</span>
        </button>

        <button className="home-mode-btn home-mode-multi" onClick={onMulti}>
          <span className="home-mode-icon"><LinkIcon size={28} /></span>
          <span className="home-mode-label">Play Online</span>
          <span className="home-mode-desc">Multiplayer · same WiFi or internet</span>
        </button>
      </div>
    </div>
  );
}
