import '../stockageSur';
import { confirmerDemarrage } from '../miseAJour';
// Mise à jour à chaud : confirmer tout de suite que cette version démarre (sinon retour à la précédente).
confirmerDemarrage();
import React from 'react';
import { enregistrerServiceWorker } from '../pwa';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../theme';
import { I18nProvider } from '../i18n';
import { DriverApp } from './Driver';
import { definirStyle } from '../components/Vehicules';
import '../polices.css';
import '../index.css';
import './driver.css';
import '../premium.css';
import { demarrerDiagnosticFluidite } from '../fps';

// Même style que l'app cliente 1.5.9 : objets de l'accueil aux matières naturelles (palette
// « vif »), icônes au trait partout ailleurs.
definirStyle({ icones: 'ios', accueil: 'vif' });

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
demarrerDiagnosticFluidite();
