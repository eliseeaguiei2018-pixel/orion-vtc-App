import { useCallback, useEffect, useState } from 'react';
import { changerDeCompte, demanderAcces, lireMonAcces, NonConnecte, type MonAcces } from './donnees';

/**
 * ACCÈS RÉSERVÉ : ce que voit une personne connectée qui n'a pas le droit d'ouvrir le
 * tableau de bord. Un manager peut y demander l'accès : la demande part au service
 * informatique, qui la transmet à la direction. L'écran vérifie régulièrement (toutes les
 * 10 secondes tant qu'une demande est en cours) si l'accès est accordé, et s'ouvre alors
 * de lui-même.
 */

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export function AccesReserve({ onAcces, onConnexion }: { onAcces: () => void; onConnexion: () => void }) {
  const [moi, setMoi] = useState<MonAcces | null>(null);
  const [motif, setMotif] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');

  const relire = useCallback(async () => {
    try {
      const m = await lireMonAcces();
      if (m.acces) { onAcces(); return; }
      setMoi(m);
    } catch (e) {
      if (e instanceof NonConnecte) onConnexion();
    }
  }, [onAcces, onConnexion]);

  // Demande en cours : on vérifie plus souvent, l'écran s'ouvre vite après l'accord.
  const enAttente = moi?.habilitation?.statut === 'demandee' || moi?.habilitation?.statut === 'transmise';
  useEffect(() => {
    void relire();
  }, [relire]);
  useEffect(() => {
    const t = window.setInterval(() => void relire(), enAttente ? 10_000 : 30_000);
    return () => window.clearInterval(t);
  }, [relire, enAttente]);

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true); setErreur('');
    const err = await demanderAcces(motif.trim());
    if (err) setErreur(err); else { setMotif(''); await relire(); }
    setEnvoi(false);
  };
  const changer = async () => { await changerDeCompte(); onConnexion(); };

  const h = moi?.habilitation ?? null;
  const enCours = h && (h.statut === 'demandee' || h.statut === 'transmise');
  const peutDemander = Boolean(moi?.habilitable && !enCours);

  return (
    <div className="tb-connexion">
      <div className="tb-connexion-carte tb-reserve" role="alert" aria-live="polite">
        <span className="tb-logo grand tb-cadenas" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#04140d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        </span>
        <h1>Accès réservé</h1>
        <p>
          Le tableau de bord ORION est réservé à la direction générale, à la direction financière, à la
          direction des affaires administratives, à la direction des opérations, à la trésorerie, à la
          comptabilité et au service informatique.
        </p>
        {moi && <p className="tb-reserve-qui">Connecté : <strong>{moi.nom}</strong> · {moi.roleLabel}</p>}

        {moi && !moi.habilitable && (
          <p className="tb-reserve-note">Votre fonction ne donne pas accès au tableau de bord. Cette tentative a été enregistrée et signalée à la direction.</p>
        )}

        {moi?.habilitable && (
          <div className="tb-reserve-etat">
            {!h && <p>En tant que manager, vous pouvez demander une habilitation. Elle passe par le service informatique, puis par la direction, qui l’accorde ou la refuse.</p>}
            {h?.statut === 'demandee' && <EtapeDemande titre="Demande envoyée" texte={`Le ${date(h.demandeLe)}. Le service informatique va la vérifier et la transmettre à la direction.`} etape={1} />}
            {h?.statut === 'transmise' && <EtapeDemande titre="Transmise à la direction" texte={`Le ${date(h.transmiseLe)}, par ${h.transmisePar}. Vous serez prévenu dans votre messagerie ORION dès la décision.`} etape={2} />}
            {h?.statut === 'refusee' && <p className="tb-reserve-refus">Demande refusée le {date(h.decisionLe)} par {h.decisionPar}{h.raison ? <> : « {h.raison} »</> : ''}. Vous pouvez en déposer une nouvelle.</p>}
            {h?.statut === 'revoquee' && <p className="tb-reserve-refus">Votre accès a été retiré{h.raison ? <> : « {h.raison} »</> : ''}. Vous pouvez en redemander un.</p>}
            {h?.statut === 'accordee' && h.expiree && <p className="tb-reserve-refus">Votre habilitation a pris fin le {date(h.expireLe)}. Vous pouvez en demander une nouvelle.</p>}
          </div>
        )}

        {peutDemander && (
          <form onSubmit={envoyer}>
            <label>Pourquoi en avez-vous besoin ?
              <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={3} maxLength={500}
                placeholder="Exemple : suivre les commandes de mon équipe aux heures de pointe." />
            </label>
            {erreur && <p className="tb-connexion-err" role="alert">{erreur}</p>}
            <button type="submit" disabled={envoi || motif.trim().length < 10}>{envoi ? 'Envoi…' : 'Demander l’accès à la direction'}</button>
          </form>
        )}

        <div className="tb-reserve-actions">
          <a href="./admin.html">Retour à la console</a>
          <button type="button" onClick={() => void changer()}>Changer de compte</button>
        </div>
      </div>
    </div>
  );
}

function EtapeDemande({ titre, texte, etape }: { titre: string; texte: string; etape: 1 | 2 }) {
  return (
    <div className="tb-reserve-suivi">
      <ol aria-label="Étapes de l’habilitation">
        <li className="fait">Demande</li>
        <li className={etape >= 2 ? 'fait' : 'encours'}>Service informatique</li>
        <li className={etape >= 2 ? 'encours' : ''}>Direction</li>
      </ol>
      <p><strong>{titre}.</strong> {texte}</p>
    </div>
  );
}
