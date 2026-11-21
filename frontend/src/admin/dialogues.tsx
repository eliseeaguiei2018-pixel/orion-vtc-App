import { useEffect, useRef, useState } from 'react';
import { rechercherLieux } from '../lieux';
import type { Place } from '../types';
import { Objet } from '../components/Vehicules';

/**
 * DIALOGUES DE LA CONSOLE — messages et saisies affichés DANS la page.
 *
 * La console utilisait `alert()` et `prompt()` du navigateur. Ces fenêtres bloquent tout,
 * n'ont pas l'apparence d'ORION, et ne s'affichent pas du tout quand la console est
 * intégrée à une autre page (lien partageable, aperçu) : l'action paraissait sans effet.
 *
 *   avis('…')                  → message bref, en bas à droite, qui s'efface seul
 *   await demander('…', 'x')   → saisie d'un texte ; null si l'on annule
 *   await demanderLieu('…')    → choix d'un lieu dans les 48 924 lieux de la carte
 */
type Demande =
  | { genre: 'texte'; id: number; message: string; defaut: string; resoudre: (v: string | null) => void }
  | { genre: 'lieu'; id: number; message: string; resoudre: (v: Place | null) => void };
interface Avis { id: number; message: string }

let poser: ((d: Demande) => void) | null = null;
let afficher: ((a: Avis) => void) | null = null;
let compteur = 0;

export function avis(message: unknown): void {
  const a = { id: ++compteur, message: String(message) };
  if (afficher) afficher(a);
}
export function demander(message: string, defaut = ''): Promise<string | null> {
  return new Promise((resoudre) => {
    if (poser) poser({ genre: 'texte', id: ++compteur, message, defaut, resoudre }); else resoudre(null);
  });
}
export function demanderLieu(message: string): Promise<Place | null> {
  return new Promise((resoudre) => {
    if (poser) poser({ genre: 'lieu', id: ++compteur, message, resoudre }); else resoudre(null);
  });
}

/** À monter une fois, à la racine de la console. */
export function Dialogues() {
  const [file, setFile] = useState<Demande[]>([]);
  const [liste, setListe] = useState<Avis[]>([]);
  useEffect(() => {
    poser = (d) => setFile((f) => [...f, d]);
    afficher = (a) => {
      setListe((l) => [...l.slice(-3), a]);
      window.setTimeout(() => setListe((l) => l.filter((x) => x.id !== a.id)), 6500);
    };
    return () => { poser = null; afficher = null; };
  }, []);
  const d = file[0];
  const suivant = () => setFile((f) => f.slice(1));
  return (
    <>
      {d?.genre === 'texte' && <Saisie key={d.id} demande={d} clore={(v) => { d.resoudre(v); suivant(); }} />}
      {d?.genre === 'lieu' && <ChoixLieu key={d.id} message={d.message} clore={(v) => { d.resoudre(v); suivant(); }} />}
      <div className="adm-avis-pile" role="status" aria-live="polite">
        {liste.map((a) => (
          <div key={a.id} className="adm-avis">
            <span>{a.message}</span>
            <button type="button" aria-label="Fermer" onClick={() => setListe((l) => l.filter((x) => x.id !== a.id))}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}

function Saisie({ demande, clore }: { demande: Extract<Demande, { genre: 'texte' }>; clore: (v: string | null) => void }) {
  const [valeur, setValeur] = useState(demande.defaut);
  const [titre, ...suite] = demande.message.split('\n').filter((l) => l.trim());
  // Une question longue ou sur plusieurs lignes appelle une réponse rédigée.
  const long = suite.length > 0 || /rapport|circonstance|justification|message|réponse|motif|note|reprendre/i.test(demande.message);
  return (
    <div className="adm-modal-wrap" onKeyDown={(e) => { if (e.key === 'Escape') clore(null); }}>
      <form className="adm-modal adm-dialogue" role="dialog" aria-modal="true" aria-label={titre} onSubmit={(e) => { e.preventDefault(); clore(valeur); }}>
        <h3>{titre}</h3>
        {suite.map((l, i) => <p key={i} className="adm-muted">{l}</p>)}
        {long
          ? <textarea className="adm-input" rows={4} autoFocus value={valeur} onChange={(e) => setValeur(e.target.value)} aria-label={titre} />
          : <input className="adm-input" autoFocus value={valeur} onChange={(e) => setValeur(e.target.value)} aria-label={titre} />}
        <div className="adm-dialogue-actions">
          <button type="button" className="adm-btn" onClick={() => clore(null)}>Annuler</button>
          <button type="submit" className="adm-btn solid">Valider</button>
        </div>
      </form>
    </div>
  );
}

function ChoixLieu({ message, clore }: { message: string; clore: (v: Place | null) => void }) {
  const [q, setQ] = useState('');
  const [lieux, setLieux] = useState<Place[]>([]);
  const [cherche, setCherche] = useState(false);
  const tour = useRef(0);
  useEffect(() => {
    const requete = q.trim();
    if (requete.length < 2) { setLieux([]); return; }
    const moi = ++tour.current;
    setCherche(true);
    const id = window.setTimeout(() => {
      void rechercherLieux(requete).then((r) => { if (moi === tour.current) { setLieux(r); setCherche(false); } }).catch(() => { if (moi === tour.current) setCherche(false); });
    }, 180);
    return () => window.clearTimeout(id);
  }, [q]);
  return (
    <div className="adm-modal-wrap" onKeyDown={(e) => { if (e.key === 'Escape') clore(null); }}>
      <div className="adm-modal adm-dialogue" role="dialog" aria-modal="true" aria-label={message}>
        <h3>{message}</h3>
        <input className="adm-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Quartier, rue, commerce, banque, école…" aria-label="Rechercher un lieu" />
        <div className="adm-lieux">
          {lieux.map((l) => (
            <button key={l.id} type="button" className="adm-lieu" onClick={() => clore(l)}>
              <Objet nom="destination" taille={26} />
              <span><strong>{l.name}</strong><small>{l.area}</small></span>
            </button>
          ))}
          {q.trim().length >= 2 && !cherche && lieux.length === 0 && <p className="adm-muted">Aucun lieu trouvé pour « {q.trim()} ».</p>}
          {q.trim().length < 2 && <p className="adm-muted">Tapez au moins deux lettres : la recherche porte sur les 48 924 lieux du district d’Abidjan.</p>}
        </div>
        <div className="adm-dialogue-actions">
          <button type="button" className="adm-btn" onClick={() => clore(null)}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
