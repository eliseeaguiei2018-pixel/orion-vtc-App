import React from 'react';
import { enregistrerServiceWorker } from '../pwa';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../theme';
import { DriverApp } from './Driver';
import '../index.css';
import './driver.css';

ReactDOM.createRoot(document.getElementById('driver-root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <DriverApp />
    </ThemeProvider>
  </React.StrictMode>,
);

// Application web installable : écran d'accueil du téléphone, tablette, écran de bord.
enregistrerServiceWorker();
