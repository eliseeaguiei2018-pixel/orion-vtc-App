import React from 'react';
import ReactDOM from 'react-dom/client';
import { Admin } from './Admin';
import './admin.css';
import '../premium.css';
import { demarrerDiagnosticFluidite } from '../fps';

ReactDOM.createRoot(document.getElementById('admin-root')!).render(
  <React.StrictMode>
    <Admin />
  </React.StrictMode>,
);

demarrerDiagnosticFluidite();
