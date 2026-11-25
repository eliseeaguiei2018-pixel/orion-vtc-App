import { useRef, useState } from 'react';
import { LogoApp } from '../../components/Logo';
import { Drapeau } from '../../components/Drapeau';
import { OrionMap } from '../../components/OrionMap';
import { DEFAULT_ORIGIN } from '../../data';
import type { DriverApp } from '../useDriver';
import { Banner, BoutonLangue, VehiculeChauffeur } from '../ui';
import { LienServeur } from './Serveur';
import { IconBolt, IconChevron, IconLeaf, IconPhone, IconShield } from '../../icons';
import { tr } from '../i18n';

/**
 * ORION PRO — connexion / inscription par téléphone + code SMS, pour les chauffeurs VTC ET les
 * livreurs moto (une seule application, comme Yango Pro).
 *
 * Chauffeurs et livreurs sont salariés d'ORION et roulent sur ses véhicules électriques. Un
 * nouveau compte choisit seulement son MÉTIER (chauffeur VTC ou livreur moto) et donne son nom ;
 * ORION lui attribue ensuite son matricule, son véhicule (voiture ou moto) et sa gamme.
 */
type Metier = 'chauffeur' | 'livreur';
export function Login({ app }: { app: DriverApp }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [registered, setRegistered] = useState(true);
  const [metier, setMetier] = useState<Metier>('chauffeur');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [actif, setActif] = useState(true);
  // Canal du dernier code demandé : le renvoi passe par le même (SMS ou WhatsApp).
  const [canal, setCanal] = useState<'sms' | 'whatsapp'>('sms');
  const champ = useRef<HTMLInputElement>(null);
  const closed = app.appConfig && !app.appConfig.open;
  // Le bouton WhatsApp n'est proposé que si le serveur ORION sait envoyer le code par WhatsApp.
  const whatsapp = app.live && app.appConfig?.codeWhatsApp === true;

  const sendCode = async (par: 'sms' | 'whatsapp' = canal) => {
    setBusy(true);
    const r = await app.actions.requestOtp(phone, par);
    setBusy(false);
    if (!r) return;
    setCanal(par);
    setPhone(r.phone);
    setRegistered(r.registered);
    setDevCode(r.devCode);
    setStep('code');
  };

  const verify = async () => {
    setBusy(true);
    // Chauffeur : aucune gamme envoyée, ORION l'attribue avec le véhicule (console).
    // Livreur : sa catégorie est la moto, il reçoit les livraisons de colis.
    await app.actions.verifyOtp(phone, code, registered ? undefined : name.trim(), registered || metier === 'chauffeur' ? undefined : 'moto');
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
        <div className="eyebrow">{tr('ORION Pro · {0}', [app.appConfig?.city ?? 'Abidjan'])}</div>
        <h1 className="h-title" style={{ fontSize: 26, margin: '4px 0 6px' }}>{tr('Votre poste ORION Pro.')}</h1>
        <p className="h-sub" style={{ marginBottom: 12 }}>{tr('Chauffeurs VTC et livreurs moto : connectez-vous avec votre numéro. Votre véhicule et votre matricule sont attribués par ORION.')}</p>
        <div className="row gap-sm" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="badge green"><IconLeaf size={13} /> {tr('Mobilité verte')}</span>
          <span className="badge"><IconShield size={13} /> {tr('Sécurité chauffeur')}</span>
          <span className="badge"><IconBolt size={13} /> {tr('Véhicule fourni par ORION')}</span>
        </div>

      {!app.live && <Banner tone="info" title={tr('Mode démo')}>{tr('Aucun serveur configuré : offres et console simulées. Code : 123456.')}</Banner>}
      {closed && <Banner tone="danger" icon={<IconShield size={18} />} title={tr('ORION est momentanément fermé')}>{tr('Maintenance en cours — vous pouvez vous connecter, la mise en ligne reprendra à la réouverture.')}</Banner>}

      {step === 'phone' ? (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void sendCode('sms'); }}>
          <div className="field">
            <span className="dialcode"><Drapeau code="CI" taille={18} /> +225</span>
            <input type="tel" inputMode="tel" autoComplete="tel-national" aria-label={tr('Numéro de téléphone')} placeholder="07 08 09 10 11"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 8}>{tr('Recevoir mon code')} <IconChevron size={18} /></button>
          {whatsapp && (
            <button type="button" className="btn btn-ghost" disabled={busy || phone.replace(/\D/g, '').length < 8} onClick={() => void sendCode('whatsapp')}>
              <IconPhone size={18} /> {tr('Recevoir le code via WhatsApp')}
            </button>
          )}
          <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>{tr('Un code à 6 chiffres vous est envoyé par SMS.')}</p>
        </form>
      ) : (
        <form className="dv-form" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <div className="dv-label">{canal === 'whatsapp' ? tr('Code reçu sur WhatsApp au {0}', [phone]) : tr('Code reçu par SMS au {0}', [phone])}</div>
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
              <div className="dv-label">{tr('Votre métier chez ORION')}</div>
              <div className="dv-metier" role="radiogroup" aria-label={tr('Votre métier chez ORION')}>
                {([['chauffeur', 'argent', tr('Chauffeur VTC'), tr('Courses de passagers')], ['livreur', 'moto', tr('Livreur moto'), tr('Livraisons de colis')]] as const).map(([id, cat, titre, sous]) => (
                  <button key={id} type="button" role="radio" aria-checked={metier === id} className={`dv-metier-choix${metier === id ? ' on' : ''}`} onClick={() => setMetier(id)}>
                    <VehiculeChauffeur category={cat} largeur={86} />
                    <strong>{titre}</strong>
                    <span>{sous}</span>
                  </button>
                ))}
              </div>
              <Banner tone="success" title={metier === 'livreur' ? tr('Nouveau livreur ORION') : tr('Nouveau chauffeur ORION')}>
                {metier === 'livreur'
                  ? tr('Créez votre compte avec vos informations. ORION vous attribue ensuite votre matricule et votre moto électrique.')
                  : tr('Créez votre compte avec vos informations. ORION vous attribue ensuite votre matricule, votre véhicule et votre gamme.')}
              </Banner>
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
