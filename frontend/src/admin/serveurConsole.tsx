import { useState } from 'react';
import { API } from './api';
import { reglerServeurApp, serveurDeConstruction, serveurRegleDansApp } from '../serveur';

const hote = (u: string) => { try { return new URL(u).host; } catch { return u; } };

/** « orion.exemple.ci » → « https://orion.exemple.ci » ; null si l'adresse n'en est pas une. */
function normaliser(saisie: string): string | null {
  const brut = saisie.trim().replace(/\/+$/, '');
  if (!brut) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`);
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

/**
 * SERVEUR ORION (application console sur téléphone) : l'adresse du serveur, modifiable si
 * l'hébergement change. L'adresse est vérifiée (c'est bien un serveur ORION ?) avant d'être
 * retenue, puis l'application redémarre.
 */
export function ServeurConsole() {
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState(API);
  const [etat, setEtat] = useState<'repos' | 'test' | 'ok'>('repos');
  const [erreur, setErreur] = useState('');

  const relier = async () => {
    setErreur('');
    const url = normaliser(saisie);
    if (!url) { setErreur('Adresse invalide (exemple : https://orion-backend.onrender.com).'); return; }
    setEtat('test');
    try {
      const lire = async (chemin: string) => {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 9000);
        try { const r = await fetch(`${url}${chemin}`, { signal: ctrl.signal }); return r.ok ? await r.json() : null; } finally { window.clearTimeout(t); }
      };
      // Un hébergement en veille met quelques secondes à se réveiller : deux essais.
      const pret = (await lire('/health/ready').catch(() => null)) ?? (await lire('/health/ready'));
      const config = await lire('/config') as { services?: unknown } | null;
      if (!pret || !config || typeof config.services !== 'object') { setEtat('repos'); setErreur('Ce n’est pas un serveur ORION.'); return; }
      setEtat('ok');
      window.setTimeout(() => reglerServeurApp(url === serveurDeConstruction() ? null : url), 900);
    } catch {
      setEtat('repos'); setErreur('Serveur injoignable. Vérifiez l’adresse et la connexion.');
    }
  };

  return (
    <div className="adm-serveur">
      <button type="button" className="adm-serveur-lien" onClick={() => setOuvert((o) => !o)}>
        <i className={`adm-serveur-point${API ? ' on' : ''}`} aria-hidden="true" />
        Serveur ORION · {API ? hote(API) : 'non relié'}
      </button>
      {ouvert && (
        <div className="adm-serveur-form">
          <input className="adm-login-input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="https://orion-backend.onrender.com" value={saisie} onChange={(e) => { setSaisie(e.target.value); setErreur(''); }} />
          {erreur && <div className="adm-login-err" role="alert">{erreur}</div>}
          {etat === 'ok' && <div className="adm-muted" role="status">Serveur ORION vérifié : l’application redémarre…</div>}
          <button type="button" className="adm-btn solid" disabled={etat !== 'repos' || !saisie.trim()} onClick={() => void relier()}>
            {etat === 'test' ? 'Vérification…' : 'Tester et relier'}
          </button>
          {serveurRegleDansApp() && <button type="button" className="adm-serveur-lien" onClick={() => reglerServeurApp(null)}>Revenir au serveur d’origine</button>}
        </div>
      )}
    </div>
  );
}
