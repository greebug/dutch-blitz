import React from 'react';
import { GameBoard } from './components/GameBoard';
import { MultiLobbyScreen } from './components/MultiLobbyScreen';
import { CountdownScreen } from './components/CountdownScreen';
import { useMultiplayer } from './hooks/useMultiplayer';

export default function App() {
  const multi = useMultiplayer();

  // Countdown overlay — shown while server counts down before first broadcast
  if (multi.countdown !== null) {
    return <CountdownScreen count={multi.countdown} />;
  }

  if (multi.phase === 'playing' && multi.gameState) {
    return (
      <GameBoard
        state={multi.gameState}
        dispatch={multi.dispatch}
        myPlayerId={multi.myPlayerId ?? undefined}
      />
    );
  }

  return (
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
