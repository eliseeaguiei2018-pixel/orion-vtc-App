import { useState } from 'react';
import { IconCalendar, IconCheck, IconPhone, IconPin } from '../../icons';
import { lienTel, numeroLisible } from '../../telephone';
import type { DriverApp } from '../useDriver';
import type { EtapeLocation, LocationChauffeur } from '../types';
import { Banner } from '../ui';
import { dateTime } from '../format';

const FORMULE: Record<LocationChauffeur['formula'], string> = {
  evenement: 'Événement & mariage', entreprise: 'Entreprise & institution', mise_a_disposition: 'Mise à disposition',
};
const STATUT: Record<LocationChauffeur['status'], { label: string; ton: string }> = {
  devis: { label: 'Devis', ton: '' }, reservee: { label: 'Réservée', ton: 'gold' }, confirmee: { label: 'Confirmée', ton: 'green' },
  en_cours: { label: 'En cours', ton: 'green' }, terminee: { label: 'Terminée', ton: '' }, annulee: { label: 'Annulée', ton: 'danger' },
};
/** Options qui demandent une PRÉPARATION du véhicule ou de l'accueil (libellés console). */
const OPTIONS: Record<string, string> = {
  decoration: 'Décoration florale & rubans', tapisRouge: 'Tapis rouge', rafraichissements: 'Rafraîchissements à bord',
  plaque: 'Plaque personnalisée', escorte: 'Véhicule ouvreur & sécurité', hotesses: 'Hôtesses d’accueil',
  cortege: 'Véhicules de cortège', secondChauffeur: 'Second chauffeur (relais)', kilometrageIllimite: 'Kilométrage illimité',
};
const ETAPES: Array<{ id: EtapeLocation; label: string }> = [
  { id: 'vehicule_prepare', label: 'Véhicule préparé' },
  { id: 'en_route', label: 'En route' },
  { id: 'sur_place', label: 'Sur place' },
  { id: 'debut_service', label: 'Début de service' },
  { id: 'fin_service', label: 'Fin de service' },
];

/**
 * MES LOCATIONS SIGNATURE — affectées par la console (session Location). Le chauffeur
 * y trouve la prestation à assurer (jamais le prix facturé au client) : véhicule,
 * période, lieu, contact sur place, options à préparer, et déclare ses étapes.
 */
export function Rentals({ app }: { app: DriverApp }) {
  const actives = app.rentals.filter((r) => r.status !== 'terminee' && r.status !== 'annulee');
  const passees = app.rentals.filter((r) => r.status === 'terminee' || r.status === 'annulee');
  if (app.rentals.length === 0) {
    return <div className="dv-empty">Aucune location Signature ne vous est confiée pour le moment. La console ORION vous préviendra ici dès une affectation.</div>;
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      {actives.map((r) => <Location key={r.id} app={app} r={r} />)}
      {passees.length > 0 && <div className="eyebrow" style={{ marginTop: 6 }}>Terminées / annulées</div>}
      {passees.map((r) => <Location key={r.id} app={app} r={r} />)}
    </div>
  );
}

function Location({ app, r }: { app: DriverApp; r: LocationChauffeur }) {
  const [ouvert, setOuvert] = useState(r.status === 'confirmee' || r.status === 'en_cours');
  const options = Object.entries(r.options).filter(([, v]) => v === true || (typeof v === 'number' && v > 0));
  const faites = new Set(r.etapes.map((e) => e.etape));
  const prochaine = ETAPES.find((e) => !faites.has(e.id) && (e.id !== 'fin_service' || faites.has('debut_service')));
  const close = r.status === 'terminee' || r.status === 'annulee';
  const st = STATUT[r.status];
  return (
    <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button className="row between" style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, cursor: 'pointer', textAlign: 'start' }} onClick={() => setOuvert(!ouvert)}>
        <div>
          <div className="eyebrow">{FORMULE[r.formula]}{r.jourJ ? ' · aujourd’hui' : ''}</div>
          <div className="dv-item-title" style={{ fontSize: 16 }}>💎 {r.vehicle.name}</div>
          <div className="dv-item-sub"><IconCalendar size={12} /> {dateTime(r.debut)} → {dateTime(r.fin)}</div>
        </div>
        <span className={`dv-pill ${st.ton}`}>{st.label}</span>
      </button>
      {ouvert && (
        <>
          {r.lieu && <div className="row" style={{ gap: 8, fontSize: 14 }}><IconPin size={16} /> {r.lieu}</div>}
          {r.contact && (
            <div className="row between" style={{ fontSize: 14 }}>
              <span>Contact sur place : <strong>{r.contact.nom}</strong></span>
              {lienTel(r.contact.telephone) && <a className="dv-pill green" href={lienTel(r.contact.telephone)!} aria-label={`Appeler ${r.contact.nom} ${numeroLisible(r.contact.telephone)}`}><IconPhone size={13} /> Appeler</a>}
            </div>
          )}
          {r.societe && <div className="faint" style={{ fontSize: 13 }}>Société : {r.societe.nom}{r.societe.bonCommande ? ` · bon de commande ${r.societe.bonCommande}` : ''}</div>}
          <div className="faint" style={{ fontSize: 13 }}>
            {r.heuresService} h de service{r.kmInclus ? ` · ${r.kmInclus} km inclus par jour` : ' · kilométrage illimité'}{r.secondChauffeurRequis ? ' · relais par un second chauffeur' : ''}
          </div>
          {options.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <strong style={{ fontSize: 13 }}>À préparer</strong>
              {options.map(([k, v]) => (
                <span key={k} className="row" style={{ gap: 6, fontSize: 13 }}><IconCheck size={14} /> {OPTIONS[k] ?? k}{typeof v === 'number' ? ` × ${v}` : ''}</span>
              ))}
            </div>
          )}
          <div className="dv-steps" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }} aria-label="Étapes déclarées">
            {ETAPES.map((e) => <span key={e.id} className={faites.has(e.id) ? 'done' : ''} title={e.label} />)}
          </div>
          {r.etapes.length > 0 && (
            <div className="faint" style={{ fontSize: 12 }}>
              {r.etapes.map((e) => `${ETAPES.find((x) => x.id === e.etape)?.label ?? e.etape} (${new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`).join(' · ')}
            </div>
          )}
          {!close && prochaine && (
            <button className="btn btn-primary" disabled={app.busy} onClick={() => void app.actions.rentalStep(r.id, prochaine.id)}>
              Déclarer : {prochaine.label}
            </button>
          )}
          {r.status === 'reservee' && <Banner tone="info" title="En attente de confirmation">ORION confirme la réservation avec le client ; vous serez prévenu.</Banner>}
        </>
      )}
    </div>
  );
}
