import React from 'react';
import { GameBoard } from './components/GameBoard';
import { MultiLobbyScreen } from './components/MultiLobbyScreen';
import { CountdownScreen } from './components/CountdownScreen';
import { useMultiplayer } from './hooks/useMultiplayer';
import { BarnStar } from './components/icons';

export default function App() {
  const multi = useMultiplayer();

  let content: React.ReactNode;

  // True only on the lobby/menu screens -- never mid-countdown or mid-hand,
  // where a stray click would drop the player out of a live game.
  const onMenu = multi.countdown === null && !(multi.phase === 'playing' && multi.gameState);

  if (multi.countdown !== null) {
    content = <CountdownScreen count={multi.countdown} />;
  } else if (multi.phase === 'playing' && multi.gameState) {
    content = (
      <GameBoard
        state={multi.gameState}
        dispatch={multi.dispatch}
        myPlayerId={multi.myPlayerId ?? undefined}
      />
    );
  } else {
    content = (
      <MultiLobbyScreen
        phase={multi.phase}
        lobbyState={multi.lobbyState}
        myPlayerId={multi.myPlayerId}
        error={multi.error}
        authInfo={multi.authInfo}
        authError={multi.authError}
        initialRoomCode={multi.initialRoomCode}
        onCreateRoom={multi.createRoom}
        onJoinRoom={multi.joinRoom}
        onChangeFaction={multi.changeFaction}
        onUpdateConfig={multi.updateConfig}
        onStartGame={multi.startGame}
        onLeave={multi.leaveRoom}
        onClearError={multi.clearError}
        authResolved={multi.authResolved}
        authPending={multi.authPending}
        onSignIn={multi.signIn}
        onSignUp={multi.signUp}
        onSignOut={multi.signOut}
        onClearAuthError={multi.clearAuthError}
        chatMessages={multi.messages}
        onSendMessage={multi.sendMessage}
      />
    );
  }

  return (
    <>
      {onMenu && (
        <a href="/" className="hub-back-link">
          ← All games
        </a>
      )}
      {content}
      {multi.reconnecting && (
        <div className="reconnect-overlay">
          <BarnStar size={44} style={{ color: 'var(--accent)' }} className="reconnect-star" />
          <div className="reconnect-title">Reconnecting…</div>
          <div className="reconnect-note">Your game is held for 60 seconds</div>
        </div>
      )}
    </>
  );
}
