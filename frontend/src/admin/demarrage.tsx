import React from 'react';
import ReactDOM from 'react-dom/client';
import { Admin } from './Admin';
import { Dialogues } from './dialogues';
import './admin.css';
import '../premium.css';
import { demarrerDiagnosticFluidite } from '../fps';

ReactDOM.createRoot(document.getElementById('admin-root')!).render(
  <React.StrictMode>
    <Admin />
    <Dialogues />
  </React.StrictMode>,
);

demarrerDiagnosticFluidite();
