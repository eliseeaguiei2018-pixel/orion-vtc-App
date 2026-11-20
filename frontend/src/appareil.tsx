import { useEffect, useState } from 'react';
import { serveurActif } from './serveur';

/**
 * APPAREIL DE CONFIANCE : enrôlement de la console et du tableau de bord avec le code de
 * synchronisation ORION, sur Windows, macOS, tablette, téléphone ou navigateur.
 *
 * Le code est saisi une seule fois par appareil. Le serveur répond par une clé propre à
 * l'appareil, posée dans un cookie HttpOnly : aucun script de la page ne peut la lire, et
 * elle accompagne d'elle-même chaque requête. L'appareil apparaît alors dans la console
 * (section Sessions), d'où il peut être révoqué.
 */
const API = serveurActif();

export type Plateforme = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'harmonyos' | 'web';
export interface AppareilPublic {
  id: string; nom: string; plateforme: Plateforme; application: 'console' | 'tableau' | 'chauffeur';
  enroleLe: string; derniereActivite?: string; dernierCompte?: string; derniereIp?: string;
  revoqueLe?: string; revoquePar?: string; actif: boolean;
}
export interface EtatAppareil { configure: boolean; exige: boolean; appareil: AppareilPublic | null }

/** Application de bureau ORION (Windows, macOS) ou application mobile : enrôlement d'office. */
export function estAppEmballee(): boolean {
  const w = window as unknown as { orionBureau?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  return Boolean(w.orionBureau) || Boolean(w.Capacitor?.isNativePlatform?.());
}

/** Plateforme de l'appareil, d'après le navigateur (ou l'application de bureau). */
export function plateformeDetectee(): Plateforme {
  const ua = navigator.userAgent;
  if (/HarmonyOS|OpenHarmony|ArkWeb/i.test(ua)) return 'harmonyos';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

export const NOM_PLATEFORME: Record<Plateforme, string> = {
  windows: 'Windows', macos: 'macOS', linux: 'Linux', ios: 'iPhone / iPad', android: 'Android', harmonyos: 'HarmonyOS', web: 'Navigateur',
};

/** Nom proposé par défaut : « Ordinateur Windows », « iPad », « Tablette Android »… */
function nomParDefaut(p: Plateforme): string {
  if (p === 'windows' || p === 'macos' || p === 'linux') return `Ordinateur ${NOM_PLATEFORME[p]}`;
  if (p === 'web') return 'Navigateur';
  // Un iPad récent se présente comme un Mac tactile : il n'a pas « iPhone » dans sa signature.
  if (p === 'ios') return /iPhone|iPod/i.test(navigator.userAgent) ? 'iPhone' : 'iPad';
  const tablette = Math.min(screen.width, screen.height) >= 600;
  return `${tablette ? 'Tablette' : 'Téléphone'} ${NOM_PLATEFORME[p]}`;
}

export async function lireEtatAppareil(): Promise<EtatAppareil | null> {
  if (!API && (import.meta.env.VITE_SAME_ORIGIN as string | undefined) !== '1') return null; // mode démonstration
  try {
    const r = await fetch(`${API}/appareils/etat`, { credentials: 'include' });
    return r.ok ? ((await r.json()) as EtatAppareil) : null;
  } catch { return null; }
}

export function useEtatAppareil(): [EtatAppareil | null, () => void] {
  const [etat, setEtat] = useState<EtatAppareil | null>(null);
  const [tour, setTour] = useState(0);
  useEffect(() => { void lireEtatAppareil().then(setEtat); }, [tour]);
  return [etat, () => setTour((t) => t + 1)];
}

/** Classes CSS de l'interface hôte (console ou tableau de bord). */
export interface ClassesFormulaire { carte: string; titre?: string; sous: string; label: string; champ: string; bouton: string; erreur: string; lien: string }

export function EnrolementAppareil({ application, classes, onEnrole, onRetour, logo }: {
  application: 'console' | 'tableau';
  classes: ClassesFormulaire;
  onEnrole: (a: AppareilPublic) => void;
  onRetour?: () => void;
  logo?: React.ReactNode;
}) {
  const plateforme = plateformeDetectee();
  const [code, setCode] = useState('');
  const [nom, setNom] = useState(() => nomParDefaut(plateforme));
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [voir, setVoir] = useState(false);

  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || nom.trim().length < 2) { setErreur('Saisissez le code de synchronisation et un nom pour cet appareil.'); return; }
    setEnvoi(true); setErreur('');
    try {
      const r = await fetch(`${API}/appareils/enroler`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, nom: nom.trim(), plateforme, application }),
      });
      const data = await r.json().catch(() => ({})) as { appareil?: AppareilPublic; error?: { message?: string } };
      if (!r.ok || !data.appareil) { setErreur(data.error?.message ?? 'Enrôlement refusé.'); setEnvoi(false); return; }
      setCode('');
      onEnrole(data.appareil);
    } catch {
      setErreur('Serveur injoignable. Réessayez dans un instant.');
      setEnvoi(false);
    }
  };

  return (
    <form className={classes.carte} onSubmit={valider} data-testid="enrolement-appareil">
      {logo}
      <h1 className={classes.titre}>Enrôler cet appareil</h1>
      <p className={classes.sous}>
        Saisissez le <strong>code de synchronisation ORION</strong>, une seule fois sur cet appareil. Vos identifiants personnels vous seront ensuite demandés à chaque connexion.
      </p>
      <label className={classes.label} htmlFor="code-synchro">Code de synchronisation</label>
      <div style={{ position: 'relative' }}>
        <input id="code-synchro" className={classes.champ} type={voir ? 'text' : 'password'} value={code} onChange={(e) => setCode(e.target.value)}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus placeholder="Fourni par la direction ORION" style={{ paddingRight: 70, width: '100%' }} />
        <button type="button" className={classes.lien} onClick={() => setVoir((v) => !v)} aria-label={voir ? 'Masquer le code' : 'Afficher le code'}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>{voir ? 'Masquer' : 'Afficher'}</button>
      </div>
      <label className={classes.label} htmlFor="nom-appareil" style={{ marginTop: 10 }}>Nom de cet appareil</label>
      <input id="nom-appareil" className={classes.champ} value={nom} onChange={(e) => setNom(e.target.value)} maxLength={60} />
      <p className={classes.sous} style={{ fontSize: 12, marginTop: 6 }}>
        {NOM_PLATEFORME[plateforme]} · {application === 'console' ? 'Console' : 'Tableau de bord'} · le nom apparaît dans la liste des appareils, d’où la direction peut le révoquer.
      </p>
      {erreur && <div className={classes.erreur} role="alert">{erreur}</div>}
      <button className={classes.bouton} type="submit" disabled={envoi}>{envoi ? 'Vérification…' : 'Enrôler cet appareil'}</button>
      {onRetour && <button type="button" className={classes.lien} onClick={onRetour} style={{ marginTop: 10 }}>Retour à la connexion</button>}
    </form>
  );
}

/** Ligne discrète sous le formulaire de connexion : l'appareil, ou l'invitation à l'enrôler. */
export function LigneAppareil({ etat, classe, onEnroler }: { etat: EtatAppareil | null; classe: string; onEnroler: () => void }) {
  if (!etat || !etat.configure) return null;
  if (etat.appareil) {
    return <p className={classe} data-testid="appareil-enrole">Appareil de confiance : <strong>{etat.appareil.nom}</strong> · enrôlé le {new Date(etat.appareil.enroleLe).toLocaleDateString('fr-FR')}</p>;
  }
  return <p className={classe}>Appareil non enrôlé · <button type="button" onClick={onEnroler} style={{ background: 'none', border: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>Enrôler avec le code de synchronisation</button></p>;
}
