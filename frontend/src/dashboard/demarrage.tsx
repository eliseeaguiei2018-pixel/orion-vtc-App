import React from 'react';
import ReactDOM from 'react-dom/client';
import { Tableau } from './Dashboard';
import './dashboard.css';
import '../premium.css';
import { demarrerDiagnosticFluidite } from '../fps';

ReactDOM.createRoot(document.getElementById('tableau-root')!).render(
  <React.StrictMode>
    <Tableau />
  </React.StrictMode>,
);

demarrerDiagnosticFluidite();
