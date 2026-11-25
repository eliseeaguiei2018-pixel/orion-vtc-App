import '../stockageSur';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '../theme';
import { I18nProvider } from '../i18n';
import { ConsoleTest } from './ConsoleTest';
import '../polices.css';
import '../index.css';
import './console-test.css';

ReactDOM.createRoot(document.getElementById('console-test-root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ConsoleTest />
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
