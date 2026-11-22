import { useRef, useState } from 'react';
import { LogoApp } from '../../components/Logo';
import { Drapeau } from '../../components/Drapeau';
import { OrionMap } from '../../components/OrionMap';
import { DEFAULT_ORIGIN } from '../../data';
import type { DriverApp } from '../useDriver';
import { Banner, BoutonLangue, VehiculeChauffeur } from '../ui';
import { LienServeur } from './Serveur';
import { IconBolt, IconChevron, IconLeaf, IconShield } from '../../icons';
import { tr } from '../i18n';

/**
 * Connexion / inscription par téléphone + code SMS.
 *
 * Les chauffeurs ORION sont des salariés d'ORION et roulent sur les véhicules d'ORION. Un
 * nouveau chauffeur ne donne que SES informations (nom, puis date de naissance et permis
 * dans son profil) : il ne choisit ni gamme ni type de course, et ne saisit rien sur le
 * véhicule. ORION lui attribue son matricule, son véhicule et sa gamme depuis la console.
 */
export function Login({ app }: { app: DriverApp }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [registered, setRegistered] = useState(true);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [actif, setActif] = useState(true);
  const champ = useRef<HTMLInputElement>(null);
  const closed = app.appConfig && !app.appConfig.open;

  const sendCode = async () => {
    setBusy(true);
    const r = await app.actions.requestOtp(phone);
    setBusy(false);
    if (!r) return;
    setPhone(r.phone);
    setRegistered(r.registered);
    setDevCode(r.devCode);
    setStep('code');
  };

  const verify = async () => {
    setBusy(true);
    // Aucune gamme envoyée : ORION l'attribue avec le véhicule (console).
    await app.actions.verifyOtp(phone, code, registered ? undefined : name.trim(), undefined);
    setBusy(false);
  };

  return (
    <div className="dv-auth">
      {/* Même mise en scène que l'app cliente : la vraie carte de la ville en fond,
          une feuille posée dessus pour la connexion. */}
      <OrionMap origin={DEFAULT_ORIGIN.location} />
      <div className="dv-auth-fond" />
      <BoutonLangue />
      <div className="sheet">
        <div className="grabber" />
        <div className="row between dv-auth-icone">
          <LogoApp size={56} />
          <div className="dv-auth-veh" aria-hidden="true"><VehiculeChauffeur category="argent" largeur={120} /></div>
        </div>
        <div className="eyebrow">{tr('ORION Chauffeur · {0}', [app.appConfig?.city ?? 'Abidjan'])}</div>
        <h1 className="h-title" style={{ fontSize: 26, margin: '4px 0 6px' }}>{tr('Votre poste de chauffeur ORION.')}</h1>
        <p className="h-sub" style={{ marginBottom: 12 }}>{tr('Connectez-vous avec votre numéro. Votre véhicule, votre gamme et votre matricule sont attribués par ORION.')}</p>
        <div className="row gap-sm" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="badge green"><IconLeaf size={13} /> {tr('Mobilité verte')}</span>
          <span className="badge"><IconShield size={13} /> {tr('Sécurité chauffeur')}</span>
          <span className="badge"><IconBolt size={13} /> {tr('Véhicule fourni par ORION')}</span>
        </div>

      {!app.live && <Banner tone="info" title={tr('Mode démo')}>{tr('Aucun serveur configuré : offres et console simulées. Code : 123456.')}</Banner>}
      {closed && <Banner tone="danger" icon={<IconShield size={18} />} title={tr('ORION est momentanément fermé')}>{tr('Maintenance en cours — vous pouvez vous connecter, la mise en ligne reprendra à la réouverture.')}</Banner>}

      {step === 'phone' ? (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <div className="field">
            <span className="dialcode"><Drapeau code="CI" taille={18} /> +225</span>
            <input type="tel" inputMode="tel" autoComplete="tel-national" aria-label={tr('Numéro de téléphone')} placeholder="07 08 09 10 11"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 8}>{tr('Recevoir mon code')} <IconChevron size={18} /></button>
          <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>{tr('Un code à 6 chiffres vous est envoyé par SMS.')}</p>
        </form>
      ) : (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <div className="dv-label">{tr('Code reçu par SMS au {0}', [phone])}</div>
          {/* Même saisie que l'app cliente : un seul vrai champ affiché en six cases —
              frappe rapide, collage et remplissage automatique du SMS sans chiffre perdu. */}
          <label className="otp-row">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`otp-box${actif && i === Math.min(code.length, 5) ? ' actif' : ''}`} aria-hidden="true">{code[i] ?? ''}</span>
            ))}
            <input ref={champ} className="otp-saisie" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code"
              aria-label={tr('Code à 6 chiffres')} value={code} autoFocus onFocus={() => setActif(true)} onBlur={() => setActif(false)}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          {devCode && <p className="otp-dev">{tr('Code de test (hors production) :')} <strong>{devCode}</strong></p>}
          {!registered && (
            <>
              <Banner tone="success" title={tr('Nouveau chauffeur ORION')}>{tr('Créez votre compte avec vos informations. ORION vous attribue ensuite votre matricule, votre véhicule et votre gamme.')}</Banner>
              <div className="field">
                <input autoComplete="name" aria-label={tr('Nom complet')} placeholder={tr('Nom complet (ex. Konan Yao)')} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </>
          )}
          <button className="btn btn-primary" disabled={busy || code.length !== 6 || (!registered && name.trim().length < 2)}>
            {registered ? tr('Se connecter') : tr('Créer mon compte')}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => { setCode(''); champ.current?.focus(); void sendCode(); }}>{tr('Renvoyer le code')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setStep('phone'); setCode(''); }}>{tr('Changer de numéro')}</button>
        </form>
      )}
      <LienServeur />
      </div>
    </div>
  );
}
