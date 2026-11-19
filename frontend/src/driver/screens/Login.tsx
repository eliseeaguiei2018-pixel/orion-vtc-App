import { useRef, useState } from 'react';
import { LogoIcon } from '../../components/Logo';
import type { DriverApp } from '../useDriver';
import { Banner } from '../ui';
import { IconShield } from '../../icons';

/**
 * Connexion / inscription par téléphone + code SMS.
 * Nouveau numéro → inscription (nom + gamme), le dossier est ensuite complété dans l'app.
 */
export function Login({ app }: { app: DriverApp }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('bronze');
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
    await app.actions.verifyOtp(phone, code, registered ? undefined : name.trim(), registered ? undefined : category);
    setBusy(false);
  };

  return (
    <div className="dv-login">
      <div className="dv-login-brand">
        <LogoIcon size={56} />
        <div>
          <div className="eyebrow">ORION Chauffeur</div>
          <div className="h-sub">Mobilité verte · {app.appConfig?.city ?? 'Abidjan'}</div>
        </div>
      </div>
      <h1 className="h-hero">Roulez vert,<br />gagnez plus.</h1>
      <p className="h-sub">Commission réduite sur l’électrique, offres claires, paiement rapide sur mobile money.</p>

      {!app.live && <Banner tone="info" title="Mode démo">Aucun serveur configuré : offres et console simulées. Code : 123456.</Banner>}
      {closed && <Banner tone="danger" icon={<IconShield size={18} />} title="ORION est momentanément fermé">Maintenance en cours — vous pouvez vous connecter, la mise en ligne reprendra à la réouverture.</Banner>}

      {step === 'phone' ? (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <label className="dv-label">Numéro de téléphone
            <input className="dv-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="07 08 09 10 11"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 8}>Recevoir mon code</button>
          <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>Un code à 6 chiffres vous est envoyé par SMS.</p>
        </form>
      ) : (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <div className="dv-label">Code reçu par SMS au {phone}</div>
          {/* Même saisie que l'app cliente : un seul vrai champ affiché en six cases —
              frappe rapide, collage et remplissage automatique du SMS sans chiffre perdu. */}
          <label className="otp-row">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`otp-box${actif && i === Math.min(code.length, 5) ? ' actif' : ''}`} aria-hidden="true">{code[i] ?? ''}</span>
            ))}
            <input ref={champ} className="otp-saisie" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code"
              aria-label="Code à 6 chiffres" value={code} autoFocus onFocus={() => setActif(true)} onBlur={() => setActif(false)}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          {devCode && <p className="otp-dev">Code de test (hors production) : <strong>{devCode}</strong></p>}
          {!registered && (
            <>
              <Banner tone="success" title="Nouveau chauffeur ORION">Créez votre compte : votre dossier sera ensuite à compléter dans l’app.</Banner>
              <label className="dv-label">Nom complet
                <input className="dv-input" autoComplete="name" placeholder="Ex. Konan Yao" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="dv-label">Gamme de véhicule
                <select className="dv-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="bronze">Bronze — citadine électrique</option>
                  <option value="argent">Argent — berline confort</option>
                  <option value="or">Or — berline premium</option>
                  <option value="diamant">Diamant — prestige</option>
                  <option value="moto">Moto — coursier (livraison de colis)</option>
                </select>
              </label>
            </>
          )}
          <button className="btn btn-primary" disabled={busy || code.length !== 6 || (!registered && name.trim().length < 2)}>
            {registered ? 'Se connecter' : 'Créer mon compte'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => { setCode(''); champ.current?.focus(); void sendCode(); }}>Renvoyer le code</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setStep('phone'); setCode(''); }}>Changer de numéro</button>
        </form>
      )}
    </div>
  );
}
