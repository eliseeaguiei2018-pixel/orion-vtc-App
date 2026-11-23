import { useRef, useState } from 'react';
import { IconCamera, IconCheck, IconImage, IconPhone, IconShield, IconStar } from '../../icons';
import type { Accent } from '../../theme';
import { ChoixCouleur, ChoixTheme } from '../../components/Apparence';
import { EMERGENCY_NUMBERS } from '../../api';
import type { ScreenProps } from '../Driver';
import type { DriverProfile, KycStatus, ProfilePatch } from '../types';
import { Banner, BellButton, ChoixLangue, PageHeader, Progress, Section, Stat, VehiculeChauffeur } from '../ui';
import { gammesLisibles, initials, KYC_LABEL, pct, shortDate } from '../format';
import { aTraduire, tr } from '../i18n';
import { ConnecterEcranVehicule } from './Appairage';
import { BlocBiometrie } from '../../components/CompteScreens';
import { VERSION_APP } from '../../version';
import { LienServeur } from './Serveur';

const PIPELINE: KycStatus[] = ['draft', 'docs_submitted', 'manual_review', 'active'];

/**
 * Champs exigés pour soumettre le dossier (POST /drivers/:id/kyc/submit) : uniquement les
 * informations du chauffeur. Les chauffeurs ORION sont salariés et roulent sur les véhicules
 * d'ORION : véhicule, gamme, assurance et recharge sont attribués par ORION, pas saisis ici.
 */
const REQUIRED: Array<[keyof DriverProfile, string]> = [
  ['phone', aTraduire('Téléphone')], ['birthDate', aTraduire('Date de naissance')], ['licenseNo', aTraduire('Numéro de permis')],
];

type Form = Required<Pick<ProfilePatch, 'birthDate' | 'licenseNo'>>;

const fromDriver = (d: DriverProfile): Form => ({ birthDate: d.birthDate ?? '', licenseNo: d.licenseNo ?? '' });

/**
 * PROFIL : dossier chauffeur (KYC) à compléter puis soumettre à ORION, suivi de la
 * validation en direct (console), conformité verte, qualité, préférences, déconnexion.
 */
export function Profile({ app, unread, openNotices }: ScreenProps) {
  const driver = app.driver!;
  const COULEURS: Record<Accent, string> = {
    vert: tr('Vert ORION'), orange: tr('Orange'), bleu: tr('Bleu'), blanc: tr('Blanc'),
    jaune: tr('Jaune'), marron: tr('Marron'), violet: tr('Violet'), rose: tr('Rose'),
  };
  const photo = app.backend.photoSrc(driver);
  const [form, setForm] = useState<Form>(() => fromDriver(driver));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const stepIdx = driver.kycStatus === 'approved' ? 3 : Math.max(0, PIPELINE.indexOf(driver.kycStatus));
  const missing = REQUIRED.filter(([k]) => !driver[k]).map(([, l]) => tr(l));
  const canSubmit = driver.kycStatus === 'draft' && missing.length === 0;
  const received = driver.offersReceived ?? 0;

  /** N'envoie que les informations personnelles modifiées et non vides (validation serveur Zod). */
  const save = async () => {
    const before = fromDriver(driver);
    const patch: ProfilePatch = {};
    (['birthDate', 'licenseNo'] as const).forEach((k) => {
      const v = form[k].trim();
      if (v && v !== before[k]) patch[k] = v;
    });
    if (Object.keys(patch).length) await app.actions.updateProfile(patch);
  };
  const vehiculeAttribue = Boolean(driver.vehicleModel || driver.vehiclePlate);

  return (
    <div className="dv-page">
      <PageHeader title={tr('Mon profil')} sub={tr('Dossier, conformité et qualité')} right={<BellButton count={unread} onClick={openNotices} />} />

      {/* Portrait du chauffeur posé sur l'en-tête, véhicule de sa gamme dessous. */}
      <div className="card dv-portrait-card">
        <div className="dv-portrait">
          <div className="dv-portrait-photo">
            {photo ? <img src={photo} alt={driver.name} /> : initials(driver.name)}
          </div>
          <div>
            <div className="h-title" style={{ fontSize: 21 }}>{driver.name}</div>
            <div className="dv-item-sub">{driver.matricule} · {driver.phone}</div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <span className={`dv-pill ${driver.kycStatus === 'suspended' ? 'danger' : driver.kycStatus === 'active' || driver.kycStatus === 'approved' ? 'green' : 'gold'}`}>{KYC_LABEL[driver.kycStatus]}</span>
            {driver.vip && <span className="dv-pill gold">{tr('Top Driver')}</span>}
            {driver.loyaltyTier && <span className="dv-pill green">{tr('Fidélité {0}', [driver.loyaltyTier === 'gold' ? tr('Diamant') : driver.loyaltyTier === 'silver' ? tr('Or') : tr('Argent')])}</span>}
          </div>
          {vehiculeAttribue && (
            <div className={`dv-stage dv-portrait-stage${driver.category === 'moto' ? ' moto' : ''}`}>
              <span className="dv-stage-tag dv-pill">{[driver.vehicleModel, driver.vehiclePlate, driver.vehicleColor].filter(Boolean).join(' · ')}</span>
              <VehiculeChauffeur category={driver.category} largeur={150} />
            </div>
          )}
        </div>
      </div>

      {/* Ce qu'ORION attribue au chauffeur : lecture seule, rattaché à son matricule. */}
      <Section title={tr('Attribué par ORION')}>
        <div className="card dv-attribution">
          <div className="row between"><span className="faint">{tr('Matricule')}</span><strong>{driver.matricule}</strong></div>
          <div className="row between"><span className="faint">{tr('Gamme')}</span><strong>{vehiculeAttribue ? gammesLisibles(driver) : tr('En attente')}</strong></div>
          <div className="row between"><span className="faint">{tr('Véhicule')}</span><strong>{vehiculeAttribue ? [driver.vehicleModel, driver.vehicleColor].filter(Boolean).join(' · ') : tr('En attente')}</strong></div>
          <div className="row between"><span className="faint">{tr('Immatriculation')}</span><strong>{driver.vehiclePlate || tr('En attente')}</strong></div>
          <div className="faint" style={{ fontSize: 12.5 }}>{tr('Votre véhicule, sa gamme, son assurance et sa recharge sont gérés par ORION. Vous n’avez rien à saisir : connectez-vous et commencez vos courses.')}</div>
        </div>
      </Section>

      <PhotoChauffeur app={app} aUnePhoto={Boolean(photo)} />

      <Section title={tr('Validation du dossier')}>
        {driver.kycStatus === 'suspended' ? (
          <Banner tone="danger" icon={<IconShield size={18} />} title={tr('Compte suspendu par ORION')}>{driver.suspensionReason ? tr('Motif : {0}', [driver.suspensionReason]) : tr('Contactez le support ORION.')}</Banner>
        ) : (
          <div className="card" style={{ padding: 14 }}>
            <div className="dv-steps">{PIPELINE.map((s, i) => <span key={s} className={i <= stepIdx ? 'done' : ''} />)}</div>
            <div className="row between" style={{ marginTop: 8, fontSize: 11.5 }}>
              <span className="faint">{tr('Brouillon')}</span><span className="faint">{tr('Envoyé')}</span><span className="faint">{tr('Examen')}</span><span className="faint">{tr('Validé')}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 14 }}><strong>{KYC_LABEL[driver.kycStatus]}</strong></div>
            {driver.kycStatus === 'draft' && (
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {missing.length ? tr('À compléter : {0}.', [missing.join(', ')]) : tr('Dossier complet : envoyez-le à ORION pour validation.')}
              </div>
            )}
          </div>
        )}
        {driver.kycStatus === 'draft' && (
          <button className="btn btn-primary" disabled={!canSubmit || app.busy} onClick={() => void app.actions.submitKyc()}>{tr('Envoyer mon dossier à ORION')}</button>
        )}
        <div className="card" style={{ padding: 14, fontSize: 13 }}>
          <strong>{tr('Pièces originales à présenter en agence ORION')}</strong>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
            {tr('Pièce d’identité (CNI) · Permis de conduire · Casier judiciaire (moins de 3 mois) · Certificat de résidence')}
          </div>
        </div>
      </Section>

      <Section title={tr('Mes informations')}>
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="dv-label">{tr('Nom complet')}<input className="dv-input" value={driver.name} readOnly aria-readonly="true" /></label>
          <label className="dv-label">{tr('Téléphone')}<input className="dv-input" value={driver.phone ?? ''} readOnly aria-readonly="true" /></label>
          <div className="dv-grid2">
            <label className="dv-label">{tr('Date de naissance')}<input className="dv-input" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
            <label className="dv-label">{tr('N° de permis')}<input className="dv-input" value={form.licenseNo} maxLength={30} onChange={(e) => set('licenseNo', e.target.value)} /></label>
          </div>
          <button className="btn btn-primary" disabled={app.busy}>{tr('Enregistrer')}</button>
        </form>
      </Section>

      <Section title={tr('Qualité de service')}>
        <div className="dv-stats">
          <Stat label={tr('Note moyenne')} value={<span className="row" style={{ gap: 4 }}><IconStar size={17} color="var(--gold)" />{driver.ratingCount ? driver.ratingAvg.toFixed(2) : '—'}</span>}
            sub={tr('Minimum exigé : {0}', [app.driverConfig.quality.minRating.toFixed(1)])} />
          <Stat label={tr('Avertissements')} value={driver.warnings ?? 0} sub={app.driverConfig.quality.autoWarn ? tr('Automatiques sous le seuil') : tr('Manuels')} />
          <Stat label={tr('Taux d’acceptation')} value={received ? pct((driver.offersAccepted ?? 0) / received) : '—'} sub={tr('{0}/{1} offres', [driver.offersAccepted ?? 0, received])} />
          <Stat label={tr('Offres manquées')} value={driver.offersExpired ?? 0} sub={tr((driver.offersDeclined ?? 0) > 1 ? '{0} refusées' : '{0} refusée', [driver.offersDeclined ?? 0])} />
        </div>
        {driver.ratingCount > 0 && <Progress value={driver.ratingAvg} max={5} tone={driver.ratingAvg < app.driverConfig.quality.minRating ? 'danger' : 'green'} />}
      </Section>

      <Section title={tr('Préférences')}>
        {/* Mêmes réglages que l'app cliente 1.5.9 : thème, couleur, empreinte ou visage, langue. */}
        <div className="dv-pref-titre">{tr('Thème')}</div>
        <ChoixTheme libelles={{ light: tr('Clair'), dark: tr('Sombre'), system: tr('Système') }} />
        <div className="dv-pref-titre">{tr('Couleur')}</div>
        <ChoixCouleur titre={tr('Couleur')} libelle={(a) => COULEURS[a]} />
        <div className="dv-pref-titre">{tr('Empreinte digitale / Face ID')}</div>
        <BlocBiometrie />
        <div className="dv-pref-titre">{tr('Langue de l’application')}</div>
        <ChoixLangue />
        <div className="faint" style={{ fontSize: 12 }}>
          {tr('ORION Chauffeur · version {0}', [VERSION_APP])} · {driver.appLinkedAt ? tr('App liée depuis le {0} · ', [shortDate(driver.appLinkedAt)]) : ''}{app.live ? tr('Serveur ORION') : tr('Mode démo')}
        </div>
        <LienServeur />
        <button className="btn btn-ghost" onClick={() => void app.actions.logout()} disabled={driver.availability === 'on_trip'}>{tr('Se déconnecter')}</button>
      </Section>

      <Section title={tr('Écran de véhicule')}>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 10, fontSize: 13.5 }}>
          <div className="faint">{tr('Ouvrez l’app ORION Chauffeur sur l’écran large de votre voiture (Android Automotive, écran du constructeur, tablette de bord) sans ressaisir vos identifiants.')}</div>
          <ConnecterEcranVehicule app={app} />
        </div>
      </Section>

      <Section title={tr('Aide & sécurité')}>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8, fontSize: 13.5 }}>
          <div>{tr('En danger pendant une course ou à l’arrêt : bouton')} <strong>{tr('SOS')}</strong> {tr('(accueil et course). Un agent ORION prend l’alerte et vous suivez sa prise en charge en direct.')}</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {([[tr('SAMU'), EMERGENCY_NUMBERS.samu], [tr('Police'), EMERGENCY_NUMBERS.police], [tr('Pompiers'), EMERGENCY_NUMBERS.pompiers]] as Array<[string, string]>).map(([l, n]) => (
              <a key={n} className="dv-pill danger" href={`tel:${n}`}><IconPhone size={13} /> {l} {n}</a>
            ))}
          </div>
          <div className="faint">{tr('Une demande (prêt, avance, congé, réparation, réclamation) se fait dans')} <strong>{tr('Mon poste')}</strong>{'\u00a0'}{tr('; votre chef d’équipe la reçoit.')}</div>
          <a href="./confidentialite.html" target="_blank" rel="noreferrer" style={{ color: 'var(--green)', display: 'inline-block', padding: '6px 0', minHeight: 24 }}>{tr('Politique de confidentialité ORION')}</a>
        </div>
      </Section>
    </div>
  );
}

/** Lit une image, la recadre au carré et la réduit (480 px, JPEG) : légère et nette. */
async function versPhotoCarree(fichier: File): Promise<string> {
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('image')); img.src = url; });
    const cote = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote, 0, 0, 480, 480);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * PHOTO DU CHAUFFEUR : le passager la voit à l'attribution (avec le véhicule et la vraie
 * plaque) pour reconnaître son chauffeur ; la supervision la voit dans le dossier SOS.
 */
function PhotoChauffeur({ app, aUnePhoto }: { app: ScreenProps['app']; aUnePhoto: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const galerie = useRef<HTMLInputElement>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const choisir = async (f: File | undefined) => {
    if (!f) return;
    try { setApercu(await versPhotoCarree(f)); } catch { app.showToast(tr('Image illisible — choisissez une photo JPEG ou PNG'), 'danger'); }
  };
  return (
    <Section title={tr('Ma photo')}>
      <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={(e) => void choisir(e.target.files?.[0])} />
      <input ref={galerie} type="file" accept="image/*" hidden onChange={(e) => void choisir(e.target.files?.[0])} />
      <div className="faint" style={{ fontSize: 12.5 }}>{tr('Visage dégagé, sans lunettes de soleil : vos passagers vous reconnaissent à la prise en charge.')}</div>
      {apercu ? (
        <div className="col" style={{ gap: 8, alignItems: 'center' }}>
          <img src={apercu} alt={tr('Aperçu')} style={{ width: 140, height: 140, borderRadius: 24, objectFit: 'cover', border: '1px solid var(--stroke)' }} />
          <div className="dv-grid2" style={{ width: '100%' }}>
            <button className="btn btn-ghost" onClick={() => setApercu(null)}>{tr('Reprendre')}</button>
            <button className="btn btn-primary" disabled={app.busy} onClick={() => void app.actions.setPhoto(apercu).then((ok) => { if (ok) setApercu(null); })}><IconCheck size={16} /> {tr('Utiliser')}</button>
          </div>
        </div>
      ) : (
        <div className="dv-grid2">
          <button className="btn btn-ghost" onClick={() => camera.current?.click()}><IconCamera size={16} /> {aUnePhoto ? tr('Nouvelle photo') : tr('Prendre une photo')}</button>
          <button className="btn btn-ghost" onClick={() => galerie.current?.click()}><IconImage size={16} /> {tr('Galerie')}</button>
        </div>
      )}
      {aUnePhoto && !apercu && <button className="dv-pill" style={{ justifySelf: 'start' }} onClick={() => void app.actions.deletePhoto()}>{tr('Retirer ma photo')}</button>}
    </Section>
  );
}
