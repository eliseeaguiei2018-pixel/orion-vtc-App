/**
 * ENVOYER UN COLIS — le volet livraison de l'app cliente (version 2.6), en quatre étapes :
 *
 *   1. le trajet et la formule (moto pour les petits colis, cargo — petit camion — pour les gros) ;
 *   2. le colis : délai de remise (moins cher quand on n'est pas pressé), porte-à-porte ou
 *      rendez-vous à l'entrée, sac isotherme, fragile, contenu et consignes ;
 *   3. qui envoie, qui reçoit : on peut commander pour d'autres — le coursier appelle
 *      l'expéditeur au retrait, puis le destinataire, qui lui donne le code de remise ;
 *   4. le récapitulatif, le prix fixe et le paiement.
 *
 * Le prix affiché à chaque étape est celui que calcule le serveur (même barème) ; au
 * récapitulatif, c'est le devis du serveur lui-même, verrouillé pour la commande.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DELAIS_LIVRAISON, estimateDelivery, FORMULES_LIVRAISON, isLiveBackend, previewLivraison, SUPPLEMENTS_LIVRAISON,
  type DelaiLivraison, type DetailsLivraison, type FormuleLivraison, type OptionsLivraison,
} from '../api';
import { OrionMap } from '../components/OrionMap';
import { Sheet, TopBar } from '../components/ui';
import { rendu } from '../components/Vehicules';
import { formatXOF } from '../data';
import { useI18n } from '../i18n';
import { useTrajetTarif } from '../tarifTrajet';
import type { Place, Quote } from '../types';
import {
  IcoArrivee, IcoAutre, IcoBillet, IcoBouclier, IcoChevron, IcoColis, IcoCourses, IcoDocuments, IcoEclair, IcoEscalier,
  IcoFragile, IcoFlocon, IcoHorloge, IcoImmeuble, IcoMessage, IcoNote, IcoPersonne, IcoPorte, IcoPortefeuille, IcoRepas,
  IcoRepere, IcoTech, IcoTelephone, IcoVetement,
} from './icones';
import './livraison.css';

export interface CommandeColis {
  dropoff: Place;
  formule: FormuleLivraison;
  options: OptionsLivraison;
  details: DetailsLivraison;
  /** Devis du serveur obtenu au récapitulatif (verrouillé), s'il y en a un. */
  devis: Quote | null;
}

interface Partie {
  moi: boolean; nom: string; tel: string;
  batiment: string; etage: string; porte: string; repere: string; sms: boolean;
}
const vide = (moi: boolean, sms: boolean): Partie => ({ moi, nom: '', tel: '', batiment: '', etage: '', porte: '', repere: '', sms });
const telValide = (t: string) => t.replace(/\D/g, '').length >= 8;
const CONTENUS = [
  ['docs', IcoDocuments], ['repas', IcoRepas], ['vetements', IcoVetement], ['tech', IcoTech], ['courses', IcoCourses], ['autre', IcoAutre],
] as const;
const DELAIS: DelaiLivraison[] = ['express', 'heure', 'deux_heures'];
const image = (nom: string) => rendu(`livraison/${nom}`);
const heure = (msDansLeFutur: number) => new Date(Date.now() + msDansLeFutur).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function EnvoiColis({ origin, departAConfirmer, dropoff, profil, approche, payment, payments, onPayment, onPickup, onDropoff, onBack, onCommander }: {
  origin: Place; departAConfirmer: boolean; dropoff: Place | null;
  /** Le client connecté (pour « Moi ») ; null sans compte. */
  profil: { nom: string; telephone: string } | null;
  /** Approche du coursier le plus proche, en minutes, par formule (serveur ORION). */
  approche: Partial<Record<FormuleLivraison, number>>;
  payment: string; payments: Array<{ method: string; label: string }>; onPayment: (m: string) => void;
  onPickup: () => void; onDropoff: () => void; onBack: () => void; onCommander: (c: CommandeColis) => void;
}) {
  const { t } = useI18n();
  const [etape, setEtape] = useState(0);
  const [formule, setFormule] = useState<FormuleLivraison>('moto');
  const [delai, setDelai] = useState<DelaiLivraison>('express');
  const [portePorte, setPortePorte] = useState(false);
  const [isotherme, setIsotherme] = useState(false);
  const [fragile, setFragile] = useState(false);
  const [contenu, setContenu] = useState<string | null>(null);
  const [precision, setPrecision] = useState('');
  const [consignes, setConsignes] = useState('');
  const [exp, setExp] = useState<Partie>(() => vide(Boolean(profil), false));
  const [dest, setDest] = useState<Partie>(() => vide(false, true));
  const [choixPaiement, setChoixPaiement] = useState(false);
  const options: OptionsLivraison = { delai, portePorte, isotherme: formule === 'moto' && isotherme, fragile };

  // Prix : le trajet par la route d'abord (comme pour une course), puis le barème du serveur.
  const trajet = useTrajetTarif(dropoff ? [origin.location, dropoff.location] : null);
  // Majoration de la demande (offre et demande autour du retrait) : relue sur un devis du serveur,
  // pour que chaque prix affiché soit celui que le serveur facturera.
  const [majoration, setMajoration] = useState(1);
  useEffect(() => {
    if (!dropoff || !isLiveBackend()) return;
    let fini = false;
    void estimateDelivery(origin.location, dropoff.location, 'moto', undefined, { delai: 'express', portePorte: false, isotherme: false, fragile: false })
      .then((q) => { if (!fini && q?.breakdown?.surge) setMajoration(Math.max(1, q.breakdown.surge)); });
    return () => { fini = true; };
  }, [dropoff, origin.location]);
  const apercu = (f: FormuleLivraison, o: OptionsLivraison) => (dropoff && trajet.pret ? previewLivraison(origin.location, dropoff.location, f, o, majoration) : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prixFormules = useMemo(() => Object.fromEntries((['moto', 'cargo'] as const).map((f) => [f, apercu(f, { delai: 'express', portePorte: false, isotherme: false, fragile: false })])) as Record<FormuleLivraison, Quote | null>, [dropoff, origin.location, trajet.pret, trajet.trajet, majoration]);
  // « Dès » : le prix le plus bas de la formule (sous 2 h, sans option).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prixDes = useMemo(() => Object.fromEntries((['moto', 'cargo'] as const).map((f) => [f, apercu(f, { delai: 'deux_heures', portePorte: false, isotherme: false, fragile: false })])) as Record<FormuleLivraison, Quote | null>, [dropoff, origin.location, trajet.pret, trajet.trajet, majoration]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prixDelais = useMemo(() => Object.fromEntries(DELAIS.map((d) => [d, apercu(formule, { ...options, delai: d })])) as Record<DelaiLivraison, Quote | null>, [dropoff, origin.location, trajet.pret, trajet.trajet, formule, portePorte, isotherme, fragile, majoration]);
  const courant = prixDelais[delai];

  // Récapitulatif : le devis du serveur, verrouillé pour la commande.
  const [devis, setDevis] = useState<Quote | null>(null);
  useEffect(() => {
    setDevis(null);
    if (etape !== 3 || !dropoff || !isLiveBackend()) return;
    let fini = false;
    void estimateDelivery(origin.location, dropoff.location, formule, undefined, options).then((q) => { if (!fini) setDevis(q); });
    return () => { fini = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etape, dropoff, origin.location, formule, delai, portePorte, isotherme, fragile]);
  const prixFinal = devis ?? courant;

  // Livré avant : délai choisi + trajet + 20 min pour l'approche et le retrait (comme le serveur).
  const livreAvant = (d: DelaiLivraison, q: Quote | null) => heure((DELAIS_LIVRAISON[d].minutes * 60 + (q?.etaSeconds ?? 900) + 20 * 60) * 1000);

  const expOk = exp.moi ? Boolean(profil) : exp.nom.trim().length >= 2 && telValide(exp.tel);
  const destOk = dest.moi ? Boolean(profil) : dest.nom.trim().length >= 2 && telValide(dest.tel);
  const adresse = (p: Partie) => {
    const a = { batiment: p.batiment.trim(), etage: p.etage.trim(), porte: p.porte.trim(), repere: p.repere.trim() };
    return Object.values(a).some(Boolean) ? a : undefined;
  };
  const contact = (p: Partie) => (p.moi && profil ? { nom: profil.nom, telephone: profil.telephone } : { nom: p.nom.trim(), telephone: p.tel.trim() });
  const description = [contenu ? t(`lv_c_${contenu}`) : '', precision.trim()].filter(Boolean).join(' · ');
  const details = (): DetailsLivraison => ({
    destinataire: contact(dest),
    ...(!exp.moi ? { expediteur: contact(exp) } : {}),
    ...(adresse(exp) ? { retrait: adresse(exp) } : {}),
    ...(adresse(dest) ? { depot: adresse(dest) } : {}),
    ...(description ? { description: description.slice(0, 140) } : {}),
    ...(consignes.trim() ? { instructions: consignes.trim().slice(0, 240) } : {}),
    ...(dest.sms && !dest.moi ? { prevenirDestinataire: true } : {}),
    ...(exp.sms && !exp.moi ? { prevenirExpediteur: true } : {}),
  });
  const commander = () => { if (dropoff) onCommander({ dropoff, formule, options, details: details(), devis }); };

  const moyen = payments.find((p) => p.method === payment) ?? payments[0];
  const barre = (cta: string, action: () => void, actif = true, montant?: number | null) => (
    <div className="lv-barre">
      <button type="button" className="lv-paiement" onClick={() => setChoixPaiement(true)} aria-label={`${t('lv_paiement')} : ${moyen?.label ?? ''}`}>
        <span className="lv-paiement-ico">{payment === 'cash' ? <IcoBillet size={22} /> : <IcoPortefeuille size={22} />}</span>
        <span className="lv-paiement-txt"><small>{t('lv_paiement')}</small><strong>{moyen?.label}</strong></span>
      </button>
      <button type="button" className="lv-cta" disabled={!actif} onClick={action}>
        <span>{cta}</span>
        {montant ? <small>{formatXOF(montant)}</small> : null}
      </button>
    </div>
  );
  const fenetrePaiement = choixPaiement && (
    <div className="lv-voile" role="dialog" aria-modal="true" aria-label={t('lv_paiement')} onClick={(e) => { if (e.target === e.currentTarget) setChoixPaiement(false); }}>
      <div className="lv-feuille">
        <span className="lv-poignee" aria-hidden="true" />
        <h3>{t('lv_paiement')}</h3>
        {payments.map((p) => (
          <button key={p.method} type="button" className={`lv-choix${p.method === payment ? ' actif' : ''}`} onClick={() => { onPayment(p.method); setChoixPaiement(false); }}>
            <span className="lv-choix-ico">{p.method === 'cash' ? <IcoBillet /> : <IcoPortefeuille />}</span>
            <span className="lv-choix-txt"><strong>{p.label}</strong></span>
            <span className="lv-radio" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
  const nomFormule = (f: FormuleLivraison) => t(f === 'moto' ? 'lv_moto' : 'lv_cargo');
  const [l, w, h] = FORMULES_LIVRAISON[formule].dimensionsCm;

  /* ------------------------------------------------ étape 1 : trajet et formule */
  if (etape === 0) {
    return (
      <div className="screen lv">
        <OrionMap origin={origin.location} destination={dropoff?.location ?? null} vehicle={formule === 'moto' ? 'moto' : 'car'} />
        <TopBar onBack={onBack} title={t('lv_titre')} />
        <div style={{ flex: 1 }} />
        <Sheet pied={dropoff ? (departAConfirmer
          ? <button type="button" className="lv-cta seul" onClick={onPickup}><span>{t('lieu_confirmer_depart')}</span></button>
          : barre(t('lv_continuer'), () => setEtape(1), Boolean(prixFormules[formule]))) : undefined}>
          <header className="lv-tete">
            <h2>{t('lv_titre')}</h2>
            <p>{t('lv_sous')}</p>
          </header>
          <div className="lv-trajet">
            <button type="button" className="lv-point" onClick={onPickup}>
              <span className="lv-pastille"><IcoColis size={20} /></span>
              <span className="lv-point-txt"><small>{t('lv_retrait')}</small><strong>{departAConfirmer ? t('lieu_a_confirmer') : origin.name}</strong></span>
              <IcoChevron size={18} className="lv-gris" />
            </button>
            <span className="lv-trajet-trait" aria-hidden="true" />
            <button type="button" className="lv-point" onClick={onDropoff}>
              <span className="lv-pastille cible"><IcoArrivee size={20} /></span>
              <span className="lv-point-txt">
                <small>{dropoff && courant ? `≈ ${Math.max(1, Math.round(courant.etaSeconds / 60))} min · ${t('lv_avant', { h: livreAvant('express', courant) })}` : t('lv_remise')}</small>
                <strong className={dropoff ? '' : 'lv-invite'}>{dropoff ? dropoff.name : t('lv_ou')}</strong>
              </span>
              <IcoChevron size={18} className="lv-gris" />
            </button>
          </div>
          {dropoff && (
            <div className="lv-formules" role="radiogroup" aria-label={t('lv_formule')}>
              {(['moto', 'cargo'] as const).map((f) => {
                const q = prixFormules[f];
                const min = approche[f];
                return (
                  <button key={f} type="button" role="radio" aria-checked={formule === f} className={`lv-formule${formule === f ? ' actif' : ''}`} onClick={() => setFormule(f)}>
                    <span className="lv-formule-img"><img src={image(`liv-${f}`)} alt="" loading="lazy" /></span>
                    {min !== undefined && <span className="lv-eta">{t('lv_min', { n: Math.max(1, Math.round(min)) })}</span>}
                    <strong>{nomFormule(f)}</strong>
                    <small>{t(f === 'moto' ? 'lv_moto_d' : 'lv_cargo_d')}</small>
                    <span className="lv-prix">{q && prixDes[f] ? t('lv_des', { p: formatXOF(prixDes[f]!.amount) }) : '…'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Sheet>
        {fenetrePaiement}
      </div>
    );
  }

  /* Étapes pleine page : en-tête, corps qui défile, barre de commande en bas. */
  const page = (titre: string, n: number, corps: React.ReactNode, pied: React.ReactNode) => (
    <div key={etape} className="screen page lv lv-page">
      <TopBar onBack={() => setEtape(n - 2)} title={titre} />
      <div className="page-body lv-corps">
        <div className="lv-progression" aria-label={t('lv_etape', { n })}>
          {[1, 2, 3, 4].map((i) => <span key={i} className={i <= n ? 'fait' : ''} />)}
        </div>
        {corps}
      </div>
      <div className="lv-pied">{pied}</div>
      {fenetrePaiement}
    </div>
  );

  /* ------------------------------------------------ étape 2 : le colis */
  if (etape === 1) {
    const sansOptions = prixDelais[delai];
    const avecPorte = apercu(formule, { ...options, portePorte: !portePorte });
    const ecartPorte = sansOptions && avecPorte ? Math.abs(avecPorte.amount - sansOptions.amount) : SUPPLEMENTS_LIVRAISON.portePorte;
    const avecIso = apercu(formule, { ...options, isotherme: !options.isotherme });
    const ecartIso = sansOptions && avecIso ? Math.abs(avecIso.amount - sansOptions.amount) : SUPPLEMENTS_LIVRAISON.isotherme;
    return page(t('lv_e_colis'), 2, (
      <>
        <section className="lv-vitrine">
          <div className="lv-vitrine-img"><img src={image(`liv-${formule}`)} alt="" /></div>
          <div className="lv-cotes"><IcoColis size={16} /> {t('lv_dims', { l, w, h, kg: new Intl.NumberFormat('fr-FR').format(FORMULES_LIVRAISON[formule].poidsMaxKg) })}</div>
          <h2>{nomFormule(formule)}</h2>
          <p>{t(formule === 'moto' ? 'lv_moto_long' : 'lv_cargo_long')}</p>
        </section>

        <section className="lv-carte" aria-labelledby="lv-quand">
          <h3 id="lv-quand">{t('lv_quand')}</h3>
          <div role="radiogroup" aria-labelledby="lv-quand">
            {DELAIS.map((d) => {
              const q = prixDelais[d];
              const gain = q && prixDelais.express ? prixDelais.express.amount - q.amount : 0;
              return (
                <button key={d} type="button" role="radio" aria-checked={delai === d} className={`lv-choix${delai === d ? ' actif' : ''}`} onClick={() => setDelai(d)}>
                  <span className="lv-choix-ico">{d === 'express' ? <IcoEclair /> : <IcoHorloge />}</span>
                  <span className="lv-choix-txt">
                    <strong>{t(d === 'express' ? 'lv_express' : d === 'heure' ? 'lv_heure' : 'lv_deux')}</strong>
                    <small>{d === 'express' ? t('lv_express_d') : t('lv_avant', { h: livreAvant(d, q) })}{gain > 0 ? <em className="lv-gain"> · {t('lv_moins', { p: formatXOF(gain) })}</em> : null}</small>
                  </span>
                  <span className="lv-montant">{q ? formatXOF(q.amount) : '…'}</span>
                  <span className="lv-radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="lv-carte" aria-labelledby="lv-rem">
          <h3 id="lv-rem">{t('lv_remise_titre')}</h3>
          <div className="lv-duo" role="radiogroup" aria-labelledby="lv-rem">
            {([false, true] as const).map((pp) => (
              <button key={String(pp)} type="button" role="radio" aria-checked={portePorte === pp} className={`lv-duo-carte${portePorte === pp ? ' actif' : ''}`} onClick={() => setPortePorte(pp)}>
                <img src={image(pp ? 'liv-porte' : 'liv-entree')} alt="" />
                <strong>{t(pp ? 'lv_porte' : 'lv_entree')}</strong>
                <small>{t(pp ? 'lv_porte_d' : 'lv_entree_d')}</small>
                <span className="lv-duo-prix">{pp ? `+${formatXOF(ecartPorte)}` : t('badge_gratuit')}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="lv-carte" aria-labelledby="lv-opt">
          <h3 id="lv-opt">{t('lv_options')}</h3>
          {formule === 'moto' && (
            <label className="lv-option">
              <img className="lv-option-img" src={image('liv-isotherme')} alt="" />
              <span className="lv-choix-txt"><strong>{t('lv_iso')} <em className="lv-plus">+{formatXOF(ecartIso)}</em></strong><small>{t('lv_iso_d')}</small></span>
              <input type="checkbox" className="lv-interrupteur" checked={isotherme} onChange={(e) => setIsotherme(e.target.checked)} />
            </label>
          )}
          <label className="lv-option">
            <span className="lv-option-ico"><IcoFragile size={24} /></span>
            <span className="lv-choix-txt"><strong>{t('lv_fragile')} <em className="lv-plus gratuit">{t('badge_gratuit')}</em></strong><small>{t('lv_fragile_d')}</small></span>
            <input type="checkbox" className="lv-interrupteur" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
          </label>
        </section>

        <section className="lv-carte" aria-labelledby="lv-cont">
          <h3 id="lv-cont">{t('lv_contenu')}</h3>
          <div className="lv-puces">
            {CONTENUS.map(([c, Ico]) => (
              <button key={c} type="button" aria-pressed={contenu === c} className={`lv-puce${contenu === c ? ' actif' : ''}`} onClick={() => setContenu(contenu === c ? null : c)}>
                <Ico size={18} /> {t(`lv_c_${c}`)}
              </button>
            ))}
          </div>
          <input className="lv-champ" value={precision} maxLength={100} onChange={(e) => setPrecision(e.target.value)} placeholder={t('lv_contenu_ph')} aria-label={t('lv_contenu_ph')} />
          <h3 className="lv-h3-espace">{t('lv_instr')}</h3>
          <div className="lv-champ-ico">
            <IcoNote size={20} />
            <textarea className="lv-champ" rows={2} value={consignes} maxLength={240} onChange={(e) => setConsignes(e.target.value)} placeholder={t('lv_instr_ph')} aria-label={t('lv_instr')} />
          </div>
        </section>
      </>
    ), barre(t('lv_continuer'), () => setEtape(2), Boolean(courant), courant?.amount));
  }

  /* ------------------------------------------------ étape 3 : qui envoie, qui reçoit */
  if (etape === 2) {
    const bloc = (role: 'exp' | 'dest', p: Partie, set: (f: (x: Partie) => Partie) => void, lieu: string, ok: boolean) => {
      const champ = (k: 'batiment' | 'etage' | 'porte' | 'repere', label: string, Ico: typeof IcoImmeuble, max: number, ph?: string, large?: boolean) => (
        <label className={`lv-mini${large ? ' large' : ''}`}>
          <span className="lv-mini-lbl"><Ico size={15} /> {label}</span>
          <input value={p[k]} maxLength={max} placeholder={ph} onChange={(e) => set((x) => ({ ...x, [k]: e.target.value }))} />
        </label>
      );
      return (
        <section className={`lv-etapeur ${role}`}>
          <span className="lv-etapeur-pastille">{role === 'exp' ? <IcoColis size={20} /> : <IcoArrivee size={20} />}</span>
          <div className="lv-etapeur-corps">
            <small className="lv-sur">{t(role === 'exp' ? 'lv_retrait' : 'lv_remise')}</small>
            <strong className="lv-lieu">{lieu}</strong>
            <div className="lv-grille">
              {champ('batiment', t('lv_batiment'), IcoImmeuble, 40, undefined, true)}
              {champ('etage', t('lv_etage'), IcoEscalier, 12)}
              {champ('porte', t('lv_porte_num'), IcoPorte, 12)}
              {champ('repere', t('lv_repere'), IcoRepere, 120, t('lv_repere_ph'), true)}
            </div>
            <div className="lv-qui">
              <span className="lv-qui-titre">{t(role === 'exp' ? 'lv_expediteur' : 'lv_destinataire')}</span>
              <div className="lv-segment" role="radiogroup" aria-label={t(role === 'exp' ? 'lv_expediteur' : 'lv_destinataire')}>
                <button type="button" role="radio" aria-checked={p.moi} className={p.moi ? 'actif' : ''} onClick={() => set((x) => ({ ...x, moi: true }))}>{t('lv_moi')}</button>
                <button type="button" role="radio" aria-checked={!p.moi} className={!p.moi ? 'actif' : ''} onClick={() => set((x) => ({ ...x, moi: false }))}>{t('lv_autre')}</button>
              </div>
              {p.moi ? (
                profil
                  ? <p className="lv-moi"><IcoTelephone size={16} /> {profil.nom} · {profil.telephone}</p>
                  : <p className="lv-alerte">{t('lv_moi_compte')}</p>
              ) : (
                <div className="lv-grille">
                  <label className="lv-mini large"><span className="lv-mini-lbl"><IcoPersonne size={15} /> {t('lv_nom')}</span>
                    <input value={p.nom} maxLength={60} autoComplete="off" onChange={(e) => set((x) => ({ ...x, nom: e.target.value }))} /></label>
                  <label className="lv-mini large"><span className="lv-mini-lbl"><IcoTelephone size={15} /> {t('lv_tel')}</span>
                    <input type="tel" inputMode="tel" value={p.tel} maxLength={25} autoComplete="off" placeholder="07 00 00 00 00" onChange={(e) => set((x) => ({ ...x, tel: e.target.value }))} /></label>
                  <label className="lv-option compacte">
                    <span className="lv-option-ico"><IcoMessage size={20} /></span>
                    <span className="lv-choix-txt"><strong>{t(role === 'exp' ? 'lv_sms_exp' : 'lv_sms_dest')}</strong></span>
                    <input type="checkbox" className="lv-interrupteur" checked={p.sms} onChange={(e) => set((x) => ({ ...x, sms: e.target.checked }))} />
                  </label>
                  {!ok && (p.nom || p.tel) && <p className="lv-alerte">{t(role === 'exp' ? 'lv_requis_exp' : 'lv_requis_dest')}</p>}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    };
    return page(t('lv_e_contacts'), 3, (
      <>
        <header className="lv-intro">
          <h2>{t('lv_contacts_titre')}</h2>
          <p>{t('lv_contacts_d')}</p>
        </header>
        <div className="lv-chronologie">
          {bloc('exp', exp, setExp, departAConfirmer ? t('lieu_a_confirmer') : origin.name, expOk)}
          {bloc('dest', dest, setDest, dropoff?.name ?? '', destOk)}
        </div>
      </>
    ), barre(t('lv_verifier'), () => setEtape(3), expOk && destOk, courant?.amount));
  }

  /* ------------------------------------------------ étape 4 : récapitulatif */
  const b = prixFinal?.breakdown;
  const ligne = (label: string, valeur: string, cls = '') => <div className={`lv-ligne ${cls}`}><span>{label}</span><span>{valeur}</span></div>;
  const lieuPrecis = (p: Partie) => [p.batiment.trim(), p.etage.trim() && `${t('lv_etage')} ${p.etage.trim()}`, p.porte.trim(), p.repere.trim()].filter(Boolean).join(' · ');
  const quiEst = (p: Partie) => (p.moi && profil ? `${t('lv_pour_moi')} · ${profil.nom}` : `${p.nom.trim()} · ${p.tel.trim()}`);
  return page(t('lv_e_recap'), 4, (
    <>
      <section className="lv-recap-tete">
        <img src={image(`liv-${formule}`)} alt="" />
        <div>
          <small>{t('lv_recap')}</small>
          <h2>{nomFormule(formule)}</h2>
          <p>{t(delai === 'express' ? 'lv_express' : delai === 'heure' ? 'lv_heure' : 'lv_deux')} · {t('lv_avant', { h: livreAvant(delai, prixFinal) })}</p>
        </div>
      </section>
      <section className="lv-carte">
        <div className="lv-recap-point"><span className="lv-pastille petite"><IcoColis size={16} /></span><div><small>{t('lv_expediteur')}</small><strong>{origin.name}</strong>{lieuPrecis(exp) && <span className="lv-adresse">{lieuPrecis(exp)}</span>}<span>{quiEst(exp)}</span></div></div>
        <span className="lv-trajet-trait court" aria-hidden="true" />
        <div className="lv-recap-point"><span className="lv-pastille petite cible"><IcoArrivee size={16} /></span><div><small>{t('lv_destinataire')}</small><strong>{dropoff?.name}</strong>{lieuPrecis(dest) && <span className="lv-adresse">{lieuPrecis(dest)}</span>}<span>{quiEst(dest)}</span></div></div>
        <div className="lv-etiquettes">
          <span>{t(portePorte ? 'lv_porte' : 'lv_entree')}</span>
          {options.isotherme && <span><IcoFlocon size={14} /> {t('lv_iso')}</span>}
          {fragile && <span><IcoFragile size={14} /> {t('lv_fragile')}</span>}
          {description && <span>{description}</span>}
        </div>
      </section>
      <section className="lv-carte">
        {/* Les lignes tombent juste : trajet (trafic, zone et demande compris), remise, options,
            promo, puis les taxes avec l'arrondi aux 50 F du prix final. */}
        {b && ligne(t('lv_trajet'), formatXOF(b.subtotal + b.discount + (b.remiseDelai ?? 0) - (b.options ?? 0)))}
        {b?.remiseDelai ? ligne(t('lv_remise_delai'), `−${formatXOF(b.remiseDelai)}`, 'gain') : null}
        {b?.options ? ligne(t('lv_options'), `+${formatXOF(b.options)}`) : null}
        {b?.discount ? ligne('Promo', `−${formatXOF(b.discount)}`, 'gain') : null}
        {b && prixFinal && ligne(t('lv_taxes'), formatXOF(prixFinal.amount - b.subtotal))}
        {ligne(t('conf_total'), prixFinal ? formatXOF(prixFinal.amount) : '…', 'total')}
        <p className="lv-note"><IcoBouclier size={16} /> {t('lv_prix_fixe')}</p>
        <p className="lv-note"><IcoBouclier size={16} /> {t('lv_code_note')}</p>
      </section>
    </>
  ), departAConfirmer
    ? <button type="button" className="lv-cta seul" onClick={onPickup}><span>{t('lieu_confirmer_depart')}</span></button>
    : barre(t('lv_commander', { p: prixFinal ? formatXOF(prixFinal.amount) : '…' }), commander, Boolean(prixFinal) && expOk && destOk));
}
