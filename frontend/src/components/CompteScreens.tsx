import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet, TopBar } from './ui';
import {
  IconCamera, IconCheck, IconChevron, IconClock, IconFingerprint, IconGlobe, IconImage, IconLock,
  IconPin, IconShield, IconShieldCheck, IconWallet, IconCrown, IconPhone, IconCar, IconMedical, IconStar,
} from '../icons';
import { useI18n, LANGUAGES, type Lang } from '../i18n';
import { ACCENTS, useTheme, type ThemeMode } from '../theme';
import { COUNTRIES, formatXOF } from '../data';
import { isBiometricEnabled, setBiometricEnabled } from '../security';
import {
  AGENT_GENERIQUE, MOTIFS_ANNULATION, annulerCourse, apercuAnnulation, chargerHistorique, envoyerPhoto, mesAlertesSos,
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

const VERSION = '1.0';

/**
 * Les paramètres : le compte en tête, puis l'activité (historique, annulations,
 * alertes, portefeuille, abonnement), la sécurité, les préférences, l'aide, et la
 * gestion du compte. Avant, on n'y trouvait ni profil, ni historique.
 */
export function SettingsScreen({
  profil, onBack, onProfile, onHistory, onSos, onWallet, onSubscription, onHelp, onLegal, onCreate, onLogout, onDelete,
  trusted, setTrusted, shareRides, setShareRides, onAssurance, assuranceActive = false,
}: {
  /** ORION Assurance : dossier de premiers secours (inscription gratuite). */
  onAssurance?: () => void; assuranceActive?: boolean;
  profil: ProfilClient | null; onBack: () => void; onProfile: () => void; onHistory: () => void; onSos: () => void;
  onWallet: () => void; onSubscription: () => void; onHelp: () => void; onLegal: () => void; onCreate: () => void;
  onLogout: () => void; onDelete: () => void;
  trusted: TrustedContact | null; setTrusted: (c: TrustedContact) => void;
  shareRides: boolean; setShareRides: (v: boolean) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { mode, setMode, accent, setAccent } = useTheme();
  const [bio, setBio] = useState(isBiometricEnabled());
  const [name, setName] = useState(trusted?.name ?? '');
  const [phone, setPhone] = useState(trusted?.phone ?? '');
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const themeOpts: Array<{ m: ThemeMode; k: string }> = [
    { m: 'system', k: 'theme_auto' }, { m: 'light', k: 'theme_light' }, { m: 'dark', k: 'theme_dark' },
  ];
  const saveContact = (nm: string, ph: string) => { if (nm && ph) setTrusted({ name: nm, phone: ph }); };
  const ligne = (icone: ReactNode, titre: string, sous: string | null, onClick: () => void, classe = '') => (
    <button className={`opt list-btn set-ligne ${classe}`} onClick={onClick}>
      <span className="list-ico" style={{ color: 'var(--green)' }}>{icone}</span>
      <span className="col grow" style={{ textAlign: 'start' }}>
        <strong style={{ fontSize: 14 }}>{titre}</strong>
        {sous && <span className="faint" style={{ fontSize: 12 }}>{sous}</span>}
      </span>
      <IconChevron size={18} color="var(--text-faint)" />
    </button>
  );

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('set_title')} />
      <div className="page-body">
        {/* Le compte */}
        {profil ? (
          <div className="card set-profil">
            <div className="row gap-sm">
              <Avatar photo={profil.photo} name={profil.name} size={62} />
              <span className="col grow" style={{ textAlign: 'start' }}>
                <strong style={{ fontSize: 17 }}>{profil.name}</strong>
                <span className="faint" style={{ fontSize: 13 }}>{profil.phone}{profil.phoneVerifiedAt && <IconCheck size={13} />}</span>
                <span className="faint" style={{ fontSize: 12 }}>{profil.email ?? t('prof_no_email')}</span>
              </span>
            </div>
            <div className="set-stats">
              <span><strong>{profil.stats.courses}</strong>{t('stat_rides')}</span>
              <span><strong>{profil.stats.annulations}</strong>{t('stat_cancel')}</span>
              <span><strong>{profil.stats.pointsCarbone}</strong>{t('stat_points')}</span>
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={onProfile}>{t('set_profile_edit')}</button>
          </div>
        ) : (
          <div className="card set-profil">
            <p className="faint" style={{ margin: '0 0 10px' }}>{t('set_no_account')}</p>
            <button className="btn btn-primary" onClick={onCreate}>{t('set_create_account')}</button>
          </div>
        )}

        {/* Mon activité */}
        <span className="eyebrow set-titre"><IconClock size={13} /> {t('set_activity')}</span>
        <div className="stack">
          {profil && onAssurance && ligne(<IconMedical size={18} />, t('as_title'), t(assuranceActive ? 'set_assurance_d_on' : 'set_assurance_d_off'), onAssurance)}
          {ligne(<IconClock size={18} />, t('set_history'), t('set_history_d'), onHistory)}
          {ligne(<IconShield size={18} />, t('set_sos'), t('set_sos_d'), onSos)}
          {ligne(<IconWallet size={18} />, t('wal_title'), null, onWallet)}
          {ligne(<IconCrown size={18} />, t('set_subscription'), null, onSubscription)}
        </div>

        {/* Sécurité & confidentialité */}
        <span className="eyebrow set-titre"><IconShieldCheck size={13} /> {t('sec_title')}</span>
        <div className="opt" style={{ marginBottom: 8 }}>
          <span className="list-ico" style={{ color: 'var(--green)' }}><IconFingerprint size={18} /></span>
          <span className="col grow" style={{ textAlign: 'start' }}>
            <strong style={{ fontSize: 14 }}>{t('sec_biometric')}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{t('sec_biometric_d')}</span>
          </span>
          <button className={`toggle${bio ? ' on' : ''}`} role="switch" aria-checked={bio} aria-label={t('sec_biometric')} onClick={() => { const v = !bio; setBio(v); setBiometricEnabled(v); }}><span /></button>
        </div>
        <span className="faint" style={{ display: 'block', fontSize: 12, margin: '10px 2px 6px' }}><IconShield size={12} /> {t('tc_title')}</span>
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
        <p className="faint" style={{ fontSize: 11, margin: '8px 2px 0' }}><IconLock size={11} /> {t('sec_privacy')}</p>

        {/* Préférences */}
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
        <span className="faint" style={{ fontSize: 12 }}><IconGlobe size={12} /> {t('set_language')}</span>
        <div className="grid2" style={{ margin: '8px 0 14px' }}>
          {LANGUAGES.map((l) => (
            <button key={l.code} className={`opt${l.code === lang ? ' active' : ''}`} onClick={() => setLang(l.code as Lang)}>
              <span className="code-langue">{l.code.toUpperCase()}</span> <span className="grow" style={{ textAlign: 'start' }}>{l.label}</span>
              {l.code === lang && <IconCheck size={16} color="var(--green)" />}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 12 }}><IconPin size={12} /> {t('set_country')}</span>
        <div className="stack" style={{ marginTop: 8 }}>
          {COUNTRIES.map((c) => (
            <div key={c.code} className={`opt${c.status === 'active' ? ' active' : ' muted-opt'}`} style={{ cursor: c.status === 'active' ? 'default' : 'not-allowed' }}>
              <span className="code-langue">{c.code}</span>
              <span className="grow" style={{ textAlign: 'start' }}>{c.name}</span>
              <span className={`badge ${c.status === 'active' ? 'green' : ''}`}>{c.status === 'active' ? t('set_active') : t('set_comingSoon')}</span>
            </div>
          ))}
        </div>

        {/* Aide et informations */}
        <span className="eyebrow set-titre">{t('set_info')}</span>
        <div className="stack">
          {ligne(<IconShieldCheck size={18} />, t('set_help'), null, onHelp)}
          {ligne(<IconLock size={18} />, t('set_legal'), null, onLegal)}
        </div>

        {/* Mon compte */}
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

/* ============================== HISTORIQUE ============================== */

const MOYEN: Record<string, string> = {
  orange_money: 'Orange Money', wave: 'Wave', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', cash: 'Espèces', card: 'Carte',
};

/**
 * Historique des courses : terminées, annulées (par qui, pourquoi, combien), reçus,
 * chauffeur, paiement, note, et alerte SOS éventuelle.
 */
export function HistoryScreen({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const { t } = useI18n();
  const [h, setH] = useState<Historique | null | 'connexion'>(null);
  const [filtre, setFiltre] = useState<'toutes' | 'terminees' | 'annulees'>('toutes');
  const [ouvert, setOuvert] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionClient()) { setH('connexion'); return; }
    void chargerHistorique().then((x) => setH(x ?? 'connexion'));
  }, []);

  const parQui = (a: NonNullable<CourseHistorique['annulation']>) =>
    a.par === 'client' ? t('by_client') : a.par === 'systeme' ? t('by_system') : a.par === 'chauffeur' ? t('by_driver') : t('by_unknown');

  return (
    <div className="screen page">
      <TopBar onBack={onBack} title={t('hist_title')} />
      <div className="page-body">
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
                        <span className="list-ico"><IconCar size={18} /></span>
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

