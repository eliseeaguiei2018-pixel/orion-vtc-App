import './stockageSur';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import './polices.css';
import './index.css';
import './premium.css';
import { demarrerDiagnosticFluidite } from './fps';
import { definirStyle } from './components/Vehicules';

// Style de l'app cliente : toutes les icônes des listes au trait, sans couleur ; à l'accueil,
// des objets en volume sur une base neutre, où la couleur vient des matières (kraft, or, cuir,
// aliments) — palette « urbain ». Autres jeux livrés : `accueil: 'nb'` (noir, gris et blanc)
// et `accueil: 'couleur'` (vert, blanc et violet).
definirStyle({ icones: 'trait', accueil: 'urbain' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

demarrerDiagnosticFluidite();
