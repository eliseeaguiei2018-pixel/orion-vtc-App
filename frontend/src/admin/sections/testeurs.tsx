import { useCallback, useEffect, useState } from 'react';
import { AdminError, LIVE, adminDel, adminGet, adminPost } from '../api';

/**
 * ACCÈS TESTEURS (direction) : connexion sans SMS, sur invitation.
 *
 * La direction ajoute le numéro d'un testeur ; le serveur lui attribue un code à 6 chiffres
 * que la direction lui transmet elle-même. Ce numéro se connecte avec ce code dans l'app
 * client ou chauffeur, à la place du code SMS. Les autres numéros restent soumis au SMS.
 */
interface Testeur {
  id: string; phone: string; nom: string; code: string;
  creeLe: string; creePar: string; expireLe: string;
  utilisations: number; derniereUtilisation: string | null; actif: boolean;
}

const date = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const numero = (p: string) => p.replace(/^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '+225 $1 $2 $3 $4 $5');

export function AccesTesteursSection() {
  const [liste, setListe] = useState<Testeur[]>([]);
  const [nom, setNom] = useState('');
  const [tel, setTel] = useState('');
  const [jours, setJours] = useState(7);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [copie, setCopie] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!LIVE) return;
    try { setListe((await adminGet<{ testeurs: Testeur[] }>('/admin/testeurs')).testeurs); } catch { /* affiché à l'action */ }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  const inviter = async (n: string, t: string) => {
    setErreur('');
    setEnvoi(true);
    try {
      await adminPost('/admin/testeurs', { nom: n.trim(), phone: t.trim(), jours });
      setNom(''); setTel('');
      await charger();
    } catch (e) {
      setErreur(e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu.');
    } finally {
      setEnvoi(false);
    }
  };
  const retirer = async (t: Testeur) => {
    setErreur('');
    try { await adminDel(`/admin/testeurs/${encodeURIComponent(t.phone)}`); await charger(); } catch (e) {
      setErreur(e instanceof AdminError ? e.message : 'Le serveur n’a pas répondu.');
    }
  };
  const copier = async (t: Testeur) => {
    try { await navigator.clipboard.writeText(t.code); setCopie(t.id); window.setTimeout(() => setCopie(null), 1500); } catch { /* sélection manuelle */ }
  };

  if (!LIVE) return null;
  const valide = nom.trim().length >= 2 && tel.replace(/\D/g, '').length >= 8;

  return (
    <div className="adm-card adm-testeurs">
      <div className="adm-card-h"><h3>Accès testeurs</h3></div>
      <p className="adm-muted" style={{ marginBottom: 12 }}>
        Tant que l’envoi des codes par SMS n’est pas activé : ajoutez le numéro d’un testeur, client ou chauffeur, puis
        transmettez-lui son code. Il le tape dans l’app à la place du code SMS. Ce code n’ouvre que le compte de ce numéro.
      </p>
      <form className="adm-testeurs-form" onSubmit={(e) => { e.preventDefault(); if (valide) void inviter(nom, tel); }}>
        <input className="adm-input" placeholder="Nom du testeur" value={nom} onChange={(e) => setNom(e.target.value)} />
        <input className="adm-input mono" inputMode="tel" placeholder="07 08 09 10 11" value={tel} onChange={(e) => setTel(e.target.value)} />
        <select className="adm-select" value={jours} onChange={(e) => setJours(Number(e.target.value))} aria-label="Durée de validité">
          <option value={1}>1 jour</option>
          <option value={7}>7 jours</option>
          <option value={30}>30 jours</option>
        </select>
        <button type="submit" className="adm-btn solid" disabled={!valide || envoi}>{envoi ? 'Création…' : 'Créer le code'}</button>
      </form>
      {erreur && <p className="adm-erreur" role="alert">{erreur}</p>}
      {liste.length > 0 && (
        <div className="adm-testeurs-liste">
          {liste.map((t) => (
            <div key={t.id} className={`adm-testeur${t.actif ? '' : ' expire'}`}>
              <div className="grow" style={{ minWidth: 0 }}>
                <strong>{t.nom}</strong>
                <div className="adm-muted mono" style={{ fontSize: 12 }}>{numero(t.phone)}</div>
                <div className="adm-muted" style={{ fontSize: 12 }}>
                  {t.actif ? `Valable jusqu’au ${date(t.expireLe)}` : 'Expiré'} · {t.utilisations ? `utilisé ${t.utilisations} fois` : 'pas encore utilisé'}
                </div>
              </div>
              <button type="button" className="adm-testeur-code mono" onClick={() => void copier(t)} title="Copier le code">
                {copie === t.id ? 'Copié' : t.code}
              </button>
              <div className="adm-testeur-actions">
                <button type="button" className="adm-btn xs" onClick={() => void inviter(t.nom, t.phone)}>Nouveau code</button>
                <button type="button" className="adm-btn xs" onClick={() => void retirer(t)}>Retirer</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
