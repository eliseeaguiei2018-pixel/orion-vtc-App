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

// Style de l'app cliente (version 1.5) : toutes les icônes des listes au trait, sans couleur ;
// tuiles de l'accueil en rendus noir, gris et blanc. Pour revenir à l'accueil vert, blanc et
// violet : `accueil: 'couleur'`.
definirStyle({ icones: 'trait', accueil: 'nb' });

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
