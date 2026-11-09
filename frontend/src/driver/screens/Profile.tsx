import { useState } from 'react';
import { IconCheck, IconShield, IconStar } from '../../icons';
import { useTheme, type ThemeMode } from '../../theme';
import type { ScreenProps } from '../Driver';
import type { DriverProfile, KycStatus, ProfilePatch } from '../types';
import { Banner, BellButton, PageHeader, Progress, Section, Stat } from '../ui';
import { daysUntil, initials, KYC_LABEL, pct, shortDate, TIER_LABEL } from '../format';

const PIPELINE: KycStatus[] = ['draft', 'docs_submitted', 'manual_review', 'active'];
const PLUGS = ['Type 2', 'CCS', 'CHAdeMO', 'Type 1', 'GB/T'];

/** Champs exigés par le backend pour soumettre le dossier (POST /drivers/:id/kyc/submit). */
const REQUIRED: Array<[keyof DriverProfile, string]> = [
  ['phone', 'Téléphone'], ['birthDate', 'Date de naissance'], ['licenseNo', 'Numéro de permis'],
  ['vehicleModel', 'Modèle du véhicule'], ['vehiclePlate', 'Immatriculation'],
  ['vehicleColor', 'Couleur du véhicule'], ['insuranceExpiry', 'Échéance de l’assurance'],
];

type Form = Required<Pick<ProfilePatch, 'birthDate' | 'licenseNo' | 'vehicleModel' | 'vehiclePlate' | 'vehicleColor' | 'insuranceExpiry' | 'plugType' | 'nif'>>
  & { batteryKwh: string; cablesConfirmed: boolean };

const fromDriver = (d: DriverProfile): Form => ({
  birthDate: d.birthDate ?? '', licenseNo: d.licenseNo ?? '', vehicleModel: d.vehicleModel ?? '', vehiclePlate: d.vehiclePlate ?? '',
  vehicleColor: d.vehicleColor ?? '', insuranceExpiry: d.insuranceExpiry ?? '', plugType: d.plugType ?? '', nif: d.nif ?? '',
  batteryKwh: d.batteryKwh !== undefined ? String(d.batteryKwh) : '', cablesConfirmed: d.cablesConfirmed ?? false,
});

/**
 * PROFIL : dossier chauffeur (KYC) à compléter puis soumettre à ORION, suivi de la
 * validation en direct (console), conformité verte, qualité, préférences, déconnexion.
 */
export function Profile({ app, unread, openNotices }: ScreenProps) {
  const driver = app.driver!;
  const { mode, setMode } = useTheme();
  const [form, setForm] = useState<Form>(() => fromDriver(driver));
  const [engine, setEngine] = useState<'electric' | 'hybrid'>(driver.engine ?? 'electric');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const stepIdx = driver.kycStatus === 'approved' ? 3 : Math.max(0, PIPELINE.indexOf(driver.kycStatus));
  const missing = REQUIRED.filter(([k]) => !driver[k]).map(([, l]) => l);
  const canSubmit = driver.kycStatus === 'draft' && missing.length === 0;
  const insurance = daysUntil(driver.insuranceExpiry);
  const received = driver.offersReceived ?? 0;

  /** N'envoie que les champs modifiés et non vides (validation serveur Zod). */
  const save = async () => {
    const before = fromDriver(driver);
    const patch: ProfilePatch = {};
    (['birthDate', 'licenseNo', 'vehicleModel', 'vehiclePlate', 'vehicleColor', 'insuranceExpiry', 'plugType', 'nif'] as const).forEach((k) => {
      const v = form[k].trim();
      if (v && v !== before[k]) patch[k] = v;
    });
    if (form.batteryKwh && form.batteryKwh !== before.batteryKwh) patch.batteryKwh = Number(form.batteryKwh);
    if (form.cablesConfirmed !== before.cablesConfirmed) patch.cablesConfirmed = form.cablesConfirmed;
    if (Object.keys(patch).length) await app.actions.updateProfile(patch);
    if (engine !== (driver.engine ?? 'electric')) await app.actions.telemetry({ engine });
  };

  return (
    <div className="dv-page">
      <PageHeader title="Mon profil" sub="Dossier, conformité et qualité" right={<BellButton count={unread} onClick={openNotices} />} />

      <div className="card dv-item" style={{ padding: 16 }}>
        <div className="driver-photo">{initials(driver.name)}</div>
        <div className="grow">
          <div className="dv-item-title" style={{ fontSize: 17 }}>{driver.name}</div>
          <div className="dv-item-sub">{driver.matricule} · {driver.phone}</div>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span className={`dv-pill ${driver.kycStatus === 'suspended' ? 'danger' : driver.kycStatus === 'active' || driver.kycStatus === 'approved' ? 'green' : 'gold'}`}>{KYC_LABEL[driver.kycStatus]}</span>
            <span className="dv-pill">Gamme {TIER_LABEL[driver.category] ?? driver.category}</span>
            {driver.vip && <span className="dv-pill gold">⭐ Top Driver</span>}
            {driver.loyaltyTier && <span className="dv-pill green">Fidélité {driver.loyaltyTier === 'gold' ? 'Or' : driver.loyaltyTier === 'silver' ? 'Argent' : 'Bronze'}</span>}
          </div>
        </div>
      </div>

      <Section title="Validation du dossier">
        {driver.kycStatus === 'suspended' ? (
          <Banner tone="danger" icon={<IconShield size={18} />} title="Compte suspendu par ORION">{driver.suspensionReason ? `Motif : ${driver.suspensionReason}` : 'Contactez le support ORION.'}</Banner>
        ) : (
          <div className="card" style={{ padding: 14 }}>
            <div className="dv-steps">{PIPELINE.map((s, i) => <span key={s} className={i <= stepIdx ? 'done' : ''} />)}</div>
            <div className="row between" style={{ marginTop: 8, fontSize: 11.5 }}>
              <span className="faint">Brouillon</span><span className="faint">Envoyé</span><span className="faint">Examen</span><span className="faint">Validé</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 14 }}><strong>{KYC_LABEL[driver.kycStatus]}</strong></div>
            {driver.kycStatus === 'draft' && (
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {missing.length ? `À compléter : ${missing.join(', ')}.` : 'Dossier complet : envoyez-le à ORION pour validation.'}
              </div>
            )}
          </div>
        )}
        {driver.kycStatus === 'draft' && (
          <button className="btn btn-primary" disabled={!canSubmit || app.busy} onClick={() => void app.actions.submitKyc()}>Envoyer mon dossier à ORION</button>
        )}
        <div className="card" style={{ padding: 14, fontSize: 13 }}>
          <strong>Pièces originales à présenter en agence ORION</strong>
          <div className="muted" style={{ marginTop: 6, lineHeight: 1.6 }}>
            Pièce d’identité (CNI) · Permis de conduire · Carte grise · Attestation d’assurance · Visite technique · Casier judiciaire (moins de 3 mois)
          </div>
        </div>
      </Section>

      <Section title="Identité & véhicule">
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="dv-grid2">
            <label className="dv-label">Date de naissance<input className="dv-input" type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
            <label className="dv-label">N° de permis<input className="dv-input" value={form.licenseNo} maxLength={30} onChange={(e) => set('licenseNo', e.target.value)} /></label>
          </div>
          <label className="dv-label">Modèle du véhicule<input className="dv-input" placeholder="Ex. BYD Dolphin" value={form.vehicleModel} maxLength={60} onChange={(e) => set('vehicleModel', e.target.value)} /></label>
          <div className="dv-grid2">
            <label className="dv-label">Immatriculation<input className="dv-input" placeholder="1234 AB 01" value={form.vehiclePlate} maxLength={15} onChange={(e) => set('vehiclePlate', e.target.value.toUpperCase())} /></label>
            <label className="dv-label">Couleur<input className="dv-input" placeholder="Blanc" value={form.vehicleColor} maxLength={20} onChange={(e) => set('vehicleColor', e.target.value)} /></label>
          </div>
          <label className="dv-label">Échéance de l’assurance<input className="dv-input" type="date" value={form.insuranceExpiry} onChange={(e) => set('insuranceExpiry', e.target.value)} /></label>
          {insurance !== null && insurance <= 30 && <div className="faint" style={{ fontSize: 12, color: insurance < 0 ? 'var(--danger)' : 'var(--gold)' }}>{insurance < 0 ? 'Assurance expirée.' : `Expire dans ${insurance} jours.`}</div>}

          <h3 className="dv-section-title" style={{ marginTop: 6 }}>Conformité verte</h3>
          <div className="dv-seg" role="group" aria-label="Motorisation">
            <button type="button" className={engine === 'electric' ? 'on' : ''} onClick={() => setEngine('electric')}>⚡ 100 % électrique</button>
            <button type="button" className={engine === 'hybrid' ? 'on' : ''} onClick={() => setEngine('hybrid')}>Hybride</button>
          </div>
          <div className="dv-grid2">
            <label className="dv-label">Batterie (kWh)<input className="dv-input" type="number" min={0} max={300} inputMode="decimal" value={form.batteryKwh} onChange={(e) => set('batteryKwh', e.target.value)} /></label>
            <label className="dv-label">Type de prise
              <select className="dv-select" value={form.plugType} onChange={(e) => set('plugType', e.target.value)}>
                <option value="">—</option>
                {PLUGS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <label className="dv-check"><input type="checkbox" checked={form.cablesConfirmed} onChange={(e) => set('cablesConfirmed', e.target.checked)} />Câbles de recharge réglementaires à bord</label>

          <h3 className="dv-section-title" style={{ marginTop: 6 }}>Fiscalité & virements</h3>
          <label className="dv-label">N° d’identification fiscale (NIF)<input className="dv-input" value={form.nif} maxLength={40} onChange={(e) => set('nif', e.target.value)} /></label>
          <div className="row" style={{ gap: 8, fontSize: 13 }}>
            {driver.ribVerified ? <><IconCheck size={16} /><span>Compte de virement vérifié par ORION</span></> : <span className="faint">Compte de virement : vérification par ORION en attente</span>}
          </div>
          <button className="btn btn-primary" disabled={app.busy}>Enregistrer</button>
        </form>
      </Section>

      <Section title="Qualité de service">
        <div className="dv-stats">
          <Stat label="Note moyenne" value={<span className="row" style={{ gap: 4 }}><IconStar size={17} color="var(--gold)" />{driver.ratingCount ? driver.ratingAvg.toFixed(2) : '—'}</span>}
            sub={`Minimum exigé : ${app.driverConfig.quality.minRating.toFixed(1)}`} />
          <Stat label="Avertissements" value={driver.warnings ?? 0} sub={app.driverConfig.quality.autoWarn ? 'Automatiques sous le seuil' : 'Manuels'} />
          <Stat label="Taux d’acceptation" value={received ? pct((driver.offersAccepted ?? 0) / received) : '—'} sub={`${driver.offersAccepted ?? 0}/${received} offres`} />
          <Stat label="Offres manquées" value={driver.offersExpired ?? 0} sub={`${driver.offersDeclined ?? 0} refusée${(driver.offersDeclined ?? 0) > 1 ? 's' : ''}`} />
        </div>
        {driver.ratingCount > 0 && <Progress value={driver.ratingAvg} max={5} tone={driver.ratingAvg < app.driverConfig.quality.minRating ? 'danger' : 'green'} />}
      </Section>

      <Section title="Préférences">
        <div className="dv-seg" role="group" aria-label="Thème">
          {([['system', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']] as Array<[ThemeMode, string]>).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {driver.appLinkedAt ? `App liée depuis le ${shortDate(driver.appLinkedAt)} · ` : ''}{app.live ? 'Serveur ORION' : 'Mode démo'}
        </div>
        <button className="btn btn-ghost" onClick={() => void app.actions.logout()} disabled={driver.availability === 'on_trip'}>Se déconnecter</button>
      </Section>
    </div>
  );
}
