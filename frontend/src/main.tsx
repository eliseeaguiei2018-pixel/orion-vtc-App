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
// aliments) — palette « vif » : les objets et les couleurs de la palette « urbain », en plus
// saturé. Autres jeux livrés : `accueil: 'urbain'`, `'nb'` (noir, gris et blanc) et `'couleur'`
// (vert, blanc et violet).
definirStyle({ icones: 'trait', accueil: 'vif' });

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
