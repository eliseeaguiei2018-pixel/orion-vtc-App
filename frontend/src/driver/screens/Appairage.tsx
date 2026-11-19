import { useEffect, useRef, useState } from 'react';
import { LogoIcon } from '../../components/Logo';
import { tr } from '../i18n';
import type { DriverApp } from '../useDriver';

/**
 * ÉCRAN DE VÉHICULE — connexion par appairage.
 *
 * Sur l'écran large de la voiture, le chauffeur ne tape jamais ses identifiants. Il ouvre
 * « Connecter un écran de véhicule » sur son téléphone, qui affiche un code à six chiffres,
 * et le saisit ici. L'écran reçoit alors sa session, sans mot de passe sur un écran que
 * d'autres pourraient voir.
 */
export function Appairage({ app }: { app: DriverApp }) {
  const [code, setCode] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const cases = useRef<Array<HTMLInputElement | null>>([]);

  const chiffres = code.padEnd(6, ' ').slice(0, 6).split('');
  const majJ = (i: number, v: string) => {
    const c = v.replace(/\D/g, '').slice(-1);
    const prochain = (code.slice(0, i) + c + code.slice(i + 1)).replace(/\s/g, '').slice(0, 6);
    setCode(prochain);
    if (c && i < 5) cases.current[i + 1]?.focus();
    if (prochain.length === 6) void valider(prochain);
  };
  const coller = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 6);
    setCode(d);
    if (d.length === 6) void valider(d);
    else cases.current[d.length]?.focus();
  };

  const valider = async (saisi = code) => {
    if (saisi.length !== 6 || envoi) return;
    setEnvoi(true);
    const ok = await app.actions.appairerEcran(saisi);
    if (!ok) { setCode(''); cases.current[0]?.focus(); }
    setEnvoi(false);
  };

  return (
    <div className="veh-appairage">
      <div className="veh-appairage-carte">
        <LogoIcon size={64} />
        <h1>{tr('Écran de véhicule ORION')}</h1>
        <p>
          {tr('Sur votre téléphone, ouvrez l’app ORION Chauffeur, puis « Connecter un écran de véhicule ». Saisissez ici le code à 6 chiffres affiché.')}
        </p>
        <div className="veh-code" onPaste={(e) => { e.preventDefault(); coller(e.clipboardData.getData('text')); }}>
          {chiffres.map((c, i) => (
            <input
              key={i}
              ref={(el) => { cases.current[i] = el; }}
              className="veh-code-case"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={c.trim()}
              aria-label={tr('Chiffre {0}', [String(i + 1)])}
              autoFocus={i === 0}
              disabled={envoi}
              onChange={(e) => majJ(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Backspace' && !chiffres[i]?.trim() && i > 0) cases.current[i - 1]?.focus(); }}
            />
          ))}
        </div>
        <button className="btn btn-primary veh-grand-bouton" disabled={code.length !== 6 || envoi} onClick={() => void valider()}>
          {envoi ? tr('Connexion…') : tr('Connecter cet écran')}
        </button>
        <p className="veh-appairage-note">
          {tr('Le code est valable 3 minutes et ne sert qu’une fois. Aucun mot de passe n’est saisi sur cet écran.')}
        </p>
      </div>
    </div>
  );
}

/**
 * Côté TÉLÉPHONE (écran « Profil ») : « Connecter un écran de véhicule ». Le chauffeur
 * demande un code et le lit sur l'écran de la voiture. Le code expire au bout de 3 minutes.
 */
export function ConnecterEcranVehicule({ app }: { app: DriverApp }) {
  const [ouvert, setOuvert] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [reste, setReste] = useState(0);
  const [erreur, setErreur] = useState('');

  const demander = async () => {
    setErreur(''); setCode(null);
    setOuvert(true);
    try {
      const r = await app.backend.codeEcranVehicule();
      setCode(r.code);
      setReste(Math.max(0, Math.round((Date.parse(r.expireLe) - Date.now()) / 1000)));
    } catch {
      setErreur(tr('Impossible d’obtenir un code pour le moment.'));
    }
  };
  const fermer = () => { setOuvert(false); if (code) void app.backend.annulerCodeEcranVehicule().catch(() => {}); setCode(null); };

  // Compte à rebours de validité du code (3 minutes), tant que la fenêtre est ouverte.
  useEffect(() => {
    if (!ouvert || reste <= 0) return;
    const t = setTimeout(() => setReste((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(t);
  }, [ouvert, reste]);

  return (
    <>
      <button className="btn btn-ghost" onClick={() => void demander()}>🚗 {tr('Connecter un écran de véhicule')}</button>
      {ouvert && (
        <div className="dv-modal-back" onClick={fermer}>
          <div className="dv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tr('Connecter un écran de véhicule')}>
            <h2 className="dv-section-title">{tr('Connecter un écran de véhicule')}</h2>
            <p className="faint" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              {tr('Sur l’écran de la voiture, ouvrez ORION Chauffeur puis saisissez ce code :')}
            </p>
            {erreur && <div className="dv-banner danger">{erreur}</div>}
            {code && <div className="veh-code-affiche">{code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div>}
            {code && <div className="veh-code-expire">{reste > 0 ? tr('Valable encore {0} s', [String(reste)]) : tr('Code expiré — rouvrez pour en obtenir un nouveau.')}</div>}
            {!code && !erreur && <div className="veh-code-affiche" style={{ opacity: 0.4 }}>• • • • • •</div>}
            <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={fermer}>{tr('Fermer')}</button>
          </div>
        </div>
      )}
    </>
  );
}
