import React from 'react';
import { enregistrerServiceWorker } from '../pwa';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../theme';
import { I18nProvider } from '../i18n';
import { DriverApp } from './Driver';
import '../index.css';
import './driver.css';

ReactDOM.createRoot(document.getElementById('driver-root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {/* Même langue que l'app cliente (8 langues, choix mémorisé sur le téléphone). */}
      <I18nProvider>
        <DriverApp />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

// Application web installable : écran d'accueil du téléphone, tablette, écran de bord.
enregistrerServiceWorker();
