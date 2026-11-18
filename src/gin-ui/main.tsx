import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GinApp from './GinApp';
import DeckPreview from './DeckPreview';
import './gin.css';

// ?deck shows every face at once -- a proofing aid for the artwork, not a route
// anybody reaches by accident.
const showDeck = new URLSearchParams(window.location.search).has('deck');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{showDeck ? <DeckPreview /> : <GinApp />}</StrictMode>
);
