import React from 'react';
import { GameBoard } from './components/GameBoard';
import { MultiLobbyScreen } from './components/MultiLobbyScreen';
import { CountdownScreen } from './components/CountdownScreen';
import { useMultiplayer } from './hooks/useMultiplayer';

export default function App() {
  const multi = useMultiplayer();

  let content: React.ReactNode;

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
        onAuthPlay={multi.authPlay}
        onClearAuthError={multi.clearAuthError}
        chatMessages={multi.messages}
        onSendMessage={multi.sendMessage}
      />
    );
  }

  return (
    <>
      {content}
      {multi.reconnecting && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 36 }}>📶</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>Reconnecting…</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', maxWidth: 260 }}>
            Your game is held for 60 seconds
          </div>
        </div>
      )}
    </>
  );
}
