import { useEffect, useMemo, useState } from 'react';
import { TopBar } from './ui';
import { PhotoVehicule, MedaillonGamme, photoDuModele, photoDisponible, type IdPhoto } from './PhotosVehicules';
import {
  IconCalendar, IconCar, IconCheck, IconClock, IconCrown, IconLeaf, IconMinus, IconPin,
  IconPlus, IconUsers,
} from '../icons';
import { useI18n } from '../i18n';
import { formatXOF, RENTAL_DUREES, RENTAL_FORMULES, RENTAL_OPTION_KEYS } from '../data';

/**
 * Options pertinentes par formule. Proposer « décoration florale & rubans » à une
 * délégation qui réserve une berline pour trois heures n'a pas de sens — et chaque
 * option inutile est une case de plus à comprendre avant de réserver.
 */
const OPTIONS_PAR_FORMULE: Record<RentalFormula, readonly string[]> = {
  evenement: RENTAL_OPTION_KEYS,
  entreprise: ['tapisRouge', 'plaque', 'rafraichissements', 'escorte', 'kilometrageIllimite'],
  mise_a_disposition: ['rafraichissements', 'escorte', 'kilometrageIllimite'],
};
import {
  cancelRental, clientId, fetchRentalAvailability, fetchRentalCatalogue, listMyRentals,
  onRentalTariffChange, quoteRental, reserveRental, type RentalCatalogue,
} from '../api';
import type {
  PrestigeVehicle, RentalAvailability, RentalDuree, RentalFormula, RentalOptions, RentalQuote,
  RentalReservation, RentalStatus,
} from '../types';

/**
 * LOCATION ORION — écran client.
 *
 * Le barème, la disponibilité réelle de la flotte et le délai de mise à disposition
 * viennent du serveur : rien n'est recalculé « à peu près » à l'écran, pour que le prix
 * affiché soit exactement celui qui sera facturé. Hors ligne, un repli local prend le
 * relais avec le même barème, et l'écran le dit.
 */

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
const HEURE_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Valeur `datetime-local` (heure locale, pas UTC — sinon le champ décale la date). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Le véhicule illustré : berline présidentielle noire, ou SUV Signature nacré. */
/** Identifiant de la flotte → vraie photo du modèle. */
const PHOTO_PRESTIGE: Record<string, IdPhoto> = {
  'maextro-s800': 'maextro-s800', 'yangwang-altior': 'yangwang-u7', 'aito-m9': 'aito-m9',
  'nio-es9': 'nio-es9', 'nio-et9': 'nio-et9', 'stelato-s9': 'stelato-s9', 'zeekr-8x': 'zeekr-8x',
};

/** Vraie photo du véhicule loué : le client voit exactement ce qu'il commande. */
function PrestigeBadge({ vehicule, size = 46 }: { vehicule: Pick<PrestigeVehicle, 'id' | 'classe'> & { name?: string }; size?: number }) {
  const photo = PHOTO_PRESTIGE[vehicule.id] ?? (vehicule.name ? photoDuModele(vehicule.name) : null);
  if (photo && photoDisponible(photo)) {
    return <span className="veh-illus photo" style={{ width: size * 1.75, height: size }}><PhotoVehicule id={photo} largeur={Math.round(size * 1.75)} /></span>;
  }
  return <MedaillonGamme gamme={vehicule.classe === 'presidentielle' ? 'diamant' : 'or'} taille={size * 0.84} />;
}

export function RentalScreen({ onBack, onReserved, onToast }: {
  onBack: () => void;
  onReserved: (id: string) => void;
  onToast: (msg: string, danger?: boolean) => void;
}) {
  const { t } = useI18n();
  const [catalogue, setCatalogue] = useState<RentalCatalogue | null>(null);
  const [formula, setFormula] = useState<RentalFormula>('evenement');
  const [vehicleId, setVehicleId] = useState('');
  const [duree, setDuree] = useState<RentalDuree>('journee');
  const [heures, setHeures] = useState(3);
  const [debut, setDebut] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 45, 0, 0); // mise à disposition du jour, délai express réaliste
    return d;
  });
  const [options, setOptions] = useState<RentalOptions>({});
  const [cortege, setCortege] = useState(0);
  const [hotesses, setHotesses] = useState(0);
  const [lieu, setLieu] = useState('');
  const [contactNom, setContactNom] = useState('');
  const [contactTel, setContactTel] = useState('');
  const [societe, setSociete] = useState('');
  const [bonCommande, setBonCommande] = useState('');
  const [dispos, setDispos] = useState<RentalAvailability[]>([]);
  const [quote, setQuote] = useState<RentalQuote | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // Catalogue : la gamme et le barème font foi côté serveur. On se réabonne aux
  // changements de barème pilotés depuis la console (diffusés en WebSocket).
  useEffect(() => {
    const charger = () => {
      void fetchRentalCatalogue().then((c) => {
        setCatalogue(c);
        setVehicleId((v) => (v && c.vehicles.some((x) => x.id === v) ? v : (c.vehicles[0]?.id ?? '')));
      });
    };
    charger();
    return onRentalTariffChange(charger);
  }, []);

  const vehicles = catalogue?.vehicles ?? [];
  const vehicle = vehicles.find((v) => v.id === vehicleId);

  // Disponibilité réelle sur la période choisie (et délai express le jour même).
  useEffect(() => {
    let vivant = true;
    void fetchRentalAvailability(debut, duree, duree === 'heures' ? heures : undefined)
      .then((d) => { if (vivant) setDispos(d); });
    return () => { vivant = false; };
  }, [debut, duree, heures]);

  const optionsCompletes = useMemo<RentalOptions>(() => ({ ...options, cortege, hotesses }), [options, cortege, hotesses]);

  // Devis : recalculé à chaque changement, toujours par le serveur quand il répond.
  useEffect(() => {
    if (!vehicleId || vehicles.length === 0) return;
    let vivant = true;
    void quoteRental(
      { formula, vehicleId, debut, duree, heures: duree === 'heures' ? heures : undefined, options: optionsCompletes, userId: clientId() },
      vehicles,
    ).then((q) => { if (vivant) setQuote(q); });
    return () => { vivant = false; };
  }, [formula, vehicleId, debut, duree, heures, optionsCompletes, vehicles]);

  const dispoDe = (id: string) => dispos.find((d) => d.vehicleId === id);
  const jourJ = debut.toDateString() === new Date().toDateString();
  const b = quote?.breakdown;

  const reserver = async () => {
    if (!quote || envoi) return;
    setEnvoi(true);
    const r = await reserveRental({
      formula, vehicleId, debut, duree, heures: duree === 'heures' ? heures : undefined,
      options: optionsCompletes, userId: clientId(),
      lieu: lieu.trim() || undefined,
      contact: contactNom.trim() && contactTel.trim() ? { nom: contactNom.trim(), telephone: contactTel.trim() } : undefined,
      societe: formula === 'entreprise' && societe.trim()
        ? { nom: societe.trim(), bonCommande: bonCommande.trim() || undefined }
        : undefined,
    });
    setEnvoi(false);
    // Un échec ne doit JAMAIS être présenté comme une réservation réussie : le client
    // se présenterait le jour J sans véhicule.
    if (!r) { onToast(t('rent_failed'), true); return; }
    onReserved(r.id);
  };

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('rent_title')} />
      <div className="page-body">
        <h2 className="h-title">{t('rent_title')}</h2>
        <p className="h-sub" style={{ marginBottom: 16 }}>{t('rent_subtitle')}</p>

        {/* Formule */}
        <span className="eyebrow">{t('rent_formula')}</span>
        <div className="stack" style={{ margin: '10px 0 18px' }}>
          {RENTAL_FORMULES.map((f) => (
            <button
              key={f}
              className={`veh${f === formula ? ' active' : ''}`}
              onClick={() => {
                setFormula(f);
                setOptions((o) => Object.fromEntries(
                  Object.entries(o).filter(([k]) => OPTIONS_PAR_FORMULE[f].includes(k)),
                ) as RentalOptions);
                if (f !== 'evenement') setCortege(0);
                if (f === 'mise_a_disposition') setHotesses(0);
              }}
            >
              <span className="veh-ico" style={{ width: 42, height: 42, color: 'var(--green)' }}>
                {f === 'entreprise' ? <IconUsers size={20} /> : f === 'mise_a_disposition' ? <IconClock size={20} /> : <IconCrown size={20} />}
              </span>
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 15 }}>{t(`rent_f_${f}`)}</strong>
                <span className="faint" style={{ fontSize: 12 }}>{t(`rent_f_${f}Hint`)}</span>
              </span>
              {f === formula && <IconCheck size={18} color="var(--green)" />}
            </button>
          ))}
        </div>

        {/* Véhicule : gamme Signature, avec disponibilité réelle */}
        <span className="eyebrow">{t('rent_vehicle')}</span>
        <div className="stack" style={{ margin: '10px 0 18px' }}>
          {vehicles.map((v) => {
            const d = dispoDe(v.id);
            const indispo = d && !d.disponible;
            const actif = v.id === vehicleId;
            return (
              <button
                key={v.id}
                className={`veh${actif ? ' active' : ''}`}
                style={{ ...(actif ? { borderColor: v.classe === 'presidentielle' ? '#f5c451' : '#7fe7ff' } : {}), opacity: indispo ? 0.55 : 1 }}
                onClick={() => setVehicleId(v.id)}
              >
                <PrestigeBadge vehicule={v} size={54} />
                <span className="col grow" style={{ textAlign: 'start' }}>
                  <strong style={{ fontSize: 15 }}>{v.name}</strong>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {v.places} {t('rent_places')} · {v.autonomieKm} km {t('rent_autonomy')} · {t(v.classe === 'presidentielle' ? 'rent_classePresidentielle' : 'rent_classeSignature')}
                  </span>
                  <span className="faint" style={{ fontSize: 11.5, color: indispo ? 'var(--danger)' : 'var(--green)' }}>
                    {indispo ? t('rent_unavailable') : t('rent_available', { n: String(d?.restants ?? v.exemplaires) })}
                    {d && d.delaiMinutes > 0 && !indispo ? ` · ${t('rent_eta', { min: String(d.delaiMinutes) })}` : ''}
                  </span>
                </span>
                <span className="col" style={{ alignItems: 'flex-end' }}>
                  <span className="price" style={{ fontSize: 15 }}>{formatXOF(v.prixJour)}</span>
                  <span className="faint" style={{ fontSize: 11 }}>{t('rent_perDay')}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Durée */}
        <span className="eyebrow">{t('rent_duration')}</span>
        <div className="chips" style={{ margin: '10px 0 14px' }}>
          {RENTAL_DUREES.map((d) => (
            <button key={d} className={`chip${d === duree ? ' active' : ''}`} onClick={() => setDuree(d)}>
              {d === 'heures' ? <IconClock size={15} /> : <IconCalendar size={15} />} {t(`rent_d_${d}`)}
            </button>
          ))}
        </div>

        {duree === 'heures' && (
          <>
            <div className="opt" style={{ marginBottom: 6 }}>
              <span className="grow" style={{ textAlign: 'start' }}>{t('rent_hours')}</span>
              <div className="row gap-sm">
                <button className="step" onClick={() => setHeures((h) => Math.max(catalogue?.bareme.minHeures ?? 3, h - 1))}><IconMinus size={16} /></button>
                <strong style={{ minWidth: 28, textAlign: 'center' }}>{heures} h</strong>
                <button className="step" onClick={() => setHeures((h) => Math.min(catalogue?.bareme.maxHeures ?? 12, h + 1))}><IconPlus size={16} /></button>
              </div>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 16 }}>
              {t('rent_hoursHint', { min: String(catalogue?.bareme.minHeures ?? 3), max: String(catalogue?.bareme.maxHeures ?? 12) })}
            </p>
          </>
        )}

        {/* Début : aujourd'hui reste possible — c'est l'engagement ORION */}
        <span className="eyebrow">{t('rent_when')}</span>
        <div className="chips" style={{ margin: '10px 0 10px' }}>
          <button
            className={`chip${jourJ ? ' active' : ''}`}
            onClick={() => { const d = new Date(); d.setMinutes(d.getMinutes() + 45, 0, 0); setDebut(d); }}
          >
            <IconClock size={15} /> {t('rent_today')}
          </button>
          <button
            className={`chip${!jourJ ? ' active' : ''}`}
            onClick={() => { const d = new Date(Date.now() + 86_400_000); d.setHours(9, 0, 0, 0); setDebut(d); }}
          >
            <IconCalendar size={15} /> {t('rent_tomorrow')}
          </button>
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            type="datetime-local"
            value={toLocalInput(debut)}
            min={toLocalInput(new Date())}
            onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) setDebut(d); }}
          />
        </div>
        <p className="faint" style={{ fontSize: 11.5, marginBottom: 18 }}>
          {DATE_FMT.format(debut)} · {HEURE_FMT.format(debut)}
          {quote ? ` → ${DATE_FMT.format(new Date(quote.fin))} · ${quote.heuresService} ${t('rent_serviceHours')}` : ''}
        </p>

        {jourJ && (
          <div className="card row gap-sm" style={{ marginBottom: 16, color: 'var(--green)' }}>
            <IconClock size={16} />
            <span style={{ fontSize: 12.5 }}>
              {t('rent_sameDay')}
              {quote?.disponibilite.delaiMinutes ? ` — ${t('rent_eta', { min: String(quote.disponibilite.delaiMinutes) })}` : ''}
            </span>
          </div>
        )}

        {/* Options */}
        <span className="eyebrow">{t('rent_options')}</span>
        <div className="stack" style={{ gap: 8, margin: '10px 0 14px' }}>
          {RENTAL_OPTION_KEYS.filter((k) => OPTIONS_PAR_FORMULE[formula].includes(k)).map((k) => (
            <div key={k} className="opt">
              <span className="grow" style={{ textAlign: 'start' }}>{t(`rent_o_${k}`)}</span>
              <button
                className={`toggle${options[k] ? ' on' : ''}`}
                onClick={() => setOptions((o) => ({ ...o, [k]: !o[k] }))}
                aria-label={t(`rent_o_${k}`)}
              ><span /></button>
            </div>
          ))}
          {formula === 'evenement' && (
          <div className="opt">
            <span className="grow" style={{ textAlign: 'start' }}>{t('rent_o_cortege')}</span>
            <div className="row gap-sm">
              <button className="step" onClick={() => setCortege((c) => Math.max(0, c - 1))}><IconMinus size={16} /></button>
              <strong style={{ minWidth: 18, textAlign: 'center' }}>{cortege}</strong>
              <button
                className="step"
                onClick={() => setCortege((c) => Math.min(Math.max(0, (vehicle?.exemplaires ?? 1) - 1), c + 1))}
              ><IconPlus size={16} /></button>
            </div>
          </div>
          )}
          {formula !== 'mise_a_disposition' && (
          <div className="opt">
            <span className="grow" style={{ textAlign: 'start' }}>{t('rent_o_hotesses')}</span>
            <div className="row gap-sm">
              <button className="step" onClick={() => setHotesses((h) => Math.max(0, h - 1))}><IconMinus size={16} /></button>
              <strong style={{ minWidth: 18, textAlign: 'center' }}>{hotesses}</strong>
              <button className="step" onClick={() => setHotesses((h) => Math.min(6, h + 1))}><IconPlus size={16} /></button>
            </div>
          </div>
          )}
        </div>

        {quote?.secondChauffeurRequis && (
          <p className="faint" style={{ fontSize: 11.5, marginBottom: 14 }}>
            {t('rent_secondRequired', { h: String(catalogue?.bareme.heuresParJournee ?? 10) })}
          </p>
        )}

        {/* Lieu et contact */}
        <span className="eyebrow">{t('rent_place')}</span>
        <div className="field" style={{ margin: '10px 0 14px' }}>
          <input placeholder={t('rent_placePh')} value={lieu} onChange={(e) => setLieu(e.target.value)} />
        </div>

        <span className="eyebrow">{t('rent_contact')}</span>
        <div className="row gap-sm" style={{ margin: '10px 0 14px' }}>
          <div className="field grow" style={{ minWidth: 0 }}><input placeholder={t('rent_contactName')} value={contactNom} onChange={(e) => setContactNom(e.target.value)} /></div>
          <div className="field grow" style={{ minWidth: 0 }}><input placeholder={t('rent_contactPhone')} value={contactTel} onChange={(e) => setContactTel(e.target.value)} /></div>
        </div>

        {formula === 'entreprise' && (
          <>
            <span className="eyebrow">{t('rent_company')}</span>
            <div className="row gap-sm" style={{ margin: '10px 0 16px' }}>
              <div className="field grow" style={{ minWidth: 0 }}><input placeholder={t('rent_companyName')} value={societe} onChange={(e) => setSociete(e.target.value)} /></div>
              <div className="field grow" style={{ minWidth: 0 }}><input placeholder={t('rent_po')} value={bonCommande} onChange={(e) => setBonCommande(e.target.value)} /></div>
            </div>
          </>
        )}

        {/* Détail du prix : rien de caché */}
        {quote && b && (
          <>
            <span className="eyebrow">{t('rent_detail')}</span>
            <div style={{ margin: '10px 0' }}>
              <div className="fare-line"><span>{t('rent_lineVehicle')}</span><span>{formatXOF(b.vehicule)}</span></div>
              {b.cortege > 0 && <div className="fare-line"><span>{t('rent_lineConvoy')}</span><span>{formatXOF(b.cortege)}</span></div>}
              {b.kilometrageIllimite > 0 && <div className="fare-line"><span>{t('rent_lineKm')}</span><span>{formatXOF(b.kilometrageIllimite)}</span></div>}
              {b.options > 0 && <div className="fare-line"><span>{t('rent_lineOptions')}</span><span>{formatXOF(b.options)}</span></div>}
              {b.majorationJourJ > 0 && <div className="fare-line"><span>{t('rent_lineExpress')}</span><span>{formatXOF(b.majorationJourJ)}</span></div>}
              {b.remiseAbonnement > 0 && (
                <div className="fare-line" style={{ color: 'var(--green)' }}>
                  <span>{t('rent_lineMember')}</span><span>-{formatXOF(b.remiseAbonnement)}</span>
                </div>
              )}
              <div className="fare-line"><span>{t('rent_lineHt')}</span><span>{formatXOF(b.ht)}</span></div>
              <div className="fare-line"><span>{t('rent_lineTva')}</span><span>{formatXOF(b.tva)}</span></div>
            </div>
            <div className="fare-total" style={{ marginBottom: 8 }}>
              <span className="muted">{t('rent_total')}</span><span className="amt">{formatXOF(quote.total)}</span>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 4 }}>{t('rent_deposit', { amount: formatXOF(quote.caution) })}</p>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 4 }}>
              {quote.kmInclus === null ? t('rent_kmUnlimited') : t('rent_kmIncluded', { km: String(quote.kmInclus), price: formatXOF(quote.prixKmSupp) })}
            </p>
            <p className="faint" style={{ fontSize: 11.5, marginBottom: 14 }}><IconLeaf size={12} /> {t('rent_chauffeur')}</p>

            <button
              className="btn btn-primary"
              disabled={envoi || !quote.disponibilite.disponible}
              onClick={() => void reserver()}
            >
              <IconCar size={18} /> {t('rent_reserve')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const COULEUR_STATUT: Record<RentalStatus, string> = {
  devis: 'var(--muted)', reservee: 'var(--green)', confirmee: 'var(--green)',
  en_cours: '#7fe7ff', terminee: 'var(--muted)', annulee: 'var(--danger)',
};

/** Mes locations : suivi des dossiers et annulation (frais annoncés par le serveur). */
export function MyRentalsScreen({ onBack, onToast }: { onBack: () => void; onToast: (m: string, d?: boolean) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<RentalReservation[] | null>(null);

  const charger = () => { void listMyRentals(clientId()).then((r) => setItems(r ?? [])); };
  useEffect(charger, []);

  const annuler = async (id: string) => {
    const r = await cancelRental(id);
    if (!r) { onToast(t('rent_failed'), true); return; }
    onToast(r.message || t('rent_cancelled'));
    charger();
  };

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('rent_mine')} />
      <div className="page-body">
        <h2 className="h-title">{t('rent_mine')}</h2>
        {items && items.length === 0 && <p className="h-sub">{t('rent_mineEmpty')}</p>}
        <div className="stack" style={{ marginTop: 14 }}>
          {(items ?? []).map((r) => (
            <div key={r.id} className="plan-card">
              <div className="row between">
                <div className="row gap-sm">
                  <PrestigeBadge vehicule={r.vehicle} size={40} />
                  <div className="col">
                    <strong style={{ fontSize: 15 }}>{r.vehicle.name}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {t(`rent_f_${r.formula}`)} · {t(`rent_d_${r.duree}`)}
                    </span>
                  </div>
                </div>
                <span className="col" style={{ alignItems: 'flex-end' }}>
                  <span className="price" style={{ fontSize: 15, whiteSpace: 'nowrap' }}>{formatXOF(r.total)}</span>
                  <span className="faint mono" style={{ fontSize: 11 }}>{r.id}</span>
                </span>
              </div>
              <div className="divider" style={{ margin: '10px 0' }} />
              <div className="row between" style={{ fontSize: 12.5 }}>
                <span className="muted"><IconCalendar size={13} /> {DATE_FMT.format(new Date(r.debut))} · {HEURE_FMT.format(new Date(r.debut))}</span>
                <strong style={{ color: COULEUR_STATUT[r.status] }}>{t(`rent_s_${r.status}`)}</strong>
              </div>
              {r.lieu && <div className="row gap-sm" style={{ fontSize: 12.5, marginTop: 6 }}><IconPin size={13} /> <span className="muted">{r.lieu}</span></div>}
              {(r.status === 'reservee' || r.status === 'confirmee') && (
                <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => void annuler(r.id)}>{t('rent_cancel')}</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
