import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet, TopBar } from './ui';
import {
  IconAlarm, IconArrowLeft, IconBriefcase, IconBuilding, IconCalendar, IconCamera, IconCheck, IconChevron, IconClock, IconClose, IconContacts, IconCrown, IconFingerprint, IconGift, IconGlobe, IconHeadset, IconHome, IconImage,
  IconInfo, IconLock, IconMap, IconMessage, IconMobile, IconMonitor, IconPin, IconPlus, IconSettings, IconShield, IconShieldCheck, IconPhone, IconStar, IconSteering, IconUser, IconUsers, IconWallet,
} from '../icons';
import { useI18n, LANGUAGES, type Lang } from '../i18n';
import { Drapeau } from './Drapeau';
import { Objet } from './Vehicules';
import { lieuEnregistre, lieuxRecents } from '../lieux';
import type { Place } from '../types';
import { ACCENTS, useTheme, type ThemeMode } from '../theme';
import { COUNTRIES, formatXOF } from '../data';
import {
  biometrieLieeDepuis, etatBiometrie, isBiometricEnabled, setBiometricEnabled, verifierBiometrie,
  type EtatBio, type ResultatBio,
} from '../security';
import { annulerProgrammee, coursesProgrammees, libelleQuand } from '../programmees';
import { Anneau } from './CompteExtras';
import { OFFRE_PARRAINAGE } from '../compte';
import {
  AGENT_GENERIQUE, MOTIFS_ANNULATION, etatServeur, annulerCourse, apercuAnnulation, chargerHistorique, envoyerPhoto, mesAlertesSos,
  modifierProfil, retirerPhoto, sessionClient,
  type CourseHistorique, type FraisAnnulation, type Historique, type MotifAnnulation, type ProfilClient, type SosSuivi,
  type TrustedContact,
} from '../api';

/* ================================ PHOTO ================================ */

/**
 * Recadre au centre, réduit à 512 px et compresse en JPEG : une photo de téléphone
 * (3 à 8 Mo) part en quelques dizaines de Ko, ce qui compte sur un réseau mobile.
 */
function versDataUrl(source: CanvasImageSource, largeur: number, hauteur: number, miroir = false): string {
  const cote = Math.min(largeur, hauteur);
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d')!;
  if (miroir) { ctx.translate(512, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (largeur - cote) / 2, (hauteur - cote) / 2, cote, cote, 0, 0, 512, 512);
  let q = 0.86;
  let url = c.toDataURL('image/jpeg', q);
  while (url.length > 480_000 && q > 0.5) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
  return url;
}

async function fichierVersDataUrl(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('image')); img.src = url; });
    return versDataUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Avatar({ photo, name, size = 44 }: { photo?: string | null; name?: string | null; size?: number }) {
  const initiales = (name ?? '').trim().split(/\s+/).map((x) => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '';
  return photo
    ? <img className="profil-avatar" src={photo} alt="" style={{ width: size, height: size }} />
    : <span className="profil-avatar initiales" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initiales}</span>;
}

/**
 * Prendre une photo (caméra frontale, en direct) ou la choisir dans la galerie.
 * Si la caméra est refusée ou absente, on bascule sur le sélecteur de l'appareil
 * (qui, sur téléphone, propose aussi l'appareil photo).
 */
export function PhotoCapture({ onPhoto, enCours }: { onPhoto: (dataUrl: string) => void; enCours?: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'choix' | 'camera' | 'apercu'>('choix');
  const [apercu, setApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const galerie = useRef<HTMLInputElement>(null);
  const appareil = useRef<HTMLInputElement>(null);

  const couper = () => { flux.current?.getTracks().forEach((tr) => tr.stop()); flux.current = null; };
  useEffect(() => couper, []);

  const ouvrirCamera = async () => {
    setErreur(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      flux.current = s;
      setMode('camera');
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
    } catch {
      setErreur(t('photo_no_camera'));
      appareil.current?.click();
    }
  };
  const declencher = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setApercu(versDataUrl(v, v.videoWidth, v.videoHeight, true));
    couper();
    setMode('apercu');
  };
  const depuisFichier = async (f: File | undefined) => {
    if (!f) return;
    try { setApercu(await fichierVersDataUrl(f)); setMode('apercu'); } catch { setErreur(t('photo_bad_file')); }
  };

  return (
    <div className="photo-capture">
      <input ref={galerie} type="file" accept="image/*" hidden data-role="galerie" onChange={(e) => void depuisFichier(e.target.files?.[0])} />
      <input ref={appareil} type="file" accept="image/*" capture="user" hidden onChange={(e) => void depuisFichier(e.target.files?.[0])} />

      {mode === 'camera' && (
        <div className="photo-cadre">
          <video ref={video} className="photo-video" playsInline muted />
          <span className="photo-masque" aria-hidden="true" />
        </div>
      )}
      {mode === 'apercu' && apercu && (
        <div className="photo-cadre"><img className="photo-apercu" src={apercu} alt="" /></div>
      )}
      {erreur && <p className="photo-erreur">{erreur}</p>}

      {mode === 'choix' && (
        <div className="stack">
          <button className="btn btn-primary" onClick={() => void ouvrirCamera()}><IconCamera size={18} /> {t('photo_take')}</button>
          <button className="btn btn-ghost" onClick={() => galerie.current?.click()}><IconImage size={18} /> {t('photo_gallery')}</button>
        </div>
      )}
      {mode === 'camera' && (
        <div className="row gap-sm">
          <button className="btn btn-ghost" onClick={() => { couper(); setMode('choix'); }}>{t('photo_cancel')}</button>
          <button className="btn btn-primary photo-declencheur" onClick={declencher}><IconCamera size={18} /> {t('photo_shoot')}</button>
        </div>
      )}
      {mode === 'apercu' && apercu && (
        <div className="stack">
          <button className="btn btn-primary" disabled={enCours} onClick={() => onPhoto(apercu)}>
            <IconCheck size={18} /> {enCours ? t('photo_saving') : t('photo_use')}
          </button>
          <button className="btn btn-ghost" disabled={enCours} onClick={() => { setApercu(null); setMode('choix'); }}>{t('photo_retake')}</button>
        </div>
      )}
    </div>
  );
}

/** Étape d'inscription : la photo de profil (facultative, mais expliquée). */
export function PhotoScreen({ profil, onDone }: { profil: ProfilClient | null; onDone: (p: ProfilClient | null) => void }) {
  const { t } = useI18n();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async (dataUrl: string) => {
    setEnCours(true); setErreur(null);
    const r = await envoyerPhoto(dataUrl);
    setEnCours(false);
    if (r.ok) onDone(r.client); else setErreur(r.error);
  };
  return (
    <div className="screen page">
      <TopBar title={t('photo_title')} />
      <div className="page-body">
        <div className="photo-intro">
          <Avatar photo={profil?.photo} name={profil?.name} size={84} />
          <h2 className="h-title" style={{ marginTop: 12 }}>{t('photo_title')}</h2>
          <p className="h-sub">{t('photo_sub')}</p>
        </div>
        <PhotoCapture onPhoto={(d) => void valider(d)} enCours={enCours} />
        {erreur && <p className="photo-erreur">{erreur}</p>}
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => onDone(profil)}>{t('photo_later')}</button>
      </div>
    </div>
  );
}

/* ================================ PROFIL ================================ */

export function ProfileScreen({ profil, onBack, onSaved, onToast }: {
  profil: ProfilClient | null; onBack: () => void; onSaved: (p: ProfilClient) => void; onToast: (m: string, d?: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(profil?.name ?? '');
  const [email, setEmail] = useState(profil?.email ?? '');
  const [changerPhoto, setChangerPhoto] = useState(false);
  const [enCours, setEnCours] = useState(false);

  if (!profil) return null;
  const photo = async (d: string) => {
    setEnCours(true);
    const r = await envoyerPhoto(d);
    setEnCours(false);
    if (r.ok) { onSaved(r.client); setChangerPhoto(false); onToast(t('photo_saved')); } else onToast(r.error, true);
  };
  const retirer = async () => {
    const r = await retirerPhoto();
    if (r.ok) onSaved(r.client); else onToast(r.error, true);
  };
  const enregistrer = async () => {
    const r = await modifierProfil({ name: name.trim(), email: email.trim() });
    if (r.ok) { onSaved(r.client); onToast(t('prof_saved')); onBack(); } else onToast(r.error, true);
  };
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('prof_title')} />
      <div className="page-body">
        <div className="photo-intro">
          <Avatar photo={profil.photo} name={profil.name} size={96} />
          {!changerPhoto && (
            <div className="row gap-sm" style={{ marginTop: 12, justifyContent: 'center' }}>
              <button className="chip" onClick={() => setChangerPhoto(true)}><IconCamera size={14} /> {profil.photo ? t('photo_change') : t('photo_add')}</button>
              {profil.photo && <button className="chip" onClick={() => void retirer()}>{t('photo_remove')}</button>}
            </div>
          )}
        </div>
        {changerPhoto && <PhotoCapture onPhoto={(d) => void photo(d)} enCours={enCours} />}

        <span className="eyebrow" style={{ display: 'block', marginTop: 18 }}>{t('prof_name')}</span>
        <div className="field" style={{ margin: '8px 0 12px' }}><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <span className="eyebrow">{t('prof_email')}</span>
        <div className="field" style={{ margin: '8px 0 12px' }}><input type="email" inputMode="email" value={email} placeholder="nom@exemple.ci" onChange={(e) => setEmail(e.target.value)} /></div>
        <span className="eyebrow">{t('prof_phone')}</span>
        <div className="opt" style={{ margin: '8px 0 18px' }}>
          <IconPhone size={16} /><span className="grow" style={{ textAlign: 'start' }}>{profil.phone}</span>
          {profil.phoneVerifiedAt && <span className="badge green"><IconCheck size={12} /> {t('prof_verified')}</span>}
        </div>
        <button className="btn btn-primary" disabled={name.trim().length < 2} onClick={() => void enregistrer()}>{t('prof_save')}</button>
      </div>
    </div>
  );
}

/* =============================== PARAMÈTRES =============================== */

const VERSION = '1.5.8';

/* ============================ MENU (trois traits) ============================ */

/** Épaisseur du trait des icônes du menu : nettes et sobres, comme des pictogrammes d'interface. */
const T = 1.9;

/**
 * LE VOLET COMPTE — dernier onglet de la barre du bas.
 *
 * Tout ce qui concerne le client et l'application au même endroit : son portrait, son nom
 * et son numéro ; quatre raccourcis en bulles (courses, aide, adresses, paramètres) ; deux
 * cartes (contrôle de sécurité, invitation) ; puis des groupes de lignes à chevron : proches,
 * argent, sécurité, travail, compte. Ici, pas de couleur : des icônes noires au trait, sans
 * fond, sans ombre ni dégradé. Les objets en volume restent sur l'accueil, les services et
 * la carte d'invitation.
 */
export function SettingsScreen({
  profil, onBack, onProfile, onHistory, onSos, onWallet, onSubscription, onHelp, onLegal, onCreate,
  onAssurance, assuranceActive = false, onServeur, onMessages, nonLus = 0, onAdresses, onPreferences, onSecurite, onCarte, carteGoogle = false,
  onglet = false, securite, onControle, onParrainage, onFamille, onContacts, onGroupes, modeSimple, onModeSimple, onRevenus, onBusiness, onEntreprise,
}: {
  /** Affiché comme volet de la barre du bas : pas de flèche de retour. */
  onglet?: boolean;
  /** Contrôle de sécurité : étapes faites sur le total. */
  securite: { fait: number; total: number }; onControle: () => void;
  onParrainage: () => void; onFamille: () => void; onContacts: () => void; onGroupes: () => void;
  modeSimple: boolean; onModeSimple: (v: boolean) => void;
  onRevenus: () => void; onBusiness: () => void; onEntreprise: () => void;
  profil: ProfilClient | null; onBack: () => void; onProfile: () => void; onHistory: () => void; onSos: () => void;
  onWallet: () => void; onSubscription: () => void; onHelp: () => void; onLegal: () => void; onCreate: () => void;
  /** ORION Assurance : dossier de premiers secours (inscription gratuite). */
  onAssurance?: () => void; assuranceActive?: boolean;
  /** Liaison avec le serveur ORION (adresse réglable sans réinstaller l'application). */
  onServeur?: () => void;
  /** Messages du centre ORION (absent quand la messagerie n'est pas active). */
  onMessages?: () => void; nonLus?: number;
  onAdresses: () => void; onPreferences: () => void; onSecurite: () => void;
  /** Fond de carte (ORION ou Google Maps). */
  onCarte?: () => void; carteGoogle?: boolean;
}) {
  const { t } = useI18n();
  const serveur = etatServeur();
  const hoteServeur = (() => { try { return new URL(serveur.url).host; } catch { return serveur.url; } })();
  const bulle = (icone: ReactNode, nom: string, onClick: () => void) => (
    <button className="menu-bulle" onClick={onClick}>
      <span>{icone}</span>
      {nom}
    </button>
  );
  const ligne = (icone: ReactNode, titre: string, sous: string | null, onClick: () => void, droite?: ReactNode) => (
    <button className="menu-ligne" onClick={onClick}>
      <span className="menu-ico">{icone}</span>
      <span className="menu-texte"><strong>{titre}</strong>{sous && <small>{sous}</small>}</span>
      {droite}
      <IconChevron size={20} strokeWidth={2.2} />
    </button>
  );

  return (
    <div className="screen page menu sans-couleur">
      {!onglet && (
        <div className="menu-haut">
          <button className="bulle" onClick={onBack} aria-label="Retour"><IconArrowLeft size={22} /></button>
        </div>
      )}
      <div className="page-body menu-corps">
        <button className="menu-profil" onClick={profil ? onProfile : onCreate} aria-label={profil ? t('set_profile_edit') : t('set_create_account')}>
          <span className="menu-avatar">{profil ? <Avatar photo={profil.photo} name={profil.name} size={124} /> : <IconUser size={56} strokeWidth={1.4} />}</span>
          <span className="menu-nom">
            {profil ? profil.name : t('set_create_account')}
            {profil?.phoneVerifiedAt && <span className="menu-verifie" role="img" aria-label={t('menu_verifie')}><IconCheck size={13} strokeWidth={3.2} /></span>}
          </span>
          <span className="menu-tel">{profil ? profil.phone : t('set_no_account')}</span>
        </button>

        <div className="menu-bulles">
          {bulle(<IconClock size={28} strokeWidth={T} />, t('menu_history'), onHistory)}
          {bulle(<IconHeadset size={28} strokeWidth={T} />, t('menu_help'), onHelp)}
          {bulle(<IconPin size={28} strokeWidth={T} />, t('menu_adresses'), onAdresses)}
          {bulle(<IconSettings size={28} strokeWidth={T} />, t('set_title'), onPreferences)}
        </div>

        {/* Deux cartes : où en est la sécurité du compte, et l'invitation d'un ami. */}
        <div className="compte-cartes">
          <button className="compte-carte" onClick={onControle}>
            <span className="col grow"><strong>{t('cpt_controle_t')}</strong><small>{t('cpt_controle_d')}</small></span>
            <Anneau fait={securite.fait} total={securite.total} taille={68} />
          </button>
          <button className="compte-carte" onClick={onParrainage}>
            <span className="col grow"><strong>{t('cpt_inviter_t')}</strong><small>{t('cpt_inviter_d', { m: formatXOF(OFFRE_PARRAINAGE.remise), n: OFFRE_PARRAINAGE.courses })}</small></span>
            <span className="compte-carte-objet"><Objet nom="cadeau" taille={76} volume /></span>
          </button>
        </div>

        <div className="menu-groupe">
          {ligne(<IconUsers size={27} strokeWidth={T} />, t('cpt_famille'), t('cpt_famille_d'), onFamille)}
          <div className="menu-ligne statique">
            <span className="menu-ico"><IconMobile size={27} strokeWidth={T} /></span>
            <span className="menu-texte"><strong>{t('cpt_simple')} <span className="menu-nouveau">{t('cpt_nouveau')}</span></strong><small>{t('cpt_simple_d')}</small></span>
            <button className={`toggle${modeSimple ? ' on' : ''}`} role="switch" aria-checked={modeSimple} aria-label={t('cpt_simple')} onClick={() => onModeSimple(!modeSimple)}><span /></button>
          </div>
          {ligne(<IconContacts size={27} strokeWidth={T} />, t('cpt_contacts'), t('cpt_contacts_d'), onContacts)}
          {ligne(<IconUsers size={27} strokeWidth={T} />, t('cpt_groupes'), t('cpt_groupes_d'), onGroupes, <span className="menu-nouveau">{t('cpt_nouveau')}</span>)}
        </div>

        <div className="menu-groupe">
          {onMessages && ligne(<IconMessage size={27} strokeWidth={T} />, t('msg_titre'), nonLus > 0 ? t('menu_messages_n', { n: nonLus }) : t('menu_messages_d'), onMessages,
            nonLus > 0 ? <span className="menu-pastille">{nonLus > 9 ? '9+' : nonLus}</span> : undefined)}
          {ligne(<IconWallet size={27} strokeWidth={T} />, t('wal_title'), t('menu_wallet_d'), onWallet)}
          {ligne(<IconCrown size={27} strokeWidth={T} />, t('set_subscription'), t('menu_sub_d'), onSubscription)}
        </div>

        <div className="menu-groupe">
          {profil && onAssurance && ligne(<IconShieldCheck size={27} strokeWidth={T} />, t('as_title'), t(assuranceActive ? 'set_assurance_d_on' : 'set_assurance_d_off'), onAssurance)}
          {ligne(<IconAlarm size={27} strokeWidth={T} />, t('set_sos'), t('set_sos_d'), onSos)}
          {ligne(<IconLock size={27} strokeWidth={T} />, t('sec_title'), t('menu_securite_d'), onSecurite)}
        </div>

        <div className="menu-groupe">
          {ligne(<IconSteering size={27} strokeWidth={T} />, t('cpt_revenus'), t('cpt_revenus_d'), onRevenus)}
          {ligne(<IconBriefcase size={27} strokeWidth={T} />, t('cpt_pro_tableau'), t('cpt_pro_tableau_d'), onBusiness)}
          {ligne(<IconBuilding size={27} strokeWidth={T} />, t('cpt_pro'), t('cpt_pro_d'), onEntreprise)}
          {ligne(<IconGift size={27} strokeWidth={T} />, t('cpt_parrainer'), t('cpt_parrainer_d'), onParrainage)}
        </div>

        <div className="menu-groupe">
          {profil && ligne(<IconUser size={27} strokeWidth={T} />, t('cpt_gerer'), t('cpt_gerer_d'), onProfile)}
          {ligne(<IconInfo size={27} strokeWidth={T} />, t('menu_infos'), t('menu_infos_d'), onLegal)}
          {onCarte && ligne(<IconMap size={27} strokeWidth={T} />, t('carte_titre'), t(carteGoogle ? 'carte_d_google' : 'carte_d_orion'), onCarte)}
          {onServeur && ligne(<IconMonitor size={27} strokeWidth={T} />, t('srv_title'), serveur.url ? t('srv_d_relie', { h: hoteServeur }) : t('srv_d_autonome'), onServeur)}
        </div>

        {profil && (
          <div className="set-stats menu-stats">
            <span><strong>{profil.stats.courses}</strong>{t('stat_rides')}</span>
            <span><strong>{profil.stats.annulations}</strong>{t('stat_cancel')}</span>
            <span><strong>{profil.stats.pointsCarbone}</strong>{t('stat_points')}</span>
          </div>
        )}
        <p className="faint" style={{ textAlign: 'center', fontSize: 11, margin: '18px 0 6px' }}>{t('set_version', { v: VERSION })}</p>
      </div>
    </div>
  );
}

/* ============================== PARAMÈTRES ============================== */

/** Apparence, langue, pays, et la fin du compte (déconnexion, suppression). */
export function PreferencesScreen({ profil, onBack, onLogout, onDelete }: {
  profil: ProfilClient | null; onBack: () => void; onLogout: () => void; onDelete: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode, accent, setAccent } = useTheme();
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const themeOpts: Array<{ m: ThemeMode; k: string }> = [
    { m: 'system', k: 'theme_auto' }, { m: 'light', k: 'theme_light' }, { m: 'dark', k: 'theme_dark' },
  ];
  return (
    <div className="screen page sans-couleur">
      <TopBar onBack={onBack} title={t('set_title')} />
      <div className="page-body">
        <span className="eyebrow set-titre">{t('set_prefs')}</span>
        <span className="faint" style={{ fontSize: 12 }}>{t('set_theme')}</span>
        <div className="chips" style={{ margin: '8px 0 14px' }}>
          {themeOpts.map((o) => (
            <button key={o.m} className={`chip${mode === o.m ? ' active' : ''}`} onClick={() => setMode(o.m)}>{t(o.k)}</button>
          ))}
        </div>
        {/* Couleur de l'app : appliquée tout de suite, partout (cartes, boutons, carte, suivi). */}
        <span className="faint" style={{ fontSize: 12 }}>{t('set_accent')}</span>
        <div className="accent-choix" role="radiogroup" aria-label={t('set_accent')}>
          {ACCENTS.map((a) => (
            <button key={a} role="radio" aria-checked={accent === a} className={`accent-option${accent === a ? ' active' : ''}`} onClick={() => setAccent(a)}>
              <span className={`accent-pastille accent-${a}`}>{accent === a && <IconCheck size={16} />}</span>
              <span>{t(`accent_${a}`)}</span>
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '-6px 2px 14px' }}>{t('accent_hint')}</p>
        {/* Empreinte ou visage : s'active ici, dans les paramètres (et dans Sécurité). */}
        <span className="faint" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}><IconLock size={12} /> {t('lock_hint')}</span>
        <BlocBiometrie />
        <div style={{ height: 14 }} />
        <span className="faint" style={{ fontSize: 12 }}><IconGlobe size={12} /> {t('set_language')}</span>
        <div className="grid2" style={{ margin: '8px 0 14px' }}>
          {LANGUAGES.map((l) => (
            <button key={l.code} className={`opt${l.code === lang ? ' active' : ''}`} onClick={() => setLang(l.code as Lang)}>
              <Drapeau code={l.code} /> <span className="grow" style={{ textAlign: 'start' }}>{l.label}</span>
              {l.code === lang && <IconCheck size={16} />}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 12 }}><IconPin size={12} /> {t('set_country')}</span>
        <div className="stack" style={{ marginTop: 8 }}>
          {COUNTRIES.map((c) => (
            <div key={c.code} className={`opt${c.status === 'active' ? ' active' : ' muted-opt'}`} style={{ cursor: c.status === 'active' ? 'default' : 'not-allowed' }}>
              <Drapeau code={c.code} />
              <span className="grow" style={{ textAlign: 'start' }}>{c.name}</span>
              <span className={`badge ${c.status === 'active' ? 'green' : ''}`}>{c.status === 'active' ? t('set_active') : t('set_comingSoon')}</span>
            </div>
          ))}
        </div>

        {profil && (
          <>
            <span className="eyebrow set-titre">{t('set_account')}</span>
            <button className="btn btn-ghost" onClick={onLogout}>{t('set_logout')}</button>
            {!confirmerSuppression ? (
              <button className="btn set-supprimer" onClick={() => setConfirmerSuppression(true)}>{t('set_delete')}</button>
            ) : (
              <div className="card set-confirmation">
                <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>{t('set_delete_confirm')}</p>
                <button className="btn btn-danger" onClick={onDelete}>{t('set_delete_yes')}</button>
                <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setConfirmerSuppression(false)}>{t('set_delete_no')}</button>
              </div>
            )}
          </>
        )}
        <p className="faint" style={{ textAlign: 'center', fontSize: 11, margin: '22px 0 6px' }}>{t('set_version', { v: VERSION })}</p>
      </div>
    </div>
  );
}

/* =============================== SÉCURITÉ =============================== */

/**
 * Liaison de l'empreinte ou du visage du téléphone.
 *
 * Trois temps, tous réels : (1) l'application demande au téléphone ce qu'il sait faire ;
 * (2) la personne donne son autorisation, puis la fenêtre du téléphone demande l'empreinte
 * ou le visage — la liaison n'est enregistrée que si le téléphone répond « reconnu » ;
 * (3) « Tester maintenant » redemande le capteur et affiche sa réponse avec l'heure.
 */
function BlocBiometrie() {
  const { t, lang } = useI18n();
  const [etat, setEtat] = useState<EtatBio | null>(null);
  const [liee, setLiee] = useState(isBiometricEnabled());
  const [depuis, setDepuis] = useState(biometrieLieeDepuis());
  const [demande, setDemande] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [essai, setEssai] = useState<ResultatBio | null>(null);
  /* La fenêtre d'autorisation se pose sur l'écran entier, pas dans la zone qui défile. */
  const racine = useRef<HTMLDivElement>(null);

  const delier = () => { setBiometricEnabled(false); setLiee(false); setDepuis(null); setEssai(null); };
  /* On relit l'état du téléphone à l'ouverture et à chaque retour dans l'application : la
     personne vient peut-être d'enregistrer une empreinte dans les réglages. */
  const relire = useCallback(() => {
    void etatBiometrie().then((e) => {
      setEtat(e);
      // Hors de l'application installée, rien ne peut vérifier : une liaison héritée d'une
      // ancienne version (où l'interrupteur était décoratif) est retirée.
      if (!e.dispo && e.raison === 'web' && isBiometricEnabled()) { setBiometricEnabled(false); setLiee(false); setDepuis(null); }
    });
  }, []);
  useEffect(() => {
    relire();
    const retour = () => { if (!document.hidden) relire(); };
    document.addEventListener('visibilitychange', retour);
    return () => document.removeEventListener('visibilitychange', retour);
  }, [relire]);

  const demander = async (sousTitre: string) => {
    setEnCours(true);
    const r = await verifierBiometrie({ titre: t('bio_sys_titre'), sousTitre, annuler: t('bio_annuler') });
    setEnCours(false); setEssai(r); relire();
    return r;
  };
  const autoriser = async () => {
    const r = await demander(t('bio_sys_lier'));
    if (r.ok) { setBiometricEnabled(true); setLiee(true); setDepuis(biometrieLieeDepuis()); setDemande(false); }
  };

  const heure = (ms: number) => new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const resultat = essai && (
    <p className={`bio-resultat ${essai.ok ? 'ok' : 'ko'}`} role="status">
      {essai.ok ? <IconCheck size={16} /> : <IconClose size={16} />}
      <span>{essai.ok ? t('bio_reconnu', { heure: heure(essai.a) }) : `${t(`bio_motif_${essai.motif}`)} · ${heure(essai.a)}`}</span>
    </p>
  );
  const sousTitre = liee
    ? (depuis ? t('bio_liee_depuis', { date: new Date(depuis).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('bio_liee'))
    : etat === null ? '…' : etat.dispo ? t(`bio_capteur_${etat.capteur}`) : t('sec_biometric_d');
  return (
    <div className="bio" ref={racine}>
      <div className="opt">
        <span className="list-ico"><IconFingerprint size={24} strokeWidth={T} /></span>
        <span className="col grow" style={{ textAlign: 'start', minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>{t('sec_biometric')}</strong>
          <span className="faint" style={{ fontSize: 12 }}>{sousTitre}</span>
        </span>
        <button className={`toggle${liee ? ' on' : ''}`} role="switch" aria-checked={liee} aria-label={t('sec_biometric')}
          disabled={!liee && !etat?.dispo} onClick={() => { if (liee) delier(); else { setEssai(null); setDemande(true); } }}><span /></button>
      </div>
      {etat && !etat.dispo && <p className="bio-aide" role="note"><IconInfo size={14} /> <span>{t(`bio_raison_${etat.raison}`)}</span></p>}
      {liee && (
        <div className="bio-test">
          <button className="btn btn-ghost" disabled={enCours || !etat?.dispo} onClick={() => void demander(t('bio_sys_test'))}>
            <IconFingerprint size={18} /> {t('bio_tester')}
          </button>
          {resultat}
        </div>
      )}
      {demande && createPortal(
        <div className="modal-backdrop" onClick={() => !enCours && setDemande(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={t('bio_aut_titre')} onClick={(e) => e.stopPropagation()}>
            <div className="logo-mark" style={{ width: 52, height: 52, color: 'var(--btn-on)', marginBottom: 12 }}><IconFingerprint size={26} /></div>
            <h2 className="h-title">{t('bio_aut_titre')}</h2>
            <ul className="bio-points">
              <li>{t('bio_aut_1')}</li>
              <li>{t('bio_aut_2')}</li>
              <li>{t('bio_aut_3')}</li>
            </ul>
            {resultat}
            <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={enCours} onClick={() => void autoriser()}>{t('bio_autoriser')}</button>
            <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={enCours} onClick={() => setDemande(false)}>{t('bio_refuser')}</button>
          </div>
        </div>
      , racine.current?.closest('.screen') ?? document.body)}
    </div>
  );
}

/** Verrouillage de l'application, contact de confiance, partage automatique des courses. */
export function SecuriteScreen({ onBack, trusted, setTrusted, shareRides, setShareRides }: {
  onBack: () => void;
  trusted: TrustedContact | null; setTrusted: (c: TrustedContact) => void;
  shareRides: boolean; setShareRides: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(trusted?.name ?? '');
  const [phone, setPhone] = useState(trusted?.phone ?? '');
  const saveContact = (nm: string, ph: string) => { if (nm && ph) setTrusted({ name: nm, phone: ph }); };
  return (
    <div className="screen page sans-couleur">
      <TopBar onBack={onBack} title={t('sec_title')} />
      <div className="page-body">
        <BlocBiometrie />
        <span className="faint" style={{ display: 'block', fontSize: 12, margin: '14px 2px 6px' }}><IconShield size={12} /> {t('tc_title')}</span>
        <div className="field" style={{ marginBottom: 8 }}>
          <input placeholder={t('tc_name')} value={name} onChange={(e) => { setName(e.target.value); saveContact(e.target.value, phone); }} />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <span className="dialcode">+225</span>
          <input inputMode="tel" placeholder={t('tc_phone')} value={phone} onChange={(e) => { setPhone(e.target.value); saveContact(name, e.target.value); }} />
        </div>
        <div className="opt">
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('tc_share')}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{t('tc_share_d')}</span>
          </span>
          <button className={`toggle${shareRides ? ' on' : ''}`} role="switch" aria-checked={shareRides} aria-label={t('tc_share')} onClick={() => setShareRides(!shareRides)}><span /></button>
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '10px 2px 0' }}><IconLock size={11} /> {t('sec_privacy')}</p>
      </div>
    </div>
  );
}

/* =============================== ADRESSES =============================== */

/** Domicile, bureau et lieux récents : on les définit ici, on y va d'un geste. */
export function AdressesScreen({ onBack, onDefinir, onAller }: {
  onBack: () => void; onDefinir: (quel: 'domicile' | 'bureau') => void; onAller: (p: Place) => void;
}) {
  const { t } = useI18n();
  const recents = lieuxRecents();
  return (
    <div className="screen page sans-couleur">
      <TopBar onBack={onBack} title={t('menu_adresses_t')} />
      <div className="page-body">
        <div className="menu-groupe">
          {([['domicile', lieuEnregistre('home')], ['bureau', lieuEnregistre('work')]] as const).map(([quel, lieu]) => (
            <div key={quel} className="menu-ligne statique">
              <span className="menu-ico">{quel === 'domicile' ? <IconHome size={27} strokeWidth={T} /> : <IconBriefcase size={27} strokeWidth={T} />}</span>
              <button className="menu-texte" onClick={() => (lieu ? onAller(lieu) : onDefinir(quel))}>
                <strong>{t(quel === 'domicile' ? 'lieu_domicile' : 'lieu_bureau')}</strong>
                <small>{lieu ? lieu.area || lieu.name : t(quel === 'domicile' ? 'lieu_ajouter_domicile' : 'lieu_ajouter_bureau')}</small>
              </button>
              <button className="menu-action" onClick={() => onDefinir(quel)}>{lieu ? t('menu_modifier') : <IconPlus size={20} />}</button>
            </div>
          ))}
        </div>
        <span className="eyebrow set-titre">{t('menu_recents')}</span>
        {recents.length === 0 ? <p className="faint" style={{ fontSize: 13.5 }}>{t('menu_recents_vide')}</p> : (
          <div className="menu-groupe">
            {recents.map((p) => (
              <button key={p.id} className="menu-ligne" onClick={() => onAller(p)}>
                <span className="menu-ico"><IconPin size={27} strokeWidth={T} /></span>
                <span className="menu-texte"><strong>{p.name}</strong>{p.area && <small>{p.area}</small>}</span>
                <IconChevron size={20} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== HISTORIQUE ============================== */

const MOYEN: Record<string, string> = {
  orange_money: 'Orange Money', wave: 'Wave', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', cash: 'Espèces', card: 'Carte',
};

/**
 * Historique des courses : terminées, annulées (par qui, pourquoi, combien), reçus,
 * chauffeur, paiement, note, et alerte SOS éventuelle.
 */
export function HistoryScreen({ onBack, onLogin, onglet = false }: { onBack: () => void; onLogin: () => void; /** Volet « Activité » de la barre du bas : un titre, pas de flèche de retour. */ onglet?: boolean }) {
  const { t, lang } = useI18n();
  const [h, setH] = useState<Historique | null | 'connexion'>(null);
  const [filtre, setFiltre] = useState<'toutes' | 'terminees' | 'annulees'>('toutes');
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [programmees, setProgrammees] = useState(coursesProgrammees);

  useEffect(() => {
    if (!sessionClient()) { setH('connexion'); return; }
    void chargerHistorique().then((x) => setH(x ?? 'connexion'));
  }, []);

  const parQui = (a: NonNullable<CourseHistorique['annulation']>) =>
    a.par === 'client' ? t('by_client') : a.par === 'systeme' ? t('by_system') : a.par === 'chauffeur' ? t('by_driver') : t('by_unknown');

  return (
    <div className="screen page">
      {!onglet && <TopBar onBack={onBack} title={t('hist_title')} />}
      <div className={`page-body${onglet ? ' hub-body volet-corps' : ''}`}>
        {onglet && <h1 className="volet-titre">{t('nav_activite')}</h1>}
        {/* Courses programmées (« Plus tard ») : à venir, la plus proche d'abord. */}
        {programmees.length > 0 && (
          <div className="prog">
            <span className="eyebrow"><IconCalendar size={13} /> {t('prog_titre')}</span>
            <div className="stack" style={{ margin: '10px 0 16px' }}>
              {programmees.map((c) => (
                <div key={c.id} className="card prog-carte">
                  <span className="col grow" style={{ minWidth: 0, textAlign: 'start' }}>
                    <strong style={{ fontSize: 15 }}>{libelleQuand(c.quand, lang)}</strong>
                    <span className="faint" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.origine.nom} → {c.destination.nom}</span>
                    {c.montant !== null && <span className="faint" style={{ fontSize: 12 }}>{formatXOF(c.montant)}</span>}
                  </span>
                  <button className="btn btn-ghost" style={{ width: 'auto', flex: 'none', padding: '10px 14px', fontSize: 13 }}
                    onClick={() => { annulerProgrammee(c.id); setProgrammees(coursesProgrammees()); }}>{t('prog_annuler')}</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {h === null && <p className="faint">…</p>}
        {h === 'connexion' && (
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="faint">{t('hist_login')}</p>
            <button className="btn btn-primary" onClick={onLogin}>{t('set_create_account')}</button>
          </div>
        )}
        {h && h !== 'connexion' && (
          <>
            <div className="hist-resume">
              <span><strong>{h.resume.total}</strong>{t('hist_k_rides')}</span>
              <span><strong>{h.resume.annulees}</strong>{t('hist_k_cancelled')}</span>
              <span><strong>{formatXOF(h.resume.depense)}</strong>{t('hist_spent')}</span>
              <span><strong>{formatXOF(h.resume.fraisAnnulation)}</strong>{t('hist_fees')}</span>
            </div>
            <div className="chips" style={{ margin: '12px 0' }}>
              {(['toutes', 'terminees', 'annulees'] as const).map((f) => (
                <button key={f} className={`chip${filtre === f ? ' active' : ''}`} onClick={() => setFiltre(f)}>
                  {t(f === 'toutes' ? 'hist_all' : f === 'terminees' ? 'hist_done' : 'hist_cancelled')}
                </button>
              ))}
            </div>
            {h.courses.length === 0 && <p className="faint" style={{ textAlign: 'center', padding: 24 }}>{t('hist_empty')}</p>}
            <div className="stack">
              {h.courses
                .filter((c) => filtre === 'toutes' || (filtre === 'annulees' ? Boolean(c.annulation) : !c.annulation && ['completed', 'paid', 'rated'].includes(c.status)))
                .map((c) => {
                  const open = ouvert === c.id;
                  const etat = c.annulation ? 'annulee' : c.paiement.regle ? 'ok' : 'attente';
                  return (
                    <div key={c.id} className={`card hist-item ${etat}`}>
                      <button className="list-btn hist-tete" onClick={() => setOuvert(open ? null : c.id)}>
                        <span className="list-ico"><Objet nom="mes-courses" taille={34} /></span>
                        <span className="col grow" style={{ textAlign: 'start' }}>
                          <strong style={{ fontSize: 14 }}>{c.depart} → {c.arrivee}</strong>
                          <span className="faint" style={{ fontSize: 12 }}>{new Date(c.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className={`hist-statut ${etat}`}>{c.statutLabel}</span>
                        </span>
                        <span className="col" style={{ alignItems: 'flex-end' }}>
                          <span className="price" style={{ fontSize: 15 }}>{formatXOF(c.annulation ? c.annulation.frais : c.montant)}</span>
                          {c.annulation && <span className="faint" style={{ fontSize: 11 }}>{c.annulation.frais ? t('hist_fee') : t('hist_free')}</span>}
                        </span>
                      </button>
                      {open && (
                        <div className="hist-detail">
                          {c.annulation && (
                            <div className="hist-annulation">
                              <div className="fare-line"><span>{t('hist_cancel_by')}</span><span>{parQui(c.annulation)}</span></div>
                              {c.annulation.motif && <div className="fare-line"><span>{t('hist_reason')}</span><span>{t(`motif_${c.annulation.motif}`)}</span></div>}
                              {c.annulation.details && <p className="faint" style={{ fontSize: 12, margin: '4px 0' }}>« {c.annulation.details} »</p>}
                              <div className="fare-line"><span>{t('hist_fee')}</span><span>{c.annulation.frais ? formatXOF(c.annulation.frais) : t('hist_free')}</span></div>
                            </div>
                          )}
                          {c.chauffeur && (
                            <div className="fare-line"><span>{t('hist_driver')}</span><span>{c.chauffeur.name}{c.chauffeur.vehicule ? ` · ${c.chauffeur.vehicule}` : ''}{c.chauffeur.plaque ? ` · ${c.chauffeur.plaque}` : ''}</span></div>
                          )}
                          {!c.annulation && (
                            <>
                              <div className="fare-line"><span>{t('hist_payment')}</span><span>{c.paiement.moyen ? (MOYEN[c.paiement.moyen] ?? c.paiement.moyen) : '—'} · {c.paiement.regle ? t('hist_paid') : t('hist_pending')}</span></div>
                              {c.note && <div className="fare-line"><span>{t('hist_rating')}</span><span className="etoiles" aria-label={`${c.note}/5`}>{Array.from({ length: c.note }, (_, k) => <IconStar key={k} size={13} />)}</span></div>}
                              <div className="divider" style={{ margin: '8px 0' }} />
                              <span className="eyebrow">{t('hist_receipt')}</span>
                              <div style={{ marginTop: 6 }}>
                                <div className="fare-line"><span>{t('p_base')}</span><span>{formatXOF(c.breakdown.base)}</span></div>
                                <div className="fare-line"><span>{t('p_distance')} · {c.distanceKm} km</span><span>{formatXOF(c.breakdown.distance)}</span></div>
                                <div className="fare-line"><span>{t('p_time')}</span><span>{formatXOF(c.breakdown.time)}</span></div>
                                {c.breakdown.traffic > 0 && <div className="fare-line"><span>{t('p_traffic')}</span><span>+{formatXOF(c.breakdown.traffic)}</span></div>}
                                <div className="fare-line"><span>{t('p_tva')}</span><span>{formatXOF(c.breakdown.tva)}</span></div>
                                <div className="fare-line"><span>{t('p_fee')}</span><span>{formatXOF(c.breakdown.fee)}</span></div>
                                <div className="fare-total"><span className="muted">{t('conf_total')}</span><span className="amt">{formatXOF(c.montant)}</span></div>
                              </div>
                            </>
                          )}
                          {c.sos.length > 0 && <p className="hist-sos"><IconShield size={13} /> {t('hist_sos')}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================== MES ALERTES SOS =========================== */

export function SosHistoryScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [alertes, setAlertes] = useState<SosSuivi[] | null>(null);
  useEffect(() => {
    if (!sessionClient()) { setAlertes([]); return; }
    void mesAlertesSos().then((a) => setAlertes(a ?? []));
  }, []);
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('sos_hist_title')} />
      <div className="page-body">
        {alertes === null && <p className="faint">…</p>}
        {alertes?.length === 0 && <p className="faint" style={{ textAlign: 'center', padding: 24 }}>{t('sos_hist_empty')}</p>}
        <div className="stack">
          {alertes?.map((a) => (
            <div key={a.id} className="card sos-hist">
              <div className="row between">
                <strong>{new Date(a.createdAt).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
                <span className={`badge ${a.clotureeA ? 'green' : ''}`}>{t(`sos_st_${a.status}`)}</span>
              </div>
              <p className="faint" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                {a.zoneName ?? 'Abidjan'}{a.priseEnCharge ? ` · ${a.priseEnCharge.agent === AGENT_GENERIQUE ? t('sos_step_agent_team') : t('sos_step_agent', { a: a.priseEnCharge.agent })}` : ''}
              </p>
              {a.secours.map((s, i) => (
                <p key={i} style={{ fontSize: 12.5, margin: '4px 0 0' }}>• {s.service} ({s.numero}){s.issue === 'joint' && <IconCheck size={12} />}</p>
              ))}
              {a.chat.length > 0 && <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>{t('sos_hist_msgs', { n: a.chat.length })}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====================== CONDITIONS ET CONFIDENTIALITÉ ====================== */

export function LegalScreen({ onBack }: { onBack: () => void }) {
  const { t, lang } = useI18n();
  const sections = ['donnees', 'usage', 'photo', 'sante', 'conservation', 'annulation', 'droits'];
  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('set_legal')} />
      <div className="page-body legal">
        {/* Texte juridique : la version française fait foi tant que la traduction n'est pas validée. */}
        {lang !== 'fr' && lang !== 'en' && <p className="as-avis-langue" role="note">{t('legal_langue_note')}</p>}
        {sections.map((s) => (
          <div key={s} style={{ marginBottom: 16 }}>
            <span className="eyebrow">{t(`legal_${s}_t`)}</span>
            <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '6px 0 0' }}>{t(`legal_${s}`)}</p>
          </div>
        ))}
        {/* Condition d'utilisation des données de carte : citer leurs auteurs. */}
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">{t('legal_credits_t')}</span>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '6px 0 0' }}>{t('legal_carte')}</p>
        </div>
      </div>
    </div>
  );
}

/* ============================== ANNULATION ============================== */

/**
 * Annuler une course : le motif d'abord, les frais annoncés AVANT de confirmer.
 * Un motif de sécurité est gratuit et rappelle le bouton SOS.
 */
export function CancelSheet({ rideId, onClose, onCancelled, onSos }: {
  rideId: string; onClose: () => void; onCancelled: (f: FraisAnnulation) => void; onSos: () => void;
}) {
  const { t } = useI18n();
  const [motif, setMotif] = useState<MotifAnnulation | null>(null);
  const [details, setDetails] = useState('');
  const [frais, setFrais] = useState<FraisAnnulation | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { void apercuAnnulation(rideId, motif ?? undefined).then((p) => setFrais(p?.frais ?? null)); }, [rideId, motif]);

  const annonce = !frais ? '…'
    : frais.raisonGratuite === 'aucun_chauffeur' ? t('cx_free_driver')
      : frais.raisonGratuite === 'delai_de_grace' ? t('cx_free_grace', { m: frais.delaiGraceMinutes })
        : frais.raisonGratuite === 'securite' ? t('cx_free_security')
          : frais.raisonGratuite === 'chauffeur_demande' ? t('cx_free_driver_asked')
            : frais.montant > 0 ? t('cx_fee', { f: formatXOF(frais.montant), m: frais.delaiGraceMinutes }) : t('hist_free');

  const confirmer = async () => {
    if (!motif) return;
    setEnCours(true); setErreur(null);
    const r = await annulerCourse(rideId, motif, details);
    setEnCours(false);
    if (r.ok) onCancelled(r.frais); else setErreur(r.error);
  };

  return (
    <div className="cx-voile" role="dialog" aria-label={t('cx_title')}>
      <Sheet>
        <h2 className="h-title" style={{ fontSize: 20 }}>{t('cx_title')}</h2>
        <p className={`cx-frais${frais && frais.montant > 0 ? ' payant' : ''}`}>{annonce}</p>
        <span className="eyebrow">{t('cx_why')}</span>
        <div className="cx-motifs">
          {MOTIFS_ANNULATION.map((m) => (
            <button key={m} className={`opt cx-motif${motif === m ? ' active' : ''}`} onClick={() => setMotif(m)}>
              <span className={`cx-radio${motif === m ? ' on' : ''}`} />
              <span className="grow" style={{ textAlign: 'start' }}>{t(`motif_${m}`)}</span>
            </button>
          ))}
        </div>
        {motif === 'securite' && (
          <div className="cx-securite">
            <span>{t('cx_sos_hint')}</span>
            <button className="btn btn-danger" onClick={onSos}>SOS</button>
          </div>
        )}
        {motif && (
          <div className="field" style={{ margin: '10px 0' }}>
            <input value={details} maxLength={300} placeholder={t('cx_details')} onChange={(e) => setDetails(e.target.value)} />
          </div>
        )}
        {erreur && <p className="photo-erreur">{erreur}</p>}
        <button className="btn btn-danger" disabled={!motif || enCours} onClick={() => void confirmer()}>{t('cx_confirm')}</button>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>{t('cx_keep')}</button>
      </Sheet>
    </div>
  );
}

