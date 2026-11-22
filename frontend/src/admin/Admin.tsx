import { enTeteRecaptcha } from '../securiteGoogle';
import { useEffect, useRef, useState, useCallback } from 'react';
import { avis, demander, demanderLieu } from './dialogues';
import { LogoApp } from '../components/Logo';
import { Objet, type Icone3D, type ObjetService } from '../components/Vehicules';
import { IconMenu, IconActivity, IconAlarm, IconAlert, IconBank, IconBell, IconBellOff, IconBuilding, IconCar, IconCash, IconChart, IconCompass, IconCrown, IconFile, IconGem, IconGrid, IconIdCard, IconInbox, IconKey, IconLeaf, IconLock, IconMail, IconMap, IconMegaphone, IconMessage, IconMonitor, IconMoon, IconScale, IconShield, IconSignal, IconStar, IconSteering, IconSun, IconTag, IconTarget, IconTicket, IconTrend, IconUsers, IconWallet } from '../icons';
import { DEMO } from './demo';
import { suivreBus, type EtatBus } from '../busTest';
import { empreinteBus, fusionBusConsole } from './busConsole';
import { API, LIVE, AdminError, H, PAGE_SIZE, adminDel, adminGet, adminPost, adminPut, clearSession, expKey, fcfa, logout, onUnauthorized, setCsrf, setDemoSession, pageSlice, reportResponse, safePost, safePostData, safePut, sessionValid, setAdminErrorSink } from './api';
import { AuditSection, CorporateSection, FinanceSection, GlobalSearch, GreenSection, IntelSection, NotifySection, PricingEditor, PromosSection, ServicesSection, SupportSection, TreasurySection, ZonesSection } from './sections/business';
import { ClientsSection, DispatchSection, DisputesSection, DriversSection, ForensicDrawer, QualitySection, ReservationsCard, RidesSection } from './sections/operations';
import { AppareilsPanneau, RolesSection, SessionsSection, TeamsSection } from './sections/organisation';
import { OverviewSection, SamuSection, SecuritySection, SosDrawer } from './sections/supervision';
import { RentalSection, RentalTarifsSection, SubscriptionsSection } from './sections/location';
import { DirectionSection } from './sections/direction';
import { ObjectifsFinanciersCarte } from './sections/objectifs';
import { HabilitationsSection } from './sections/habilitations';
import { VigilanceSection } from './sections/vigilance';
import { MonPosteSection, type NouvelleRequete } from './sections/monposte';
import { MessagesClientsSection } from './sections/messagerie';
import { EquipagesSection } from './sections/equipages';
import { CaisseSection } from './sections/caisse';
import { PosteEquipeSection } from './sections/posteequipe';
import { TelematiqueSection } from './sections/telematique';
import { AnnuaireSection, ChangerMotDePasse } from './sections/annuaire';
import type { AccountsStats, ActiveSession, Alert, Amortization, Announcement, AssistantSujet, CaisseConsolidation, CaisseEtat, CaisseReferentiel, CrewTableau, DossierEquipage, EquipageRow, PosteEquipe, RoleOption, StaffAccountRow, SuiviFlotte, AuditEntry, CashDebtor, ChurnReport, Client, ClientDetail, Conversation, ConversionCell, ContactJournal, ContactUrgence, CopilotAnswer, ExecutiveBoard, MonPoste, MouvementPage, SanteVigilance, CorporateAccount, CsatReport, Dispute, DriverDetail, DriverRow, ElasticityCell, ExpenseTicket, ExpiringDoc, Finance, FleetUnit, FraudReport, GatewayStatus, GreenReport, Liquidity, Macro, MaintenanceTicket, Me, OpsConfig, Overview, PageMeta, PredictCell, Pricing, PrestigeUnit, Promo, QualityRow, QualityTop, RentalAvailabilityRow, RentalRow, RentalStats, Reservation, RideForensic, RideRow, SearchResults, SecurityAttempt, ServicesConfig, ShadowPricing, Shift, SimResult, RentalTarifEtat, SosChat, SosDossier, SquadPnl, StaffKpi, Stats, SubInvoiceRow, SubPlanRow, SubStats, SubscriptionRow, SupportMsg, SupportStats, Team, Transfer, Triggers, Zone } from './types';
import { ClientDrawer, DriverDrawer } from './ui';
import { lienTel, numeroComposable, ouvrirClavier } from '../telephone';
import { EnrolementAppareil, LigneAppareil, estAppEmballee, useEtatAppareil, type AppareilPublic, type ClassesFormulaire } from '../appareil';
import { BoutonInstaller } from '../pwa';
import { surServeurDeSecours } from '../serveur';




/* ----------------------- Thème jour / nuit --------------------------- */
const themeKey = 'orion.admin.theme';
type AdmTheme = 'dark' | 'light';
function applyTheme(t: AdmTheme): void { document.documentElement.setAttribute('data-adm-theme', t); }
/** Choix mémorisé s'il existe ; sinon la console suit l'appareil (mode clair ou sombre du système). */
function savedTheme(): AdmTheme {
  let choix: string | null = null;
  try { choix = localStorage.getItem(themeKey); } catch { /* stockage indisponible */ }
  if (choix === 'light' || choix === 'dark') return choix;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
applyTheme(savedTheme()); // appliqué dès le chargement (écran de connexion inclus)

/** Sirène d'alerte SAMU (deux tons), générée en WebAudio — aucun fichier audio requis. */
function playSiren(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.connect(gain); gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.linearRampToValueAtTime(587, t + 0.35);
    osc.frequency.linearRampToValueAtTime(880, t + 0.7);
    osc.frequency.linearRampToValueAtTime(587, t + 1.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    osc.start(t); osc.stop(t + 1.4);
    osc.onended = () => { void ctx.close(); };
  } catch { /* audio indisponible (autoplay bloqué) — la notification visuelle reste */ }
}

interface LoginResponse { token: string; expiresAt: string; account: Me;
  /** Preuve anti-CSRF à recopier en en-tête (le jeton, lui, reste en cookie HttpOnly). */
  csrfToken?: string }

/* --------------------------- Porte d'entrée -------------------------- */
/** Ce que dit le bandeau selon l'origine de l'alerte : une déviation n'est pas un SOS. */
const ALARME_LIBELLE: Record<string, string> = {
  sos: 'NOUVELLE ALERTE SOS', crash: 'ACCIDENT DÉTECTÉ', deviation: 'DÉVIATION D’ITINÉRAIRE',
  immobilisation: 'VÉHICULE IMMOBILISÉ', mot_sensible: 'MOT SENSIBLE SIGNALÉ',
};

/** Deux bips courts à l'arrivée d'une détresse. Sans effet si l'audio est bloqué. */
let derniereAlarme = 0;
function sonnerAlarme(): void {
  // Une rafale de 300 SOS ne doit pas donner 300 alarmes superposées : une toutes les
  // 2,5 s suffit à alerter la salle, le bandeau dit combien d'alertes sont arrivées.
  const t = Date.now();
  if (t - derniereAlarme < 2500) return;
  derniereAlarme = t;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.28].forEach((t0, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = i === 0 ? 880 : 660; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.2);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch { /* audio indisponible */ }
}

export function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    (async () => {
      if (!sessionValid()) { clearSession(); setChecking(false); return; }
      if (!LIVE) { setAuthed(true); setChecking(false); return; }
      try { await adminGet('/admin/me'); setAuthed(true); } catch { clearSession(); }
      setChecking(false);
    })();
  }, []);
  if (checking) return <div className="adm-loading">Vérification de l'accès…</div>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onLogout={() => { void logout().then(() => setAuthed(false)); }} />;
}

/* --------------------------- Écran de connexion --------------------- */
const CLASSES_CONSOLE: ClassesFormulaire = {
  carte: 'adm-login-card', sous: 'adm-login-sub', label: 'adm-login-label', champ: 'adm-login-input',
  bouton: 'adm-btn solid big', erreur: 'adm-login-err', lien: 'adm-btn ghost',
};

function Login({ onDone }: { onDone: () => void }) {
  // Code de synchronisation ORION : un appareil non enrôlé passe d'abord par l'enrôlement
  // quand la politique l'exige (ou dans les applications Windows, macOS et mobiles).
  const [etatAppareil, relireAppareil] = useEtatAppareil();
  const [enrolement, setEnrolement] = useState(false);
  const enrolementRequis = Boolean(etatAppareil?.configure && !etatAppareil.appareil && (etatAppareil.exige || estAppEmballee()));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false); // étape 2 : code TOTP demandé par le serveur
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setErr('Saisis ton identifiant et ton mot de passe.'); return; }
    if (mfa && !code.trim()) { setErr('Saisis le code à 6 chiffres de ton application d\'authentification.'); return; }
    setBusy(true); setErr('');
    // Mode démo (sans backend) : session locale, données simulées.
    if (!LIVE) { setDemoSession(); localStorage.setItem(expKey, String(Date.now() + 12 * 3600e3)); onDone(); return; }
    try {
      const res = await fetch(`${API}/admin/login`, {
        // reCAPTCHA Enterprise (si réglé) : pas d'essais de mots de passe en série par un robot.
        method: 'POST', headers: { 'content-type': 'application/json', ...(await enTeteRecaptcha('connexion_console')) },
        // Le serveur répond avec le cookie de session HttpOnly : il faut l'accepter.
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password, ...(mfa && code.trim() ? { code: code.trim() } : {}) }),
      });
      if (res.status === 429) { setErr('Compte temporairement verrouillé (trop de tentatives). Réessaie plus tard.'); setBusy(false); return; }
      if (res.status === 403) {
        // Appareil non enrôlé ou révoqué : retour à l'enrôlement.
        const corps = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        if (corps.error?.code === 'APPAREIL_NON_ENROLE') { setBusy(false); setEnrolement(true); relireAppareil(); return; }
        setErr(corps.error?.message ?? 'Accès refusé.'); setBusy(false); return;
      }
      if (!res.ok) { setErr(mfa ? 'Code 2FA invalide.' : 'Identifiants refusés. Accès réservé au personnel ORION.'); setBusy(false); return; }
      const data = (await res.json()) as LoginResponse & { mfaRequired?: boolean };
      if (data.mfaRequired) { setMfa(true); setBusy(false); return; } // mot de passe OK → code demandé
      // Le jeton N'EST PLUS stocké : il vit dans un cookie HttpOnly, hors de portée
      // de JavaScript. On ne garde que l'échéance et la preuve anti-CSRF.
      if (data.csrfToken) setCsrf(data.csrfToken);
      localStorage.setItem(expKey, String(Date.parse(data.expiresAt) || Date.now() + 12 * 3600e3));
      onDone();
    } catch {
      setErr('Serveur injoignable. Réessaie dans un instant.'); setBusy(false);
    }
  };
  if (enrolement || enrolementRequis) {
    return (
      <div className="adm-login">
        <EnrolementAppareil application="console" classes={CLASSES_CONSOLE}
          onEnrole={() => { setEnrolement(false); relireAppareil(); }}
          onRetour={enrolementRequis ? undefined : () => setEnrolement(false)} />
      </div>
    );
  }
  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <LogoApp size={60} className="adm-logo-volume" />
        <h1>ORION Admin</h1>
        <p className="adm-login-sub">Centre de contrôle — accès réservé au personnel ORION.</p>
        {!mfa && (
          <>
            <label className="adm-login-label">Identifiant</label>
            <input className="adm-login-input" type="text" autoComplete="username" placeholder="prenom.nom" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            <label className="adm-login-label" style={{ marginTop: 10 }}>Mot de passe</label>
            <input className="adm-login-input" type="password" autoComplete="current-password" placeholder="••••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        {mfa && (
          <>
            <p className="adm-login-sub" style={{ marginTop: 0 }}>Double authentification — compte de direction.</p>
            <label className="adm-login-label">Code à 6 chiffres (application d'authentification)</label>
            <input className="adm-login-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </>
        )}
        {err && <div className="adm-login-err">{err}</div>}
        <button className="adm-btn solid big" type="submit" disabled={busy}>{busy ? 'Connexion…' : mfa ? 'Vérifier le code' : 'Se connecter'}</button>
        {mfa && <button className="adm-btn ghost" type="button" style={{ marginTop: 8 }} onClick={() => { setMfa(false); setCode(''); setErr(''); }}>← Retour</button>}
        {!API && <p className="adm-login-demo">Mode démo — n'importe quels identifiants ouvrent la console (données simulées).</p>}
        <LigneAppareil etat={etatAppareil} classe="adm-login-sub" onEnroler={() => setEnrolement(true)} />
        <BoutonInstaller classe="adm-btn ghost" nom="ORION Console" />
      </form>
    </div>
  );
}

/* ------------------------------ Navigation --------------------------- */
type Section = 'monPoste' | 'posteEquipe' | 'crew' | 'caisses' | 'telematique' | 'comptes' | 'overview' | 'direction' | 'vigilance' | 'alerts' | 'rental' | 'rentalTarifs' | 'subscriptions' | 'rides' | 'drivers' | 'clients' | 'support' | 'messagesClients' | 'notify' | 'pricing' | 'zones' | 'promos' | 'finance' | 'treasury' | 'dispatch' | 'quality' | 'disputes' | 'green' | 'teams' | 'intel' | 'b2b' | 'services' | 'audit' | 'sessions' | 'security' | 'roles' | 'habilitations';
/** L'objet en volume de chaque session : le même jeu d'objets que l'app cliente. */
const OBJET_SESSION: Record<Section, ObjetService | Icone3D> = {
  monPoste: 'bureau', posteEquipe: 'clients', overview: 'carte', direction: 'pack-or', vigilance: 'assurance', alerts: 'samu',
  support: 'aide', messagesClients: 'message', notify: 'telephone', rides: 'mes-courses', dispatch: 'destination', quality: 'pack-diamant',
  green: 'eco', teams: 'clients', crew: 'chauffeur', intel: 'objectif', b2b: 'immeuble', rental: 'location', rentalTarifs: 'abonnement',
  telematique: 'wifi', subscriptions: 'pack-argent', disputes: 'document', drivers: 'chauffeur', clients: 'clients', finance: 'finances',
  treasury: 'banque', caisses: 'portefeuille', pricing: 'finances', zones: 'lieu', promos: 'achat', services: 'reglages', audit: 'historique',
  sessions: 'serveur', security: 'cadenas', comptes: 'clients', habilitations: 'cadenas', roles: 'assurance',
};
const NAV: { id: Section; label: string; perm: string; icon: (p: { size?: number; strokeWidth?: number }) => React.JSX.Element }[] = [
  { id: 'monPoste', label: 'Mon poste', perm: '', icon: IconInbox },
  { id: 'posteEquipe', label: 'Mon équipe', perm: 'teams:read', icon: IconCompass },
  { id: 'overview', label: 'Vue d’ensemble', perm: 'overview:read', icon: IconChart },
  { id: 'direction', label: 'Direction Générale', perm: 'executive:read', icon: IconCrown },
  { id: 'vigilance', label: 'Vigilance ORION', perm: 'vigilance:read', icon: IconCompass },
  { id: 'alerts', label: 'Supervision SAMU', perm: 'alerts:read', icon: IconAlarm },
  { id: 'support', label: 'Support & chat', perm: 'support:read', icon: IconMessage },
  { id: 'messagesClients', label: 'Messages clients', perm: 'notify:read', icon: IconMail },
  { id: 'notify', label: 'Notifications', perm: 'notify:read', icon: IconMegaphone },
  { id: 'rides', label: 'Courses', perm: 'rides:read', icon: IconCar },
  { id: 'dispatch', label: 'Dispatch', perm: 'rides:write', icon: IconTarget },
  { id: 'quality', label: 'Qualité & notes', perm: 'drivers:read', icon: IconStar },
  { id: 'green', label: 'Mobilité verte', perm: 'overview:read', icon: IconLeaf },
  { id: 'teams', label: 'Équipes', perm: 'teams:read', icon: IconUsers },
  { id: 'crew', label: 'Équipages', perm: 'crew:read', icon: IconIdCard },
  { id: 'intel', label: 'Intelligence', perm: 'rides:read', icon: IconActivity },
  { id: 'b2b', label: 'Entreprises (B2B)', perm: 'finance:read', icon: IconBuilding },
  { id: 'rental', label: 'Location Signature', perm: 'rental:read', icon: IconGem },
  { id: 'rentalTarifs', label: 'Tarifs location', perm: 'rental:read', icon: IconTag },
  { id: 'telematique', label: 'Suivi véhicules', perm: 'rental:read', icon: IconSignal },
  { id: 'subscriptions', label: 'Abonnements', perm: 'rental:read', icon: IconTicket },
  { id: 'disputes', label: 'Litiges', perm: 'support:read', icon: IconScale },
  { id: 'drivers', label: 'Chauffeurs', perm: 'drivers:read', icon: IconSteering },
  { id: 'clients', label: 'Clients', perm: 'clients:read', icon: IconUsers },
  { id: 'finance', label: 'Finances', perm: 'finance:read', icon: IconTrend },
  { id: 'treasury', label: 'Trésorerie', perm: 'treasury:read', icon: IconBank },
  { id: 'caisses', label: 'Caisses espèces', perm: 'caisse:read', icon: IconCash },
  { id: 'pricing', label: 'Tarification', perm: 'pricing:read', icon: IconWallet },
  { id: 'zones', label: 'Zones & tarifs', perm: 'pricing:read', icon: IconMap },
  { id: 'promos', label: 'Codes promo', perm: 'promos:read', icon: IconTicket },
  { id: 'services', label: 'Services & ville', perm: 'services:read', icon: IconGrid },
  { id: 'audit', label: 'Journal', perm: 'audit:read', icon: IconFile },
  { id: 'sessions', label: 'Sessions actives', perm: 'sessions:read', icon: IconMonitor },
  { id: 'security', label: 'Alertes sécurité', perm: 'security:read', icon: IconAlert },
  { id: 'comptes', label: 'Personnel & accès', perm: 'accounts:read', icon: IconIdCard },
  { id: 'habilitations', label: 'Habilitations', perm: 'habilitations:read', icon: IconKey },
  { id: 'roles', label: 'Rôles & accès', perm: 'roles:read', icon: IconShield },
];

/* ------------------------------- Console ----------------------------- */
function Console({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsDays, setStatsDays] = useState(7);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [fleet, setFleet] = useState<FleetUnit[]>([]);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [services, setServices] = useState<ServicesConfig | null>(null);
  const [support, setSupport] = useState<Conversation[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [broadcasts, setBroadcasts] = useState<Announcement[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // L'employé arrive sur SON poste : ce qui l'attend, pas un tableau de bord général.
  const [section, setSection] = useState<Section>('monPoste');
  // Téléphone et tablette en portrait : le menu est un tiroir, fermé par défaut.
  const [menuOuvert, setMenuOuvert] = useState(false);
  /*
   * Sur petit écran, un tableau large défile horizontalement dans sa carte. Une zone qui
   * défile doit être atteignable au clavier (WCAG 2.1.1) : elle devient une région nommée
   * et focalisable, seulement quand elle déborde réellement.
   */
  useEffect(() => {
    const marquer = () => {
      for (const carte of document.querySelectorAll<HTMLElement>('.adm-main .adm-card')) {
        const deborde = carte.scrollWidth > carte.clientWidth + 1;
        if (deborde && !carte.hasAttribute('tabindex')) {
          carte.tabIndex = 0;
          carte.setAttribute('role', 'region');
          carte.setAttribute('aria-label', carte.querySelector('h3')?.textContent?.trim() || 'Tableau');
          carte.dataset.defile = '1';
        } else if (!deborde && carte.dataset.defile) {
          carte.removeAttribute('tabindex'); carte.removeAttribute('role'); carte.removeAttribute('aria-label'); delete carte.dataset.defile;
        }
      }
    };
    const id = window.setTimeout(marquer, 400);
    window.addEventListener('resize', marquer);
    return () => { window.clearTimeout(id); window.removeEventListener('resize', marquer); };
  });
  const [driverSel, setDriverSel] = useState<DriverDetail | null>(null);
  const [clientSel, setClientSel] = useState<ClientDetail | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [appareils, setAppareils] = useState<{ appareils: AppareilPublic[]; exige: boolean; configure: boolean } | null>(null);
  const [selfSession, setSelfSession] = useState<string | null>(null);
  const [ops, setOps] = useState<OpsConfig | null>(null);
  const [quality, setQuality] = useState<{ threshold: number; autoWarn: boolean; drivers: QualityRow[] } | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [forensic, setForensic] = useState<RideForensic | null>(null);
  const [green, setGreen] = useState<GreenReport | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [predict, setPredict] = useState<{ hour: number; cells: PredictCell[] } | null>(null);
  const [conversion, setConversion] = useState<ConversionCell[]>([]);
  const [churn, setChurn] = useState<ChurnReport | null>(null);
  const [corporate, setCorporate] = useState<CorporateAccount[]>([]);
  const [sosSel, setSosSel] = useState<SosDossier | null>(null);
  /**
   * ALARME SOS en temps réel. La console relisait les alertes toutes les 6 s et le
   * flux d'urgence du serveur n'était branché nulle part : une détresse pouvait
   * attendre plusieurs secondes avant d'apparaître, sans aucun signal.
   */
  const [alarmeSos, setAlarmeSos] = useState<{ id: string; kind: string; level: string; zone?: string; at: string; nouvelles: number } | null>(null);
  const sosSelId = useRef<string | null>(null);
  useEffect(() => { sosSelId.current = sosSel?.alert.id ?? null; }, [sosSel]);
  const [security, setSecurity] = useState<SecurityAttempt[]>([]);
  /* --- Équipages, caisses, poste d'équipe, télématique, annuaire --- */
  const [equipages, setEquipages] = useState<EquipageRow[]>([]);
  const [equipagesTotal, setEquipagesTotal] = useState(0);
  const [crewTableau, setCrewTableau] = useState<CrewTableau | null>(null);
  const [crewQ, setCrewQ] = useState('');
  const [dossierCrew, setDossierCrew] = useState<DossierEquipage | null>(null);
  const [caisses, setCaisses] = useState<CaisseEtat[]>([]);
  const [maCaisse, setMaCaisse] = useState<CaisseEtat | null>(null);
  const [caisseConso, setCaisseConso] = useState<CaisseConsolidation | null>(null);
  const [caisseRef, setCaisseRef] = useState<CaisseReferentiel | null>(null);
  const [posteEquipe, setPosteEquipe] = useState<PosteEquipe | null>(null);
  const [equipeSel, setEquipeSel] = useState('');
  const [suiviFlotte, setSuiviFlotte] = useState<SuiviFlotte | null>(null);
  const [comptes, setComptes] = useState<StaffAccountRow[]>([]);
  const [comptesStats, setComptesStats] = useState<AccountsStats | null>(null);
  const [rolesDispo, setRolesDispo] = useState<RoleOption[]>([]);
  const [delegables, setDelegables] = useState<string[]>([]);
  const [mdpOuvert, setMdpOuvert] = useState(false);
  const [supportStats, setSupportStats] = useState<SupportStats | null>(null);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [triggers, setTriggers] = useState<Triggers | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [csat, setCsat] = useState<CsatReport | null>(null);
  const [qTop, setQTop] = useState<QualityTop[]>([]);
  // S8 Équipes / RH
  const [staffKpis, setStaffKpis] = useState<StaffKpi[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceTicket[]>([]);
  // S9 IA
  const [fraud, setFraud] = useState<FraudReport | null>(null);
  const [elasticity, setElasticity] = useState<ElasticityCell[]>([]);
  // S12-S15
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [cashDebt, setCashDebt] = useState<CashDebtor[]>([]);
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [expenses, setExpenses] = useState<ExpenseTicket[]>([]);
  const [liquidity, setLiquidity] = useState<Liquidity | null>(null);
  const [amortization, setAmortization] = useState<Amortization | null>(null);
  // Location Signature & abonnements ORION
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [prestige, setPrestige] = useState<PrestigeUnit[]>([]);
  const [rentalStats, setRentalStats] = useState<RentalStats | null>(null);
  const [rentalDispos, setRentalDispos] = useState<RentalAvailabilityRow[]>([]);
  const [subPlans, setSubPlans] = useState<SubPlanRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [subInvoices, setSubInvoices] = useState<SubInvoiceRow[]>([]);
  const [subStats, setSubStats] = useState<SubStats | null>(null);
  const [rentalTarifs, setRentalTarifs] = useState<RentalTarifEtat | null>(null);
  const [contacts, setContacts] = useState<ContactUrgence[]>([]);
  // Direction Générale (poste du PDG)
  const [board, setBoard] = useState<ExecutiveBoard | null>(null);
  const [livre, setLivre] = useState<MouvementPage | null>(null);
  const [execJours, setExecJours] = useState(30);
  const [livrePage, setLivrePage] = useState(1);
  const [livreFiltre, setLivreFiltre] = useState<{ sens?: 'entree' | 'sortie'; categorie?: string }>({});
  const [vigilance, setVigilance] = useState<SanteVigilance | null>(null);
  const [monPoste, setMonPoste] = useState<MonPoste | null>(null);
  /** Modale « accès refusé » : session verrouillée, tentative signalée à la direction. */
  const [denied, setDenied] = useState<string | null>(null);
  /** Bandeau d'erreur serveur (opération refusée ou indisponible) — non bloquant. */
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => localStorage.getItem('orion.admin.muted') === '1');
  const [theme, setTheme] = useState<AdmTheme>(savedTheme);
  const [ridesPage, setRidesPage] = useState(1);
  const [driversPage, setDriversPage] = useState(1);
  const [clientsPage, setClientsPage] = useState(1);
  const emptyMeta: PageMeta = { total: 0, page: 1, pages: 1 };
  const [ridesMeta, setRidesMeta] = useState<PageMeta>(emptyMeta);
  const [driversMeta, setDriversMeta] = useState<PageMeta>(emptyMeta);
  const [clientsMeta, setClientsMeta] = useState<PageMeta>(emptyMeta);

  /*
   * Démonstration sans serveur : les courses du serveur de test partagé (app client et app
   * chauffeur ouvertes depuis la même adresse, ou sur le même téléphone) s'ajoutent en tête
   * des données d'exemple, avec le chauffeur de test, et les compteurs les comptent.
   */
  const busRef = useRef<EtatBus | null>(null);
  const loadDemo = useCallback(() => {
    const bus = fusionBusConsole(busRef.current, DEMO.overview, DEMO.rides, DEMO.drivers);
    setMe(DEMO.me); setOv(bus.overview); setStats(DEMO.stats(statsDays)); setAlerts(DEMO.sos as Alert[]); setFleet(DEMO.fleet);
    setSecurity(DEMO.security as SecurityAttempt[]);
    setSupportStats(DEMO.supportStats); setMacros(DEMO.macros);
    setTriggers(DEMO.triggers as Triggers); setReservations(DEMO.reservations as Reservation[]);
    setCsat(DEMO.csat as CsatReport); setQTop(DEMO.qualityTop as QualityTop[]);
    setStaffKpis(DEMO.staffKpis as StaffKpi[]); setShifts(DEMO.shifts as Shift[]); setMaintenance(DEMO.maintenance as MaintenanceTicket[]);
    setFraud(DEMO.fraud as FraudReport); setElasticity(DEMO.elasticity as ElasticityCell[]);
    setExpiring(DEMO.expiring as ExpiringDoc[]); setCashDebt(DEMO.cashDebt as CashDebtor[]); setGateways(DEMO.gateways as GatewayStatus[]);
    setExpenses(DEMO.expenses as ExpenseTicket[]); setLiquidity(DEMO.liquidity as Liquidity); setAmortization(DEMO.amortization as Amortization);
    const dr = pageSlice(bus.rides, ridesPage); setRides(dr.items); setRidesMeta(dr.meta);
    const dd = pageSlice(bus.drivers, driversPage); setDrivers(dd.items); setDriversMeta(dd.meta);
    const dc = pageSlice(DEMO.clients, clientsPage); setClients(dc.items); setClientsMeta(dc.meta);
    setPricing(DEMO.pricing); setZones(DEMO.zones as Zone[]);
    setPromos(DEMO.promos as Promo[]); setServices(DEMO.services);
    setSupport(DEMO.support as Conversation[]); setAudit(DEMO.audit as AuditEntry[]);
    setFinance(DEMO.finance); setBroadcasts(DEMO.broadcasts as Announcement[]);
    setTransfers(DEMO.treasury as Transfer[]);
    setSessions(DEMO.sessions as ActiveSession[]); setSelfSession(DEMO.sessions[0]?.id ?? null);
    setOps(DEMO.ops as OpsConfig); setQuality(DEMO.quality()); setDisputes(DEMO.disputes as Dispute[]);
    setGreen(DEMO.green as GreenReport);
    setTeams(DEMO.teams as Team[]);
    setPredict(DEMO.predict); setConversion(DEMO.conversion); setChurn(DEMO.churn);
    setCorporate(DEMO.corporate as CorporateAccount[]);
    setRentals(DEMO.rentals); setPrestige(DEMO.prestige); setRentalStats(DEMO.rentalStats); setRentalDispos(DEMO.rentalDispos);
    setSubPlans(DEMO.subPlans); setSubscriptions(DEMO.subscriptions); setSubInvoices(DEMO.subInvoices); setSubStats(DEMO.subStats);
    setRentalTarifs(DEMO.rentalTarifs); setContacts(DEMO.contacts as ContactUrgence[]);
    setBoard(DEMO.executive as ExecutiveBoard); setLivre(DEMO.livre as MouvementPage);
    setVigilance(DEMO.vigilance as SanteVigilance); setMonPoste(DEMO.monPoste as MonPoste);
    setLive(false);
  }, [statsDays, ridesPage, driversPage, clientsPage]);

  // UN SEUL rafraîchissement à la fois. Sous forte charge, un tour complet peut durer
  // plus que les 6 s de l'intervalle : les tours s'empilaient, chacun relançant toutes
  // les lectures, et la console ralentissait le serveur qu'elle surveille. Un tour
  // demandé pendant qu'un autre tourne est rejoué une fois, à la fin.
  const tourEnCours = useRef<{ encore: boolean } | null>(null);
  const dernierRefresh = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    if (!LIVE) { loadDemo(); return; }
    if (tourEnCours.current) { tourEnCours.current.encore = true; return; }
    tourEnCours.current = { encore: false };
    try {
      const meRes = await adminGet<Me>('/admin/me');
      setMe(meRes); setLive(true);
      const has = (p: string) => meRes.permissions.includes(p);
      if (has('overview:read')) { setOv(await adminGet<Overview>('/admin/overview')); setStats(await adminGet<Stats>(`/admin/stats?days=${statsDays}`)); }
      if (has('alerts:read')) {
        // Session SAMU : file de triage (niveaux + SLA). Les messages pré-enregistrés
        // sont renvoyés avec le dossier d'une alerte (SosDrawer).
        setAlerts((await adminGet<{ alerts: Alert[] }>('/admin/sos')).alerts);
      }
      if (has('security:read')) setSecurity((await adminGet<{ attempts: SecurityAttempt[] }>('/admin/security-alerts')).attempts);
      if (has('alerts:read')) setContacts((await adminGet<{ contacts: ContactUrgence[] }>('/admin/contacts')).contacts);
      if (has('vigilance:read')) setVigilance(await adminGet<SanteVigilance>('/admin/vigilance'));
      // « Mon poste » n'exige aucun droit particulier : chacun y voit ce qui porte son nom.
      setMonPoste(await adminGet<MonPoste>('/admin/mon-poste'));
      if (has('crew:read') || has('crew:self')) {
        const c = await adminGet<{ equipages: EquipageRow[]; total?: number; tableau: CrewTableau | null }>(`/admin/crew${crewQ ? `?q=${encodeURIComponent(crewQ)}` : ''}`);
        setEquipages(c.equipages); setEquipagesTotal(c.total ?? c.equipages.length); setCrewTableau(c.tableau);
      }
      if (has('caisse:read')) {
        const c = await adminGet<{ caisses: CaisseEtat[]; maCaisse: CaisseEtat | null; consolidation: CaisseConsolidation | null; referentiel: CaisseReferentiel }>('/admin/caisses');
        setCaisses(c.caisses); setMaCaisse(c.maCaisse); setCaisseConso(c.consolidation); setCaisseRef(c.referentiel);
      }
      if (has('accounts:read')) {
        const a = await adminGet<{ accounts: StaffAccountRow[]; stats: AccountsStats; roles: RoleOption[]; delegables: string[] }>('/admin/accounts');
        setComptes(a.accounts); setComptesStats(a.stats); setRolesDispo(a.roles); setDelegables(a.delegables);
      }
      if (has('rental:read')) setSuiviFlotte(await adminGet<SuiviFlotte>('/admin/rental/flotte/positions'));
      if (has('executive:read')) {
        setBoard(await adminGet<ExecutiveBoard>(`/admin/executive?days=${execJours}`));
        const q = new URLSearchParams({ days: String(execJours), page: String(livrePage) });
        if (livreFiltre.sens) q.set('sens', livreFiltre.sens);
        if (livreFiltre.categorie) q.set('categorie', livreFiltre.categorie);
        setLivre(await adminGet<MouvementPage>(`/admin/executive/livre?${q.toString()}`));
      }
      if (has('drivers:read')) {
        setFleet((await adminGet<{ fleet: FleetUnit[] }>('/admin/fleet/live')).fleet);
        const d = await adminGet<{ drivers: DriverRow[] } & PageMeta>(`/admin/drivers?page=${driversPage}&limit=${PAGE_SIZE}`);
        setDrivers(d.drivers); setDriversMeta({ total: d.total, page: d.page, pages: d.pages });
        setExpiring((await adminGet<{ drivers: ExpiringDoc[] }>('/admin/drivers/expiring')).drivers);
      }
      if (has('rides:read')) {
        const r = await adminGet<{ rides: RideRow[] } & PageMeta>(`/admin/rides?page=${ridesPage}&limit=${PAGE_SIZE}`);
        setRides(r.rides); setRidesMeta({ total: r.total, page: r.page, pages: r.pages });
      }
      if (has('pricing:read')) { setPricing((await adminGet<{ pricing: Pricing }>('/admin/pricing')).pricing); setZones((await adminGet<{ zones: Zone[] }>('/admin/zones')).zones); }
      if (has('clients:read')) {
        const c = await adminGet<{ clients: Client[] } & PageMeta>(`/admin/clients?page=${clientsPage}&limit=${PAGE_SIZE}`);
        setClients(c.clients); setClientsMeta({ total: c.total, page: c.page, pages: c.pages });
      }
      if (has('promos:read')) setPromos((await adminGet<{ promos: Promo[] }>('/admin/promos')).promos);
      if (has('services:read')) setServices((await adminGet<{ config: ServicesConfig }>('/admin/services')).config);
      if (has('support:read')) {
        const sp = await adminGet<{ conversations: Conversation[]; stats?: SupportStats }>('/admin/support');
        setSupport(sp.conversations); if (sp.stats) setSupportStats(sp.stats);
        setMacros((await adminGet<{ macros: Macro[] }>('/admin/support/macros')).macros);
      }
      if (has('finance:read')) {
        setFinance(await adminGet<Finance>('/admin/finance'));
        setCashDebt((await adminGet<{ debtors: CashDebtor[] }>('/admin/finance/cash-debt')).debtors);
        setGateways((await adminGet<{ gateways: GatewayStatus[] }>('/admin/finance/gateways')).gateways);
        setExpenses((await adminGet<{ tickets: ExpenseTicket[] }>('/admin/expenses')).tickets);
      }
      if (has('treasury:read')) {
        setTransfers((await adminGet<{ transfers: Transfer[] }>('/admin/treasury')).transfers);
        setLiquidity(await adminGet<Liquidity>('/admin/liquidity'));
        setAmortization(await adminGet<Amortization>('/admin/treasury/amortization'));
      }
      if (has('sessions:read')) {
        const s = await adminGet<{ sessions: ActiveSession[]; self: string | null }>('/admin/sessions'); setSessions(s.sessions); setSelfSession(s.self);
        setAppareils(await adminGet<{ appareils: AppareilPublic[]; exige: boolean; configure: boolean }>('/admin/appareils').catch(() => null));
      }
      if (has('rides:read')) setOps((await adminGet<{ ops: OpsConfig }>('/admin/dispatch')).ops);
      if (has('overview:read')) setGreen(await adminGet<GreenReport>('/admin/green'));
      if (has('teams:read')) {
        const mesEquipes = (await adminGet<{ teams: Team[] }>('/admin/teams')).teams;
        setTeams(mesEquipes);
        // Poste d'équipe : on ouvre celle qui est sélectionnée, sinon la première.
        const cible = mesEquipes.some((t) => t.id === equipeSel) ? equipeSel : mesEquipes[0]?.id;
        if (cible) {
          if (cible !== equipeSel) setEquipeSel(cible);
          try { setPosteEquipe((await adminGet<{ poste: PosteEquipe }>(`/admin/teams/${cible}/poste`)).poste); }
          catch { setPosteEquipe(null); }
        } else {
          setPosteEquipe(null);
        }
        setStaffKpis((await adminGet<{ staff: StaffKpi[] }>('/admin/staff/productivity')).staff);
        setShifts((await adminGet<{ shifts: Shift[] }>('/admin/shifts')).shifts);
        setMaintenance((await adminGet<{ tickets: MaintenanceTicket[] }>('/admin/maintenance')).tickets);
      }
      if (has('rides:read')) {
        setPredict(await adminGet<{ hour: number; cells: PredictCell[] }>('/admin/predict'));
        setConversion((await adminGet<{ cells: ConversionCell[] }>('/admin/conversion')).cells);
        setFraud(await adminGet<FraudReport>('/admin/fraud'));
        setElasticity((await adminGet<{ cells: ElasticityCell[] }>('/admin/elasticity')).cells);
      }
      if (has('overview:read')) setChurn(await adminGet<ChurnReport>('/admin/churn'));
      if (has('finance:read')) setCorporate((await adminGet<{ accounts: CorporateAccount[] }>('/admin/corporate')).accounts);
      if (has('drivers:read')) {
        const q = await adminGet<{ threshold: number; autoWarn: boolean; drivers: QualityRow[]; top?: QualityTop[] }>('/admin/quality');
        setQuality(q); setQTop(q.top ?? []);
        setCsat(await adminGet<CsatReport>('/admin/quality/csat'));
      }
      if (has('notify:read')) setTriggers(await adminGet<Triggers>('/admin/notify/triggers'));
      if (has('rides:read')) setReservations((await adminGet<{ reservations: Reservation[] }>('/admin/reservations')).reservations);
      if (has('support:read')) setDisputes((await adminGet<{ disputes: Dispute[] }>('/admin/disputes')).disputes);
      if (has('notify:read')) setBroadcasts((await adminGet<{ announcements: Announcement[] }>('/admin/broadcasts')).announcements);
      if (has('rental:read')) {
        const loc = await adminGet<{ reservations: RentalRow[]; fleet: PrestigeUnit[]; stats: RentalStats; disponibilites: RentalAvailabilityRow[] }>('/admin/rental');
        setRentals(loc.reservations); setPrestige(loc.fleet); setRentalStats(loc.stats); setRentalDispos(loc.disponibilites);
        const abo = await adminGet<{ plans: SubPlanRow[]; subscriptions: SubscriptionRow[]; invoices: SubInvoiceRow[]; stats: SubStats }>('/admin/subscriptions');
        setSubPlans(abo.plans); setSubscriptions(abo.subscriptions); setSubInvoices(abo.invoices); setSubStats(abo.stats);
        setRentalTarifs(await adminGet<RentalTarifEtat>('/admin/rental/tarifs'));
      }
      if (has('audit:read')) setAudit((await adminGet<{ entries: AuditEntry[] }>('/admin/audit')).entries);
    } catch { loadDemo(); }
    finally {
      const rejouer = tourEnCours.current?.encore;
      tourEnCours.current = null;
      if (rejouer) void dernierRefresh.current();
    }
  }, [loadDemo, statsDays, ridesPage, driversPage, clientsPage, execJours, livrePage, livreFiltre]);
  dernierRefresh.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  // Flux d'urgence : nouvelle alerte → alarme + file à jour ; tout geste sur une
  // alerte (prise en charge, message, secours joints, réponse de l'usager) →
  // file et dossier ouvert rafraîchis à l'instant, sur tous les postes.
  const peutSuperviser = Boolean(me?.permissions.includes('alerts:read'));
  useEffect(() => {
    if (!LIVE || !peutSuperviser) return;
    let ferme = false;
    let ws: WebSocket | null = null;
    let relance: number | undefined;
    // Une rafale d'alertes donnait une relecture de la file par alerte, toutes en même
    // temps. Une seule relecture à la fois ; celles demandées entre-temps n'en font qu'une.
    let enVol = false;
    let encore = false;
    let dossiers = new Set<string>();
    const rafraichir = async (alertId?: string) => {
      if (alertId) dossiers.add(alertId);
      if (enVol) { encore = true; return; }
      enVol = true;
      const aRelire = dossiers;
      dossiers = new Set();
      try {
        setAlerts((await adminGet<{ alerts: Alert[] }>('/admin/sos')).alerts);
        const ouvert = sosSelId.current;
        if (ouvert && aRelire.has(ouvert)) setSosSel(await adminGet<SosDossier>(`/admin/sos/${ouvert}`));
      } catch { /* refus déjà signalé par la couche réseau */ }
      enVol = false;
      if (encore || dossiers.size) { encore = false; void rafraichir(); }
    };
    const connecter = () => {
      let hote = window.location.host;
      let proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (API) { try { const u = new URL(API); hote = u.host; proto = u.protocol === 'https:' ? 'wss:' : 'ws:'; } catch { /* URL invalide */ } }
      ws = new WebSocket(`${proto}//${hote}/ws/emergency`);
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data as string) as { type: string; data?: { id?: string; alertId?: string; kind?: string; level?: string; zoneName?: string; createdAt?: string } };
          if (m.type === 'emergency.alert' && m.data?.id) {
            const level = m.data.level ?? 'rouge';
            const alerte = { id: m.data.id, kind: m.data.kind ?? 'sos', level, zone: m.data.zoneName, at: m.data.createdAt ?? new Date().toISOString() };
            setAlarmeSos((a) => ({ ...alerte, nouvelles: (a?.nouvelles ?? 0) + 1 }));
            // Le signal sonore est réservé au niveau rouge (SOS, choc) : une déviation
            // d'itinéraire s'affiche, mais ne fait pas sursauter toute la salle.
            if (level === 'rouge') sonnerAlarme();
            void rafraichir();
          } else if (m.type === 'emergency.update' || m.type === 'emergency.chat' || m.type === 'sos.contact') {
            void rafraichir(m.data?.alertId ?? m.data?.id);
          }
        } catch { /* trame illisible */ }
      };
      ws.onclose = () => { if (!ferme) relance = window.setTimeout(connecter, 3000); };
    };
    connecter();
    return () => { ferme = true; window.clearTimeout(relance); ws?.close(); };
  }, [peutSuperviser]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = LIVE ? setInterval(() => void refresh(), 6000) : undefined;
    return () => { clearInterval(t); if (p) clearInterval(p); };
  }, [refresh]);
  // Serveur de test partagé : une course de l'app client ou un geste du chauffeur de test
  // rafraîchit les courses, la flotte et les compteurs — rien d'autre n'est remis à zéro.
  useEffect(() => {
    if (LIVE) return;
    let empreinte = '';
    return suivreBus((e) => {
      const k = empreinteBus(e);
      if (k === empreinte) return;
      empreinte = k;
      busRef.current = e;
      const bus = fusionBusConsole(e, DEMO.overview, DEMO.rides, DEMO.drivers);
      setOv(bus.overview);
      const dr = pageSlice(bus.rides, ridesPage); setRides(dr.items); setRidesMeta(dr.meta);
      const dd = pageSlice(bus.drivers, driversPage); setDrivers(dd.items); setDriversMeta(dd.meta);
    }, 2500);
  }, [ridesPage, driversPage]);

  // Rend VISIBLE tout refus ou erreur d'appel à l'API. Exigence transversale : un 403
  // doit afficher à l'employé qu'il n'a pas le droit d'agir sans autorisation de la
  // direction (le serveur a déjà notifié DG, CFO, DAA). Les autres erreurs passent en
  // bandeau, afin qu'aucune opération refusée ne paraisse avoir réussi.
  useEffect(() => {
    setAdminErrorSink((e) => { if (e.isDenied) setDenied(e.message); else setNotice(e.message); });
    return () => setAdminErrorSink(() => {});
  }, []);
  // Le bandeau d'erreur s'effface de lui-même (l'employé peut aussi le fermer).
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  // Alertes SAMU temps réel : sirène + notification navigateur à chaque NOUVELLE alerte.
  const seenAlerts = useRef<Set<string> | null>(null);
  useEffect(() => {
    const open = alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled');
    if (seenAlerts.current === null) { seenAlerts.current = new Set(open.map((a) => a.id)); return; }
    const fresh = open.filter((a) => !seenAlerts.current!.has(a.id));
    for (const a of fresh) seenAlerts.current!.add(a.id);
    if (fresh.length === 0) return;
    if (!muted) playSiren();
    if ('Notification' in window && Notification.permission === 'granted') {
      const a = fresh[0]!;
      new Notification('Alerte SAMU — ORION', {
        body: `${a.kind === 'crash' ? 'Accident détecté' : 'SOS client'} · ${a.zoneName ?? 'Abidjan'} — ouvre la console.`,
        tag: a.id,
      });
    }
  }, [alerts, muted]);

  // Autorisation de notification navigateur (demandée une seule fois).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  }, []);

  /** Téléchargement authentifié d'un fichier serveur (PDF/CSV) via la session JWT. */
  const downloadFile = async (path: string, filename: string) => {
    if (!LIVE) { avis('Disponible avec le backend connecté — le document est généré côté serveur.'); return; }
    try {
      const res = await fetch(API + path, { headers: H(), credentials: 'include' });
      if (res.status === 401) { onUnauthorized(); return; }
      // Refus/erreur : on remonte le message du serveur (403 → message de la direction)
      // au lieu d'un avertissement générique, et on ne télécharge rien.
      if (!res.ok) { await reportResponse(res); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    } catch (e) { if (!(e instanceof AdminError)) setNotice('Document indisponible : serveur injoignable.'); }
  };

  /* --------------- Session SAMU : triage, prise en charge, clôture --------------- */
  const claimSos = async (id: string) => {
    if (!LIVE) { setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, agent: me?.name, status: 'acknowledged' } : a))); return; }
    try { await adminPost(`/admin/sos/${id}/claim`); void refresh(); }
    catch { avis('Alerte déjà prise en charge par un autre agent (verrou nominatif).'); }
  };
  const openSos = async (id: string) => {
    if (!LIVE) { setSosSel(DEMO.sosDossier(id) as SosDossier); return; }
    try { setSosSel(await adminGet<SosDossier>(`/admin/sos/${id}`)); }
    catch { avis('Dossier scellé — accès réservé à la direction.'); }
  };
  const sosMessage = async (id: string, text: string) => {
    if (LIVE) { try { await adminPost(`/admin/sos/${id}/message`, { text }); } catch { avis('Crise gérée par un autre agent.'); return; } }
    const msg: SosChat = { from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    setSosSel((s) => (s && s.alert.id === id ? { ...s, alert: { ...s.alert, chat: [...(s.alert.chat ?? []), msg] } } : s));
  };
  const closeSos = async (id: string, note: string) => {
    if (LIVE) {
      try { await adminPost(`/admin/sos/${id}/close`, { note }); }
      catch { avis('Clôture refusée : note de synthèse trop courte, ou vous n’êtes pas l’agent gestionnaire.'); return; }
    }
    setAlerts((xs) => xs.map((a) => (a.id === id ? { ...a, status: 'resolved', sealed: true, closingNote: note } : a)));
    setSosSel(null);
  };

  /* ------ Accès non autorisé : refus affiché + signalement direction ------ */
  const openLocked = async (sectionId: string, label: string) => {
    if (LIVE) { try { await adminPost('/admin/access-denied', { section: sectionId }); } catch { /* déjà signalé côté serveur */ } }
    setDenied(`Vous n’avez pas le droit d’accéder à la session « ${label} » sans autorisation de la direction. Cette tentative vient d’être signalée à la direction (DG, CFO, DAA).`);
  };

  const savePricing = async (patch: Partial<Pricing>) => {
    if (!LIVE) { setPricing((p) => (p ? { ...p, ...patch, multipliers: { ...p.multipliers, ...(patch.multipliers ?? {}) } } : p)); return; }
    const { pricing: next } = await adminPut<{ pricing: Pricing }>('/admin/pricing', patch);
    setPricing(next);
  };

  const saveZone = async (zn: Zone) => {
    if (!LIVE) { setZones((xs) => (xs.some((z) => z.id === zn.id) ? xs.map((z) => (z.id === zn.id ? zn : z)) : [...xs, zn])); return; }
    const { zone } = await adminPut<{ zone: Zone }>('/admin/zones', zn);
    setZones((xs) => (xs.some((z) => z.id === zone.id) ? xs.map((z) => (z.id === zone.id ? zone : z)) : [...xs, zone]));
  };
  const toggleZone = async (id: string, active: boolean) => {
    if (LIVE && !(await safePost(`/admin/zones/${id}/active`, { active }))) return;
    setZones((xs) => xs.map((z) => (z.id === id ? { ...z, active } : z)));
  };
  const deleteZone = async (id: string) => {
    if (LIVE) await adminDel(`/admin/zones/${id}`);
    setZones((xs) => xs.filter((z) => z.id !== id));
  };
  const resetZones = async () => {
    if (!LIVE) { setZones(DEMO.zones as Zone[]); return; }
    const { zones: next } = await adminPost<{ zones: Zone[] }>('/admin/zones/reset');
    setZones(next);
  };

  const setClientStatus = async (id: string, status: string) => {
    if (!LIVE) { setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); return; }
    try { await adminPost(`/admin/clients/${id}/status`, { status }); setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status } : c))); } catch { /* ignore */ }
  };

  const savePromo = async (p: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number }) => {
    if (!LIVE) { setPromos((xs) => { const id = p.code.toUpperCase(); const ex = xs.find((x) => x.id === id); const np: Promo = { id, kind: p.kind, value: p.value, active: ex?.active ?? true, uses: ex?.uses ?? 0, maxUses: p.maxUses, createdAt: ex?.createdAt ?? new Date().toISOString() }; return ex ? xs.map((x) => (x.id === id ? np : x)) : [np, ...xs]; }); return; }
    const { promo } = await adminPut<{ promo: Promo }>('/admin/promos', p);
    setPromos((xs) => (xs.some((x) => x.id === promo.id) ? xs.map((x) => (x.id === promo.id ? promo : x)) : [promo, ...xs]));
  };
  const togglePromo = async (code: string, active: boolean) => {
    if (!LIVE) { setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); return; }
    try { await adminPost(`/admin/promos/${code}/active`, { active }); setPromos((xs) => xs.map((x) => (x.id === code ? { ...x, active } : x))); } catch { /* */ }
  };
  const deletePromo = async (code: string) => {
    if (LIVE) await adminDel(`/admin/promos/${code}`);
    setPromos((xs) => xs.filter((x) => x.id !== code));
  };

  const saveServices = async (patch: Partial<ServicesConfig>) => {
    if (!LIVE) { setServices((s) => (s ? { ...s, ...patch, services: { ...s.services, ...(patch.services ?? {}) } } : s)); return; }
    const { config } = await adminPut<{ config: ServicesConfig }>('/admin/services', patch);
    setServices(config);
  };

  const supportReply = async (convId: string, text: string) => {
    const msg: SupportMsg = { id: Math.random().toString(36).slice(2, 8), from: 'agent', author: me?.name, text, at: new Date().toISOString() };
    if (LIVE && !(await safePost(`/admin/support/${convId}/reply`, { text }))) return;
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg], status: 'pending' } : c)));
  };
  const supportSetStatus = async (convId: string, status: string) => {
    if (LIVE && !(await safePost(`/admin/support/${convId}/status`, { status }))) return;
    setSupport((xs) => xs.map((c) => (c.id === convId ? { ...c, status } : c)));
  };

  const sendBroadcast = async (a: { audience: string; title: string; body: string; channel?: string; segment?: string; scheduledAt?: string }) => {
    const local: Announcement = {
      id: Math.random().toString(36).slice(2, 8), author: me?.name ?? 'Admin', at: new Date().toISOString(),
      ...a, channel: (a.channel as Announcement['channel']) ?? 'push',
      stats: { sent: 1240, delivered: 1203, opened: 662, clicked: 199, rides: 53 },
    };
    // Sur refus/erreur, on n'ajoute PAS l'annonce localement : elle n'a pas été diffusée.
    if (LIVE) {
      try { const { announcement } = await adminPost<{ announcement: Announcement }>('/admin/broadcast', a); setBroadcasts((xs) => [announcement, ...xs]); }
      catch { /* déjà signalé à l'employé */ }
      return;
    }
    setBroadcasts((xs) => [local, ...xs]);
  };

  // Déclencheurs automatisés (batterie < 15 %, win-back 30 j).
  const runTrigger = async (trigger: 'battery' | 'winback') => {
    if (!LIVE) { avis(trigger === 'battery' ? 'Guidage borne envoyé aux véhicules < 15 % (démo).' : 'Campagne win-back envoyée avec un code RETOUR-XXXX (démo).'); return; }
    try {
      const r = await adminPost<{ sent: number; code?: string }>('/admin/notify/triggers/run', { trigger });
      avis(`${r.sent} notification(s) envoyée(s)${r.code ? ` · code ${r.code}` : ''}.`);
      void refresh();
    } catch { /* */ }
  };

  // Code promotionnel personnalisé de dédommagement (support).
  const compensate = async (clientId: string, percent: number) => {
    if (!LIVE) { avis(`Code DESOLE-${Math.random().toString(36).slice(2, 6).toUpperCase()} (-${percent} %) envoyé à ${clientId} (démo).`); return; }
    try {
      const { promo } = await adminPost<{ promo: { id: string } }>('/admin/promos/compensation', { clientId, percent, days: 7 });
      avis(`Code ${promo.id} (-${percent} %, 7 jours) envoyé dans l’app de ${clientId}.`);
    } catch { /* */ }
  };

  // Clôture forcée / ajustement de destination en vol (centre d'intervention manuelle).
  const forceRide = async (id: string, action: 'complete' | 'cancel') => {
    if (!LIVE) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, status: action === 'complete' ? 'completed' : 'cancelled' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/force`, { action }); void refresh(); } catch { /* déjà terminée */ }
  };
  const changeDestination = async (id: string) => {
    // Un lieu choisi dans les 48 924 lieux de la carte (les mêmes que dans l'app cliente),
    // au lieu de coordonnées à taper à la main.
    const lieu = await demanderLieu('Nouvelle destination de la course');
    if (!lieu) return;
    const { lat, lng } = lieu.location;
    if (!LIVE) { avis(`Destination mise à jour : ${lieu.name}. Devis recalculé (démo).`); return; }
    try {
      const r = await adminPut<{ ride: { amount: number } }>(`/admin/rides/${id}/destination`, { lat, lng });
      avis(`Destination mise à jour : ${lieu.name} — nouveau prix fixe : ${fcfa(r.ride.amount)}.`);
      void refresh();
    } catch { avis('Destination modifiable uniquement en course active.'); }
  };

  // Réservations à l'avance : assignation / annulation.
  const assignReservation = async (id: string) => {
    if (!LIVE) { setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'assignee', driverName: 'Serge Aka', punctualityAlert: false } : r))); return; }
    try { await adminPost(`/admin/reservations/${id}/assign`); void refresh(); }
    catch { avis('Aucun chauffeur disponible pour cette réservation.'); }
  };
  const cancelReservation = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/reservations/${id}/cancel`))) return;
    setReservations((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'annulee' } : r)));
  };

  const saveContact = async (c: { id?: string; label: string; numero: string; categorie?: 'secours' | 'interne' | 'partenaire'; actif?: boolean; note?: string }) => {
    if (!LIVE) { setContacts((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...c } : x))); return; }
    try { setContacts((await adminPut<{ contacts: ContactUrgence[] }>('/admin/contacts', c)).contacts); }
    catch { /* refus déjà signalé */ }
  };
  const deleteContact = async (id: string) => {
    if (!LIVE) { setContacts((xs) => xs.filter((x) => x.id !== id)); return; }
    try { await adminDel(`/admin/contacts/${id}`); setContacts((await adminGet<{ contacts: ContactUrgence[] }>('/admin/contacts')).contacts); }
    catch { /* refus déjà signalé (un numéro de secours ne se supprime pas) */ }
  };

  /**
   * Ouvre un lien de contact sans quitter la console : tel: et sms: vont au clavier ou à
   * l'application de messages du poste (téléphone, ordinateur relié, softphone) ; un lien
   * WhatsApp s'ouvre dans un nouvel onglet. Avant, `window.open(…, '_self')` remplaçait la
   * console par la page WhatsApp au milieu d'une crise.
   */
  const ouvrirLienContact = (lien: string) => {
    if (/^https?:/i.test(lien)) window.open(lien, '_blank', 'noopener');
    else ouvrirClavier(lien);
  };

  /**
   * MISE EN RELATION GÉNÉRIQUE — disponible depuis toutes les sessions.
   * Le serveur consigne la tentative puis renvoie le lien que le poste ouvre.
   */
  const contacter = async (p: { dossierType: string; dossierId: string; canal: 'appel' | 'sms' | 'whatsapp'; numero: string; label: string; message?: string }) => {
    if (!LIVE) { ouvrirClavier(p.canal === 'appel' ? (lienTel(p.numero) ?? `tel:${p.numero}`) : `sms:${numeroComposable(p.numero) ?? p.numero}`); return; }
    try {
      const r = await adminPost<{ lien: string }>('/admin/contact', p);
      ouvrirLienContact(r.lien);
    } catch { /* le refus (droit manquant) est déjà remonté */ }
  };

  /* -------------------- Poste de contact SOS -------------------- */
  /**
   * Mise en relation depuis le dossier SOS. Le serveur consigne la tentative AVANT la
   * composition et renvoie le lien ; le poste de l'opérateur l'ouvre (combiné, softphone).
   * Si le serveur refuse, aucun lien n'est ouvert et l'erreur est affichée : on ne laisse
   * pas croire qu'un secours a été prévenu alors que rien n'est parti.
   */
  const sosContact = async (
    alertId: string,
    p: { canal: 'appel' | 'sms' | 'whatsapp'; contactId?: string; numero?: string; label?: string; message?: string },
  ) => {
    if (!LIVE) {
      // Mode démo : on ouvre quand même le lien, mais sans inventer d'entrée au registre.
      if (p.numero) ouvrirClavier(p.canal === 'appel' ? (lienTel(p.numero) ?? `tel:${p.numero}`) : `sms:${numeroComposable(p.numero) ?? p.numero}`);
      return;
    }
    try {
      const r = await adminPost<{ lien: string; journal: ContactJournal[] }>(`/admin/sos/${alertId}/contact`, p);
      setSosSel((d) => (d && d.alert.id === alertId ? { ...d, journalContacts: r.journal } : d));
      // Ouvre le combiné / l'application de messagerie du poste.
      ouvrirLienContact(r.lien);
    } catch { /* le refus est déjà remonté par la couche réseau */ }
  };

  const sosContactIssue = async (
    alertId: string, entryId: string,
    issue: 'joint' | 'non_joint' | 'messagerie', compteRendu?: string,
  ) => {
    if (!LIVE) return;
    try {
      const r = await adminPost<{ journal: ContactJournal[] }>(`/admin/sos/${alertId}/contact/${entryId}`, { issue, compteRendu });
      setSosSel((d) => (d && d.alert.id === alertId ? { ...d, journalContacts: r.journal } : d));
    } catch { /* refus déjà signalé */ }
  };

  /** Demande interne de l'agent automatique traitée : la personne en détresse le voit aussitôt. */
  const sosDemandeFaite = async (alertId: string, cle: string) => {
    if (!LIVE) {
      const fait = new Date().toISOString();
      setSosSel((d) => (d && d.alert.id === alertId
        ? { ...d, alert: { ...d.alert, demandes: (d.alert.demandes ?? []).map((x) => (x.cle === cle && !x.traiteeLe ? { ...x, traiteeLe: fait, traiteePar: me?.name } : x)) } }
        : d));
      return;
    }
    try {
      const r = await adminPost<{ alert: Alert }>(`/admin/sos/${alertId}/demandes/${encodeURIComponent(cle)}/traiter`);
      setSosSel((d) => (d && d.alert.id === alertId ? { ...d, alert: { ...d.alert, ...r.alert } } : d));
    } catch { /* refus déjà signalé */ }
  };

  /* ---------------- Location Signature & abonnements ---------------- */
  // Chaque écriture passe par safePost : si le serveur refuse, l'affichage N'EST PAS
  // modifié. Une location affichée « confirmée » alors que le serveur l'a refusée
  // laisserait un client sans véhicule le jour de son mariage.
  const assignRental = async (id: string, driverId: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/assign`, { driverId }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, driverId } : r)));
  };
  const setRentalStatus = async (id: string, status: string, note?: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/status`, { status, note }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, status } : r)));
  };
  const cancelRental = async (id: string, raison?: string) => {
    if (LIVE && !(await safePost(`/admin/rental/${id}/annuler`, { raison }))) return;
    setRentals((xs) => xs.map((r) => (r.id === id ? { ...r, status: 'annulee' } : r)));
  };
  const paySubInvoice = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/subscriptions/invoices/${id}/payer`, { method: 'cash' }))) return;
    setSubInvoices((xs) => xs.map((f) => (f.id === id ? { ...f, status: 'payee', payeeLe: new Date().toISOString() } : f)));
  };
  const runEcheances = async () => {
    if (LIVE && !(await safePost('/admin/subscriptions/echeances'))) return;
    void refresh();
  };
  const saveRentalTarifs = async (patch: { tarif?: unknown; vehicules?: unknown }) => {
    if (LIVE) {
      try { setRentalTarifs(await adminPut<RentalTarifEtat>('/admin/rental/tarifs', patch)); void refresh(); }
      catch { /* le refus est déjà remonté par la couche réseau */ }
      return;
    }
    // Mode démo : on applique localement pour que l'écran reste cohérent.
    setRentalTarifs((e) => (e ? { ...e, tarif: { ...e.tarif, ...(patch.tarif as object ?? {}) } } : e));
  };
  const resetRentalTarifs = async () => {
    if (LIVE && !(await safePost('/admin/rental/tarifs/reset'))) return;
    void refresh();
  };
  const cancelSub = async (userId: string) => {
    if (LIVE && !(await safePost(`/admin/subscriptions/${userId}/resilier`, {}))) return;
    setSubscriptions((xs) => xs.map((x) => (x.userId === userId ? { ...x, active: false, cancelledAt: new Date().toISOString() } : x)));
  };

  // Programme VIP / Top Driver (priorité dispatch + commission réduite).
  const setVip = async (id: string, vip: boolean) => {
    if (LIVE && !(await safePost(`/admin/drivers/${id}/vip`, { vip }))) return;
    setQTop((xs) => xs.map((t) => (t.id === id ? { ...t, vip } : t)));
  };

  // Shadow mode : simulation d'une configuration hypothétique de dispatch.
  const simulate = async (patch: { maxEtaMinutes?: number; radiusMaxKm?: number }): Promise<{ current: SimResult; proposed: SimResult } | null> => {
    if (!LIVE) return DEMO.simulate(patch);
    try { return await adminPost<{ current: SimResult; proposed: SimResult }>('/admin/dispatch/simulate', patch); }
    catch { return null; }
  };

  /* --- S8 Équipes / RH : shifts, maintenance, micro-broadcast, P&L --- */
  const assignShift = async (input: { username: string; name: string; date: string; slot: string; zoneId?: string }) => {
    if (LIVE) { if (!(await safePut('/admin/shifts', input))) return; void refresh(); return; }
    setShifts((xs) => [...xs, { id: Math.random().toString(36).slice(2, 8), createdAt: new Date().toISOString(), ...input } as Shift]);
  };
  const removeShift = async (id: string) => {
    if (LIVE) await adminDel(`/admin/shifts/${id}`);
    setShifts((xs) => xs.filter((s) => s.id !== id));
  };
  const openMaintenance = async (input: { driverId: string; kind: string; title: string; teamId?: string }) => {
    if (LIVE) { if (!(await safePost('/admin/maintenance', input))) return; void refresh(); return; }
    setMaintenance((xs) => [{ id: Math.random().toString(36).slice(2, 8), status: 'ouvert', createdAt: new Date().toISOString(), ...input } as MaintenanceTicket, ...xs]);
  };
  const resolveMaintenance = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/maintenance/${id}/resolve`))) return;
    setMaintenance((xs) => xs.map((t) => (t.id === id ? { ...t, status: 'resolu' } : t)));
  };
  const microBroadcast = async (teamId: string, title: string, body: string) => {
    if (!LIVE) { avis(`Micro-broadcast envoyé à la flotte de l'équipe (démo).`); return; }
    try { const r = await adminPost<{ sent: number }>(`/admin/teams/${teamId}/broadcast`, { title, body }); avis(`${r.sent} chauffeur(s) de la flotte notifié(s).`); }
    catch { /* */ }
  };
  const loadSquadPnl = async (teamId: string): Promise<SquadPnl | null> => {
    if (!LIVE) return DEMO.squadPnl(teamId);
    try { return (await adminGet<{ pnl: SquadPnl }>(`/admin/teams/${teamId}/pnl`)).pnl; } catch { return null; }
  };

  /** Le chauffeur dépose lui-même sa demande ; elle part chez son chef d'équipe. */
  const deposerRequeteChauffeur = async (driverId: string, r: NouvelleRequete): Promise<boolean> => {
    if (!LIVE) return true;
    const res = await safePostData<{ requete: unknown }>(`/admin/crew/${driverId}/requetes`, r);
    if (!res) return false;
    void refresh();
    return true;
  };

  /* =============== Équipages : dossiers chauffeurs et requêtes =============== */
  const ouvrirChauffeur = async (driverId: string) => {
    setSection('crew');
    if (!LIVE) { setDossierCrew(DEMO.dossierCrew(driverId)); return; }
    try { setDossierCrew((await adminGet<{ dossier: DossierEquipage }>(`/admin/crew/${driverId}`)).dossier); }
    catch { setDossierCrew(null); }
  };
  const chercherEquipages = async (q: string) => {
    setCrewQ(q);
    if (!LIVE) return;
    try {
      const c = await adminGet<{ equipages: EquipageRow[]; total?: number; tableau: CrewTableau | null }>(`/admin/crew?q=${encodeURIComponent(q)}`);
      setEquipages(c.equipages); setEquipagesTotal(c.total ?? c.equipages.length); setCrewTableau(c.tableau);
    } catch { /* l'erreur est déjà remontée par adminGet */ }
  };
  /** Recharge le dossier ouvert après une action, pour que l'écran dise le vrai. */
  const rafraichirDossier = async () => {
    if (!LIVE || !dossierCrew) { void refresh(); return; }
    try { setDossierCrew((await adminGet<{ dossier: DossierEquipage }>(`/admin/crew/${dossierCrew.identite.driverId}`)).dossier); }
    catch { /* ignoré */ }
    void refresh();
  };
  const deposerRequete = async (driverId: string, p: Record<string, unknown>) => {
    if (!LIVE) { avis('Requête déposée (démo).'); return; }
    if (await safePost(`/admin/crew/${driverId}/requetes`, p)) void rafraichirDossier();
  };
  const instruireRequete = async (id: string, sens: 'favorable' | 'defavorable', note: string) => {
    if (!LIVE) { avis(`Avis ${sens} enregistré (démo).`); return; }
    if (await safePost(`/admin/crew/requetes/${id}/instruire`, { avis: sens, note: note || undefined })) void rafraichirDossier();
  };
  const deciderRequete = async (id: string, decision: 'accord' | 'refus', montantAccorde: number | undefined, note: string) => {
    if (!LIVE) { avis(`Requête ${decision === 'accord' ? 'accordée' : 'refusée'} (démo).`); return; }
    if (await safePost(`/admin/crew/requetes/${id}/decider`, { decision, montantAccorde, note: note || undefined })) void rafraichirDossier();
  };
  const verserRequete = async (id: string, canal: string) => {
    if (!LIVE) { avis('Versement enregistré (démo).'); return; }
    if (await safePost(`/admin/crew/requetes/${id}/verser`, { canal })) void rafraichirDossier();
  };
  const rembourserRequete = async (id: string, montant: number) => {
    if (!LIVE) { avis('Remboursement enregistré (démo).'); return; }
    if (await safePost(`/admin/crew/requetes/${id}/rembourser`, { montant })) void rafraichirDossier();
  };

  /* ====================== Annuaire du personnel ====================== */
  /** Le mot de passe provisoire ne s'affiche qu'une fois : on le montre clairement. */
  const annoncerMotDePasse = (nom: string, username: string, mdp: string) => {
    avis(`Accès créé pour ${nom}.\n\nIdentifiant : ${username}\nMot de passe provisoire : ${mdp}\n\nCommuniquez-le à l'intéressé : il ne sera plus affiché, et devra être changé à la première connexion.`);
  };
  const creerCompte = async (p: Record<string, unknown>) => {
    if (!LIVE) { avis('Compte créé (démo).'); return; }
    const r = await safePostData<{ account: StaffAccountRow; motDePasseProvisoire: string }>('/admin/accounts', p);
    if (r) { annoncerMotDePasse(r.account.name, r.account.username, r.motDePasseProvisoire); void refresh(); }
  };
  const creerAccesChauffeur = async (driverId: string, nom: string, matricule: string) => {
    if (!LIVE) { avis('Accès chauffeur créé (démo).'); return; }
    const r = await safePostData<{ account: StaffAccountRow; motDePasseProvisoire: string }>('/admin/accounts', { name: nom, role: 'chauffeur', driverId, matricule });
    if (r) { annoncerMotDePasse(nom, r.account.username, r.motDePasseProvisoire); void refresh(); }
  };
  const modifierCompte = async (username: string, p: Record<string, unknown>) => {
    if (!LIVE) { avis('Compte modifié (démo).'); return; }
    if (await safePut(`/admin/accounts/${username}`, p)) void refresh();
  };
  const reinitialiserCompte = async (username: string) => {
    if (!LIVE) { avis('Mot de passe réinitialisé (démo).'); return; }
    const r = await safePostData<{ account: StaffAccountRow; motDePasseProvisoire: string }>(`/admin/accounts/${username}/reset`, {});
    if (r) { annoncerMotDePasse(r.account.name, r.account.username, r.motDePasseProvisoire); void refresh(); }
  };
  const activerCompte = async (username: string, active: boolean) => {
    const reason = active ? undefined : await demander('Motif de la désactivation (départ, suspension…) :') ?? undefined;
    if (!active && !reason) return;
    if (!LIVE) { avis('Compte mis à jour (démo).'); return; }
    if (await safePost(`/admin/accounts/${username}/active`, { active, reason })) void refresh();
  };
  const changerMotDePasse = async (ancien: string, nouveau: string) => {
    if (!LIVE) { setMdpOuvert(false); avis('Mot de passe changé (démo).'); return; }
    if (await safePost('/admin/password', { ancien, nouveau })) {
      setMdpOuvert(false);
      avis('Mot de passe changé.');
      void refresh();
    }
  };

  /* ====================== Caisse nominative ====================== */
  const ouvrirCaisse = async (fondDeCaisse: number, emplacement: string) => {
    if (!LIVE) { avis('Caisse ouverte (démo).'); return; }
    if (await safePost('/admin/caisses', { fondDeCaisse, emplacement: emplacement || undefined })) void refresh();
  };
  const encaisser = async (id: string, p: Record<string, unknown>) => {
    if (!LIVE) { avis('Encaissement enregistré (démo).'); return; }
    if (await safePost(`/admin/caisses/${id}/encaisser`, p)) void refresh();
  };
  const decaisser = async (id: string, p: Record<string, unknown>) => {
    if (!LIVE) { avis('Sortie enregistrée (démo).'); return; }
    if (await safePost(`/admin/caisses/${id}/decaisser`, p)) void refresh();
  };
  const arreterCaisse = async (id: string, p: Record<string, unknown>) => {
    if (!LIVE) { avis('Caisse arrêtée (démo).'); return; }
    if (await safePost(`/admin/caisses/${id}/arreter`, p)) void refresh();
  };
  const validerCaisse = async (id: string) => {
    if (!LIVE) { avis('Arrêté validé (démo).'); return; }
    if (await safePost(`/admin/caisses/${id}/valider`, {})) void refresh();
  };

  /* ====================== Poste de travail d'équipe ====================== */
  const choisirEquipe = async (id: string) => {
    setEquipeSel(id);
    if (!LIVE) { setPosteEquipe(DEMO.posteEquipe(id)); return; }
    try { setPosteEquipe((await adminGet<{ poste: PosteEquipe }>(`/admin/teams/${id}/poste`)).poste); }
    catch { setPosteEquipe(null); }
  };
  const ecrireMembre = async (teamId: string, a: string, sujet: string, texte: string, urgent: boolean) => {
    if (!LIVE) { avis('Message envoyé (démo).'); return; }
    if (await safePost(`/admin/teams/${teamId}/messages`, { a, sujet: sujet || undefined, texte, urgent, reponseAttendue: true })) void choisirEquipe(teamId);
  };
  const demanderRapport = async (teamId: string, destinataire: string, titre: string, consigne: string, echeance: string) => {
    if (!LIVE) { avis('Rapport demandé (démo).'); return; }
    if (await safePost(`/admin/teams/${teamId}/rapports`, { destinataire, titre, consigne, echeance })) void choisirEquipe(teamId);
  };
  const statuerRapport = async (id: string, decision: 'accepte' | 'a_revoir', texte: string) => {
    if (!LIVE) { avis('Rapport traité (démo).'); return; }
    if (await safePost(`/admin/rapports/${id}/statuer`, { decision, texte: texte || undefined })) void choisirEquipe(equipeSel);
  };
  const lireMessage = async (id: string) => {
    if (!LIVE) return;
    if (await safePost(`/admin/messages/${id}/lu`, {})) void refresh();
  };
  const repondreMessage = async (id: string, texte: string) => {
    if (!LIVE) { avis('Réponse envoyée (démo).'); return; }
    if (await safePost(`/admin/messages/${id}/repondre`, { texte })) void refresh();
  };
  const rendreRapport = async (id: string, texte: string) => {
    if (!LIVE) { avis('Rapport rendu (démo).'); return; }
    if (await safePost(`/admin/rapports/${id}/rendre`, { texte })) void refresh();
  };

  /* ====================== Télématique de location ====================== */
  const rafraichirSuivi = async () => {
    if (!LIVE) { setSuiviFlotte(DEMO.suiviFlotte()); return; }
    try { setSuiviFlotte(await adminGet<SuiviFlotte>('/admin/rental/flotte/positions')); }
    catch { /* ignoré */ }
  };
  const declarerVol = async (reservationId: string, circonstances: string) => {
    if (!LIVE) { avis('Vol déclaré (démo).'); return; }
    if (await safePost(`/admin/rental/${reservationId}/vol`, { circonstances })) void rafraichirSuivi();
  };
  const immobiliser = async (vehiculeId: string, motif: string, commentaire: string, reservationId?: string) => {
    if (!LIVE) { avis('Coupure armée (démo).'); return; }
    const r = await safePostData<{ avertissement: string }>(`/admin/rental/vehicules/${vehiculeId}/immobiliser`, { motif, commentaire, reservationId });
    if (r) { avis(r.avertissement); void rafraichirSuivi(); }
  };
  const confirmerImmobilisation = async (id: string) => {
    if (!LIVE) { avis('Immobilisation confirmée (démo).'); return; }
    const r = await safePostData<{ avertissement: string }>(`/admin/rental/immobilisations/${id}/confirmer`, {});
    if (r) { avis(r.avertissement); void rafraichirSuivi(); }
  };
  const leverImmobilisation = async (id: string, motif: string) => {
    if (!LIVE) { avis('Immobilisation levée (démo).'); return; }
    if (await safePost(`/admin/rental/immobilisations/${id}/lever`, { motif })) void rafraichirSuivi();
  };
  const volTransmis = async (volId: string, a: string, reference: string) => {
    if (!LIVE) { avis('Transmission enregistrée (démo).'); return; }
    if (await safePost(`/admin/rental/vol/${volId}/transmis`, { a, referencePlainte: reference || undefined })) void rafraichirSuivi();
  };
  const cloreVol = async (volId: string, statut: 'retrouve' | 'clos', note: string) => {
    if (!LIVE) { avis('Dossier clos (démo).'); return; }
    if (await safePost(`/admin/rental/vol/${volId}/clore`, { statut, note: note || undefined })) void rafraichirSuivi();
  };
  const telechargerSignalement = (volId: string) => {
    if (!LIVE) { avis('Fiche de signalement (démo).'); return; }
    window.open(`${API}/admin/rental/vol/${volId}/signalement.pdf`, '_blank');
  };

  /* --- S9 IA : assistant ORION (moteur de questions sur les données réelles) --- */
  const askCopilot = async (q: string): Promise<CopilotAnswer | null> => {
    if (!LIVE) return DEMO.copilot(q);
    try { return await adminPost<CopilotAnswer>('/admin/copilot', { q }); } catch { return null; }
  };
  // La liste des sujets vient du serveur : codée en dur dans l'écran, elle finissait par
  // proposer des questions que le moteur ne savait plus traiter.
  const assistantSujets = useCallback(async (): Promise<AssistantSujet[]> => {
    if (!LIVE) return DEMO.assistantSujets();
    try { return (await adminGet<{ sujets: AssistantSujet[] }>('/admin/copilot/sujets')).sujets; } catch { return []; }
  }, []);

  /* --- S10 B2B : import de masse, web booker --- */
  const importMembers = async (id: string, memberIds: string[]) => {
    if (!LIVE) { avis(`${memberIds.length} collaborateur(s) importé(s) (démo).`); return; }
    try { const r = await adminPost<{ added: number }>(`/admin/corporate/${id}/members`, { memberIds }); avis(`${r.added} nouveau(x) collaborateur(s) rattaché(s).`); void refresh(); }
    catch { /* */ }
  };
  const webBook = async (id: string, input: { guestName: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; category: string }) => {
    if (!LIVE) { avis(`Course conciergerie réservée pour ${input.guestName} (démo). SMS de suivi GPS + plaque envoyé.`); return; }
    try { const r = await adminPost<{ booking: { amount: number } }>(`/admin/corporate/${id}/book`, input); avis(`Course réservée pour ${input.guestName} — ${fcfa(r.booking.amount)}. SMS de suivi envoyé.`); void refresh(); }
    catch { avis('Réservation refusée (politique entreprise ou crédit dépassé).'); }
  };

  /* --- S11 Litiges : escalade, quarantaine, notes --- */
  const escalateDispute = async (id: string, kind: string) => {
    if (LIVE) { try { await adminPost(`/admin/disputes/${id}/escalate`, { kind }); void refresh(); return; } catch { avis('Dossier déjà verrouillé par un autre expert.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, escalation: kind, lockedBy: me?.name, status: 'investigating' } : d)));
  };
  const quarantineDispute = async (id: string, on: boolean) => {
    if (LIVE) { if (!(await safePost(`/admin/disputes/${id}/quarantine`, { on }))) return; void refresh(); return; }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, quarantined: on } : d)));
  };
  const noteDispute = async (id: string, text: string) => {
    if (LIVE) { try { await adminPost(`/admin/disputes/${id}/note`, { text }); void refresh(); return; } catch { avis('Note réservée à l’expert gestionnaire.'); return; } }
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, notes: [...(d.notes ?? []), { author: me?.name ?? 'Expert', text, at: new Date().toISOString() }] } : d)));
  };

  /* --- S12 Chauffeur : suspension motivée, fidélité --- */
  const suspendDriver = async (id: string) => {
    const reason = await demander('Motif de suspension (obligatoire — trace légale) :', '');
    if (!reason?.trim()) return;
    if (LIVE) { if (!(await safePost(`/admin/drivers/${id}/kyc`, { status: 'suspended', reason: reason.trim() }))) return; void refresh(); return; }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, kycStatus: 'suspended', availability: 'offline', suspensionReason: reason.trim() } : d)));
  };
  const setLoyalty = async (id: string, tier: string) => {
    const pct = await demander('Commission personnalisée (%) — laisser vide pour aucune :', '10');
    const override = pct?.trim() ? Number(pct) / 100 : null;
    if (LIVE) { if (!(await safePost(`/admin/drivers/${id}/loyalty`, { loyaltyTier: tier, commissionOverride: override }))) return; void refresh(); return; }
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, loyaltyTier: tier } : d)));
  };

  /* --- S13 Client : VIP, blacklist, no-show --- */
  const setClientVip = async (id: string, tier: string, noSurgeLock: boolean) => {
    if (LIVE && !(await safePost(`/admin/clients/${id}/vip`, { vipTier: tier, noSurgeLock }))) return;
    avis(`Client ${id} → ${tier}${noSurgeLock ? ' · no-surge verrouillé' : ''}.`);
  };
  const blacklistClient = async (id: string) => {
    const imei = await demander('Liste noire — IMEI de l’appareil (bloque la réinscription) :', '');
    if (imei === null) return;
    if (LIVE && !(await safePost(`/admin/clients/${id}/blacklist`, { imei, reason: 'Bannissement manuel' }))) return;
    setClients((xs) => xs.map((c) => (c.id === id ? { ...c, status: 'blocked' } : c)));
    setClientSel((c) => (c && c.id === id ? { ...c, status: 'blocked' } : c));
  };
  const noShowFee = async (id: string) => {
    const fee = await demander('Frais de no-show à prélever (F CFA) — vérifiés au GPS :', '1000');
    if (!fee) return;
    if (LIVE && !(await safePost(`/admin/clients/${id}/noshow`, { fee: Number(fee) }))) return;
    avis(`Frais de no-show de ${fcfa(Number(fee))} prélevés sur ${id}.`);
  };

  /* --- S16 Tarification : shadow pricing --- */
  const shadowPricing = async (patch: { baseFactor: number; perKmFactor: number }): Promise<ShadowPricing | null> => {
    if (!LIVE) { const base = 1263500; const sim = Math.round(base * (0.5 * patch.baseFactor + 0.5 * patch.perKmFactor)); return { sampled: 60, realRevenue: base, simulatedRevenue: sim, impactPercent: Math.round(((sim - base) / base) * 1000) / 10 }; }
    try { return await adminPost<ShadowPricing>('/admin/pricing/shadow', patch); } catch { return null; }
  };

  /* --- S14 Finances : gateways, notes de frais --- */
  const toggleGateway = async (method: string, enabled: boolean) => {
    if (LIVE && !(await safePost('/admin/finance/gateways', { method, enabled }))) return;
    setGateways((xs) => xs.map((g) => (g.method === method ? { ...g, enabled } : g)));
  };
  const decideExpense = async (id: string, decision: 'approve' | 'reject' | 'info') => {
    if (LIVE) { if (!(await safePost(`/admin/expenses/${id}/decide`, { decision }))) return; void refresh(); return; }
    setExpenses((xs) => xs.map((t) => (t.id === id ? { ...t, status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'info_requested', credited: decision === 'approve' } : t)));
  };
  const newExpense = async () => {
    const amount = await demander('Montant de l’avance demandée (F CFA) :', '50000');
    if (!amount) return;
    const description = await demander('Justification :', 'Campagne marketing terrain');
    if (!description) return;
    if (LIVE) { try { await adminPost('/admin/expenses', { amount: Number(amount), category: 'marketing', neededDate: new Date().toISOString(), description }); void refresh(); return; } catch { avis('Compte gelé (justificatif en retard) ou non autorisé.'); return; } }
    setExpenses((xs) => [{ id: Math.random().toString(36).slice(2, 8), requesterType: 'employee', requesterId: me?.name ?? 'moi', requesterName: me?.name ?? 'Moi', amount: Number(amount), category: 'marketing', neededDate: new Date().toISOString(), description, status: 'pending', createdAt: new Date().toISOString() }, ...xs]);
  };

  /** Télécharge un CSV : via l'API (avec session JWT) ou généré localement (démo). */
  const downloadCsv = async (path: string, filename: string, local: () => string) => {
    let content: string;
    if (LIVE) {
      try {
        const res = await fetch(API + path, { headers: H(), credentials: 'include' });
        if (res.status === 401) { onUnauthorized(); return; }
        // Sans ce contrôle, un refus (403) écrivait le corps d'erreur JSON DANS le
        // fichier : l'employé repartait avec un export corrompu au lieu de voir le refus.
        if (!res.ok) { await reportResponse(res); return; }
        content = await res.text();
      } catch (e) {
        if (e instanceof AdminError) return; // déjà signalé
        content = local();                   // réseau coupé : export local de secours
      }
    } else {
      content = local();
    }
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };

  const exportCsv = () => void downloadCsv('/admin/rides.csv', 'orion-courses.csv', () => {
    const head = 'id,client,status,amount';
    return [head, ...rides.map((r) => `${r.id},${r.clientId},${r.status},${r.amount}`)].join('\n');
  });

  const exportTreasuryCsv = () => void downloadCsv('/admin/treasury.csv', 'orion-tresorerie.csv', () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = 'reference,montant,devise,destination,motif,demande_par,statut,decide_par,cree_le';
    return [head, ...transfers.map((t) => [t.id, t.amount, t.currency, t.destination, t.reason, t.requestedBy, t.status, t.decidedBy, t.createdAt].map(esc).join(','))].join('\n');
  });

  const driverAction = async (id: string, kind: 'kyc' | 'availability', value: string) => {
    if (LIVE && !(await safePost(`/admin/drivers/${id}/${kind}`, kind === 'kyc' ? { status: value } : { availability: value }))) return;
    setDrivers((xs) => xs.map((d) => (d.id === id ? { ...d, ...(kind === 'kyc' ? { kycStatus: value, availability: value === 'suspended' ? 'offline' : d.availability } : { availability: value }) } : d)));
  };

  const openDriver = async (id: string) => {
    if (!LIVE) { setDriverSel(DEMO.driverDetail(id, drivers)); return; }
    try { setDriverSel((await adminGet<{ driver: DriverDetail }>(`/admin/drivers/${id}`)).driver); }
    catch { setDriverSel(DEMO.driverDetail(id, drivers)); }
  };
  const openClient = async (id: string) => {
    if (!LIVE) { setClientSel(DEMO.clientDetail(id, clients)); return; }
    try { setClientSel((await adminGet<{ client: ClientDetail }>(`/admin/clients/${id}`)).client); }
    catch { setClientSel(DEMO.clientDetail(id, clients)); }
  };

  // --- Trésorerie (double validation) ---
  const requestTransfer = async (input: { amount: number; destination: string; reason: string }) => {
    if (!LIVE) {
      const local: Transfer = { id: Math.random().toString(36).slice(2, 10), currency: 'XOF', status: 'pending', requestedBy: me?.name ?? 'CFO', requestedRole: me?.role ?? 'cfo', createdAt: new Date().toISOString(), ...input };
      setTransfers((xs) => [local, ...xs]); return;
    }
    try { const { transfer } = await adminPost<{ transfer: Transfer }>('/admin/treasury/request', input); setTransfers((xs) => [transfer, ...xs]); } catch { /* */ }
  };
  const decideTransfer = async (id: string, action: 'approve' | 'reject', note?: string) => {
    if (!LIVE) {
      setTransfers((xs) => xs.map((x) => (x.id === id && x.status === 'pending'
        ? { ...x, status: action === 'approve' ? 'approved' : 'rejected', decidedBy: me?.name, decisionNote: note, decidedAt: new Date().toISOString(), executedAt: action === 'approve' ? new Date().toISOString() : undefined }
        : x)));
      return;
    }
    try {
      const { transfer } = await adminPost<{ transfer: Transfer }>(`/admin/treasury/${id}/${action}`, note ? { note } : {});
      setTransfers((xs) => xs.map((x) => (x.id === transfer.id ? transfer : x)));
    } catch { /* séparation des tâches ou déjà décidé : on rafraîchit */ void refresh(); }
  };

  // --- Recherche globale ---
  const runSearch = async (q: string): Promise<SearchResults> => {
    if (!LIVE) return DEMO.search(q);
    try { return await adminGet<SearchResults>(`/admin/search?q=${encodeURIComponent(q)}`); }
    catch { return { drivers: [], clients: [], rides: [] }; }
  };

  const toggleMute = () => {
    setMuted((m) => { localStorage.setItem('orion.admin.muted', m ? '0' : '1'); return !m; });
  };

  const toggleTheme = () => {
    setTheme((t) => {
      const next: AdmTheme = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem(themeKey, next); applyTheme(next);
      return next;
    });
  };

  // Dispatch & qualité (règles d'attribution + seuil de notes).
  const saveOps = async (patch: Partial<OpsConfig>) => {
    if (!LIVE) { setOps((o) => (o ? { ...o, ...patch } : o)); setQuality((q) => (q ? { ...q, threshold: patch.minRating ?? q.threshold, autoWarn: patch.autoWarn ?? q.autoWarn } : q)); return; }
    try { const { ops: next } = await adminPut<{ ops: OpsConfig }>('/admin/dispatch', patch); setOps(next); } catch { /* */ }
  };

  const warnDriver = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/drivers/${id}/warn`))) return;
    setQuality((q) => (q ? { ...q, drivers: q.drivers.map((d) => (d.id === id ? { ...d, warnings: d.warnings + 1 } : d)) } : q));
  };

  // Réassignation manuelle d'une course (auto : re-matching selon la règle courante).
  const reassignRide = async (id: string) => {
    if (!LIVE) { setRides((xs) => xs.map((r) => (r.id === id ? { ...r, driverName: 'Serge Aka', matricule: 'ORION-CI-4820', status: 'accepted' } : r))); return; }
    try { await adminPost(`/admin/rides/${id}/reassign`); void refresh(); } catch { /* aucun chauffeur dispo */ }
  };

  // Instruction d'un litige : fiche complète de la course (tracé GPS + tarif).
  const openForensic = async (rideId: string) => {
    if (!LIVE) { setForensic(DEMO.rideForensic(rideId)); return; }
    try { setForensic(await adminGet<RideForensic>(`/admin/rides/${rideId}`)); }
    catch { setForensic(DEMO.rideForensic(rideId)); }
  };

  const decideDispute = async (id: string, status: 'investigating' | 'resolved' | 'rejected', resolution?: string, refund?: number) => {
    if (LIVE && !(await safePost(`/admin/disputes/${id}/status`, { status, resolution, refund }))) return;
    setDisputes((xs) => xs.map((d) => (d.id === id ? { ...d, status, resolution: resolution ?? d.resolution, refund: refund ?? d.refund, decidedBy: me?.name, decidedAt: new Date().toISOString() } : d)));
  };

  // Équipes : création/mise à jour + affectation de flotte.
  const saveTeam = async (input: { id?: string; name: string; managerUsername: string; managerName?: string; driverIds?: string[] }) => {
    if (!LIVE) {
      const id = input.id ?? Math.random().toString(36).slice(2, 10);
      const detail = (input.driverIds ?? []).map((did) => drivers.find((d) => d.id === did)).filter(Boolean)
        .map((d) => ({ id: d!.id, name: d!.name, matricule: d!.matricule, availability: d!.availability, rating: d!.rating }));
      setTeams((xs) => {
        const next: Team = { id, name: input.name, managerUsername: input.managerUsername, managerName: input.managerName, driverIds: input.driverIds ?? [], createdAt: new Date().toISOString(), drivers: detail };
        return xs.some((t) => t.id === id) ? xs.map((t) => (t.id === id ? next : t)) : [...xs, next];
      });
      return;
    }
    try { await adminPut('/admin/teams', input); void refresh(); } catch { /* */ }
  };
  const deleteTeam = async (id: string) => {
    if (LIVE) await adminDel(`/admin/teams/${id}`);
    setTeams((xs) => xs.filter((t) => t.id !== id));
  };

  // B2B : comptes entreprises (ligne de crédit, facture, règlement).
  const saveCorporate = async (input: { id?: string; name: string; contactEmail?: string; creditLimit: number }) => {
    if (!LIVE) {
      const id = input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setCorporate((xs) => {
        const ex = xs.find((a) => a.id === id);
        const next: CorporateAccount = { id, name: input.name, contactEmail: input.contactEmail, creditLimit: input.creditLimit, balanceUsed: ex?.balanceUsed ?? 0, active: true, createdAt: ex?.createdAt ?? new Date().toISOString() };
        return ex ? xs.map((a) => (a.id === id ? next : a)) : [...xs, next];
      });
      return;
    }
    try { await adminPut('/admin/corporate', input); void refresh(); } catch { /* */ }
  };
  const settleCorporate = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/corporate/${id}/settle`))) return;
    setCorporate((xs) => xs.map((a) => (a.id === id ? { ...a, balanceUsed: 0 } : a)));
  };
  const exportInvoice = (id: string) => void downloadCsv(`/admin/corporate/${id}/invoice`, `facture-${id}.csv`, () => {
    const acc = corporate.find((a) => a.id === id);
    return `"Facture ORION — ${acc?.name ?? id}"\ncourse,date,client,statut,montant_fcfa\n"TOTAL",,,,"${acc?.balanceUsed ?? 0}"`;
  });

  // Bilan carbone PDF (via session JWT).
  const downloadCarbonPdf = async () => {
    if (!LIVE) { avis('Disponible avec le backend connecté — le PDF est généré côté serveur.'); return; }
    try {
      const res = await fetch(`${API}/admin/green/report.pdf`, { headers: H(), credentials: 'include' });
      if (res.status === 401) { onUnauthorized(); return; }
      // Sans ce contrôle, un refus téléchargeait le corps d'erreur JSON en guise de PDF.
      if (!res.ok) { await reportResponse(res); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'orion-bilan-carbone.pdf'; a.click(); URL.revokeObjectURL(url);
    } catch { setNotice('Bilan carbone indisponible : serveur injoignable.'); }
  };

  // Campagne de réengagement (churn) → diffusion clients avec code promo.
  const reengage = () => void sendBroadcast({
    audience: 'clients',
    title: 'Tu nous manques',
    body: 'Reviens rouler vert avec ORION : -20 % sur ta prochaine course avec le code RETOUR20.',
  });

  // Révoque une session (l'employé est déconnecté immédiatement).
  const revokeSess = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/sessions/${id}/revoke`))) return;
    setSessions((xs) => xs.map((s) => (s.id === id ? { ...s, revoked: true } : s)));
    if (id === selfSession) { void logout().then(() => window.location.reload()); } // on s'est déconnecté soi-même
  };

  // Révoque un appareil enrôlé : il perd l'accès dès sa requête suivante.
  const revoquerAppareil = async (id: string) => {
    if (LIVE && !(await safePost(`/admin/appareils/${id}/revoquer`))) return;
    setAppareils((a) => (a ? { ...a, appareils: a.appareils.map((x) => (x.id === id ? { ...x, actif: false, revoqueLe: new Date().toISOString() } : x)) } : a));
  };

  // On n'attend la vue d'ensemble que si l'on a le droit de la lire : un chauffeur
  // restait sinon indéfiniment sur cet écran.
  if (!me || (!ov && me.permissions.includes('overview:read'))) return <div className="adm-loading">Chargement de la console…</div>;

  const can = (p: string) => me.permissions.includes(p);
  const openAlerts = alerts.filter((a) => a.status !== 'resolved' && a.status !== 'cancelled');

  return (
    <div className={`adm-shell${menuOuvert ? ' menu-ouvert' : ''}`}>
      <button type="button" className="adm-voile" aria-label="Fermer le menu" tabIndex={menuOuvert ? 0 : -1} onClick={() => setMenuOuvert(false)} />
      <aside className="adm-side" id="adm-menu">
        <div className="adm-brand">
          <LogoApp size={40} className="adm-logo-volume" />
          <div><strong>ORION</strong><span className="adm-sub">Centre de contrôle</span></div>
        </div>
        <nav className="adm-nav">
          {NAV.map((n) => {
            const allowed = n.perm === '' || can(n.perm);
            // Un chauffeur ne voit que son espace : lui montrer trente sessions
            // cadenassées n'apprend rien d'utile et expose l'organisation interne.
            if (!allowed && me.role === 'chauffeur') return null;
            return (
              <button
                key={n.id}
                className={`adm-navi${section === n.id ? ' on' : ''}${allowed ? '' : ' locked'}`}
                title={allowed ? undefined : 'Session non autorisée pour votre rôle'}
                onClick={() => { setMenuOuvert(false); if (allowed) setSection(n.id); else void openLocked(n.id, n.label); }}
              >
                <span className="adm-navi-ico" aria-hidden="true"><Objet nom={OBJET_SESSION[n.id]} taille={24} /></span> {n.label}
                {allowed && n.id === 'alerts' && openAlerts.length > 0 && <span className="adm-navi-badge">{openAlerts.length}</span>}
                {allowed && n.id === 'security' && security.length > 0 && <span className="adm-navi-badge">{security.length}</span>}
                {!allowed && <span className="adm-navi-lock" aria-hidden><IconLock size={14} strokeWidth={1.5} /></span>}
              </button>
            );
          })}
        </nav>
        <div className="adm-side-foot">
          <div className="adm-role"><span className="adm-role-dot" /> {me.roleLabel}</div>
          <div className="adm-me">{me.name}</div>
          <button className="adm-btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={onLogout}>Déconnexion</button>
        </div>
      </aside>

      <main className="adm-main">
        {alarmeSos && (
          <div className={`adm-alarme lvl-${alarmeSos.level}`} role="alert">
            <span className="adm-alarme-dot" />
            <strong>{ALARME_LIBELLE[alarmeSos.kind] ?? 'NOUVELLE ALERTE'}</strong>
            {alarmeSos.nouvelles > 1 && <span className="adm-alarme-nb">{alarmeSos.nouvelles} alertes reçues</span>}
            <span>{alarmeSos.zone ?? 'Zone inconnue'} · reçue il y a {Math.max(0, Math.round((now.getTime() - Date.parse(alarmeSos.at)) / 1000))} s</span>
            <span className="grow" />
            <button className="adm-btn xs solid" onClick={() => { setSection('alerts'); void openSos(alarmeSos.id); setAlarmeSos(null); }}>Ouvrir le dossier</button>
            <button className="adm-btn xs ghost" onClick={() => setAlarmeSos(null)} aria-label="Masquer">✕</button>
          </div>
        )}
        <header className="adm-mhead">
          <button type="button" className="adm-menu-btn" aria-label="Ouvrir le menu des sessions" aria-controls="adm-menu" aria-expanded={menuOuvert} onClick={() => setMenuOuvert(true)}><IconMenu size={20} strokeWidth={1.5} /></button>
          <h2><span className="adm-titre-objet" aria-hidden="true"><Objet nom={OBJET_SESSION[section]} taille={34} /></span>{NAV.find((n) => n.id === section)?.label}</h2>
          {can('search:read') && (
            <GlobalSearch
              onSearch={runSearch}
              onOpenDriver={(id) => void openDriver(id)}
              onOpenClient={(id) => void openClient(id)}
              onOpenRide={() => setSection('rides')}
            />
          )}
          <div className="adm-top-right">
            {/* Tableau de bord : de droit pour la direction, la trésorerie, la comptabilité et
                l'informatique ; un manager le voit aussi, pour pouvoir y demander l'accès. */}
            {(can('dashboard:read') || me.role === 'manager' || me.role === 'fleet_manager') && (
              <a className="adm-btn ghost" href="./dashboard.html" target="_blank" rel="noopener" title={can('dashboard:read') ? 'Ouvrir le tableau de bord en direct (écran à part)' : 'Accès sur habilitation de la direction : demande possible depuis cet écran'} aria-label="Tableau de bord"><span className="adm-lbl"> Tableau de bord</span>{can('dashboard:read') ? '' : ''}</a>
            )}
            <button className="adm-btn ghost adm-mute" title={theme === 'dark' ? 'Passer en mode jour' : 'Passer en mode nuit'} onClick={toggleTheme}>
              {theme === 'dark' ? <IconSun size={18} strokeWidth={1.5} /> : <IconMoon size={18} strokeWidth={1.5} />}
            </button>
            <button className={`adm-btn ghost adm-mute${muted ? ' off' : ''}`} title={muted ? 'Réactiver la sirène SAMU' : 'Couper la sirène SAMU'} onClick={toggleMute}>
              {muted ? <IconBellOff size={18} strokeWidth={1.5} /> : <IconBell size={18} strokeWidth={1.5} />}
            </button>
            <span className={`adm-live ${live ? 'on' : 'demo'}`} title={surServeurDeSecours() ? 'Le serveur principal ne répond pas : la console travaille sur un serveur de secours.' : undefined}>
              {live ? (surServeurDeSecours() ? '● En direct · secours' : '● En direct') : '● Mode démo'}
            </span>
            <span className="adm-clock">{now.toLocaleTimeString('fr-FR')}</span>
            <button className="adm-btn ghost" onClick={() => void refresh()} aria-label="Rafraîchir"><span className="adm-ico-seul" aria-hidden>⟳</span><span className="adm-lbl">Rafraîchir</span></button>
          </div>
        </header>

        {section === 'direction' && (
          <DirectionSection
            board={board} livre={livre} jours={execJours} canAct={can('treasury:approve')}
            onJours={(j) => { setExecJours(j); setLivrePage(1); }}
            onAller={(s) => setSection(s as Section)}
            onPageLivre={setLivrePage}
            onFiltreLivre={(f) => { setLivreFiltre(f); setLivrePage(1); }}
            onExportCsv={() => void downloadCsv(`/admin/executive/livre.csv?days=${execJours}`, 'orion-grand-livre.csv', () => 'date;sens;categorie;libelle;montant_fcfa;en_caisse;contrepartie;reference;statut')}
            onRapportPdf={() => void downloadFile(`/admin/executive/rapport.pdf?days=${execJours}`, 'orion-rapport-executif.pdf')}
          />
        )}
        {section === 'direction' && <ObjectifsFinanciersCarte peutModifier={can('finance:write')} />}
        {section === 'monPoste' && (
          <MonPosteSection
            poste={monPoste}
            onAller={(s) => setSection(s as Section)}
            onLireMessage={lireMessage}
            onRepondre={repondreMessage}
            onRendreRapport={rendreRapport}
            onOuvrirChauffeur={ouvrirChauffeur}
            onChangerMotDePasse={() => setMdpOuvert(true)}
            onDeposerRequete={deposerRequeteChauffeur}
          />
        )}
        {section === 'crew' && (
          <EquipagesSection
            lignes={equipages}
            total={equipagesTotal}
            tableau={crewTableau}
            dossier={dossierCrew}
            onOuvrir={ouvrirChauffeur}
            onFermer={() => setDossierCrew(null)}
            onRechercher={chercherEquipages}
            onContact={contacter}
            onDeposer={deposerRequete}
            onInstruire={instruireRequete}
            onDecider={deciderRequete}
            onVerser={verserRequete}
            onRembourser={rembourserRequete}
            onCreerAcces={creerAccesChauffeur}
            droits={{
              instruire: can('crew:write'),
              decider: can('finance:write'),
              verser: can('caisse:write'),
              comptes: can('accounts:write'),
            }}
          />
        )}
        {section === 'caisses' && (
          <CaisseSection
            maCaisse={maCaisse}
            caisses={caisses}
            consolidation={caisseConso}
            referentiel={caisseRef}
            peutTenir={can('caisse:write')}
            peutValider={can('finance:write')}
            onOuvrir={ouvrirCaisse}
            onEncaisser={encaisser}
            onDecaisser={decaisser}
            onArreter={arreterCaisse}
            onValider={validerCaisse}
            onVoir={(id) => { const c = caisses.find((x) => x.id === id); if (c) setMaCaisse(c); }}
          />
        )}
        {section === 'posteEquipe' && (
          <PosteEquipeSection
            poste={posteEquipe}
            equipes={teams.map((t) => ({ id: t.id, name: t.name }))}
            equipeId={equipeSel}
            onChoisir={choisirEquipe}
            onContact={contacter}
            onEcrire={ecrireMembre}
            onDemanderRapport={demanderRapport}
            onStatuerRapport={statuerRapport}
            onOuvrirChauffeur={ouvrirChauffeur}
          />
        )}
        {section === 'telematique' && (
          <TelematiqueSection
            suivi={suiviFlotte}
            onRafraichir={rafraichirSuivi}
            onDeclarerVol={declarerVol}
            onImmobiliser={immobiliser}
            onConfirmer={confirmerImmobilisation}
            onLever={leverImmobilisation}
            onTransmis={volTransmis}
            onClore={cloreVol}
            onSignalement={telechargerSignalement}
            peutAgir={can('rental:write')}
          />
        )}
        {section === 'comptes' && (
          <AnnuaireSection
            comptes={comptes}
            stats={comptesStats}
            roles={rolesDispo}
            delegables={me?.role === 'manager' ? delegables : []}
            equipes={teams.map((t) => ({ id: t.id, name: t.name }))}
            peutEcrire={can('accounts:write')}
            onCreer={creerCompte}
            onModifier={modifierCompte}
            onReinitialiser={reinitialiserCompte}
            onActiver={activerCompte}
            onContact={contacter}
          />
        )}
        {section === 'vigilance' && (
          <VigilanceSection
            sante={vigilance}
            onAller={(s) => setSection(s as Section)}
            onRafraichir={() => void refresh()}
            onRapportPdf={() => void downloadFile('/admin/vigilance/rapport.pdf', 'orion-rapport-controle.pdf')}
          />
        )}
        {section === 'overview' && ov && <OverviewSection ov={ov} fleet={fleet} openAlerts={openAlerts} stats={stats} statsDays={statsDays} onStatsDays={setStatsDays} onAlerte={can('alerts:read') ? openSos : undefined} />}
        {section === 'alerts' && (
          <SamuSection
            alerts={alerts} fleet={fleet} openAlerts={openAlerts} canWrite={can('alerts:write')}
            contacts={contacts} onClaim={claimSos} onOpen={openSos}
            onSaveContact={(c) => void saveContact(c)} onDeleteContact={(id) => void deleteContact(id)}
          />
        )}
        {section === 'support' && <SupportSection convs={support} stats={supportStats} macros={macros} canWrite={can('support:write')} canPromo={can('promos:write')} clients={clients} onReply={supportReply} onStatus={supportSetStatus} onCompensate={compensate} onContact={(p) => void contacter(p)} />}
        {section === 'rides' && (
          <>
            <RidesSection rides={rides} meta={ridesMeta} onPage={setRidesPage} canWrite={can('rides:write')} onReassign={reassignRide} onOpen={openForensic} onForce={forceRide} onDest={changeDestination} onContact={(p) => void contacter(p)} />
            <ReservationsCard reservations={reservations} canWrite={can('rides:write')} onAssign={assignReservation} onCancel={cancelReservation} />
          </>
        )}
        {section === 'dispatch' && ops && <DispatchSection ops={ops} onSave={saveOps} onSimulate={simulate} onConfigPdf={() => void downloadFile('/admin/dispatch/config.pdf', 'orion-config-dispatch.pdf')} onMatrixCsv={() => void downloadFile('/admin/pricing/matrix.csv', 'orion-matrice-tarifaire.csv')} />}
        {section === 'quality' && quality && <QualitySection q={quality} csat={csat} top={qTop} canWrite={can('drivers:write')} onWarn={warnDriver} onSuspend={(id) => driverAction(id, 'kyc', 'suspended')} onSaveOps={saveOps} onVip={setVip} onMatrixCsv={() => void downloadFile('/admin/quality.csv', 'orion-matrice-qualite.csv')} onDriverPdf={(id) => void downloadFile(`/admin/drivers/${id}/quality.pdf`, `orion-qualite-${id.slice(0, 8)}.pdf`)} />}
        {section === 'disputes' && <DisputesSection disputes={disputes} clients={clients} canWrite={can('support:write')} onContact={(p) => void contacter(p)} onDecide={decideDispute} onOpenRide={openForensic} onEscalate={escalateDispute} onQuarantine={quarantineDispute} onNote={noteDispute} onChargeback={(id) => void downloadFile(`/admin/disputes/${id}/chargeback.pdf`, `orion-chargeback-${id}.pdf`)} onDossier={(id) => void downloadFile(`/admin/disputes/${id}/dossier.pdf`, `orion-dossier-${id}.pdf`)} onLossCsv={() => void downloadCsv('/admin/disputes.csv', 'orion-pertes.csv', () => 'dossier,categorie,statut')} />}
        {section === 'green' && green && <GreenSection g={green} ops={ops} onPdf={() => void downloadCarbonPdf()} onEnergyCsv={() => void downloadCsv('/admin/green/energy.csv', 'orion-energie.csv', () => 'matricule,nom,motorisation,km_factures,kwh_estimes')} />}
        {section === 'teams' && <TeamsSection teams={teams} allDrivers={drivers} staffKpis={staffKpis} shifts={shifts} maintenance={maintenance} canWrite={can('teams:write')} onSave={saveTeam} onDelete={deleteTeam} onShift={assignShift} onRemoveShift={removeShift} onMaintenance={openMaintenance} onResolveMaintenance={resolveMaintenance} onBroadcast={microBroadcast} onPnl={loadSquadPnl} onHoursCsv={() => void downloadCsv('/admin/staff/hours.csv', 'orion-heures.csv', () => 'employe,identifiant,date,tranche,zone')} onEvalPdf={(u) => void downloadFile(`/admin/staff/${u}/eval.pdf`, `orion-eval-${u}.pdf`)} onContact={(p) => void contacter(p)} />}
        {section === 'intel' && <IntelSection predict={predict} conversion={conversion} churn={churn} fraud={fraud} elasticity={elasticity} canNotify={can('notify:write')} onReengage={reengage} onCopilot={askCopilot} onSujets={assistantSujets} onAller={(sec) => setSection(sec as Section)} />}
        {section === 'b2b' && <CorporateSection accounts={corporate} canWrite={can('treasury:request')} canSettle={can('treasury:approve')} canBook={can('rides:write')} onSave={saveCorporate} onSettle={settleCorporate} onInvoice={exportInvoice} onEsg={(id) => void downloadFile(`/admin/corporate/${id}/esg.pdf`, `orion-esg-${id}.pdf`)} onInvoicePdf={(id) => void downloadFile(`/admin/corporate/${id}/invoice.pdf`, `facture-${id}.pdf`)} onImport={importMembers} onBook={webBook} onContact={(p) => void contacter(p)} />}
        {section === 'drivers' && <DriversSection drivers={drivers} expiring={expiring} canWrite={can('drivers:write')} onAction={driverAction} onSuspend={suspendDriver} onLoyalty={setLoyalty} onOpen={openDriver} meta={driversMeta} onPage={setDriversPage} onContract={(id) => void downloadFile(`/admin/drivers/${id}/contract.pdf`, `orion-contrat-${id.slice(0, 8)}.pdf`)} onFleetCsv={() => void downloadCsv('/admin/fleet.csv', 'orion-flotte.csv', () => 'matricule,nom,motorisation')} onContact={(p) => void contacter(p)} />}
        {section === 'clients' && <ClientsSection clients={clients} canWrite={can('clients:write')} onStatus={setClientStatus} onOpen={openClient} meta={clientsMeta} onPage={setClientsPage} onVip={setClientVip} onBlacklist={blacklistClient} onNoShow={noShowFee} onLtvCsv={() => void downloadCsv('/admin/clients.csv', 'orion-clients-ltv.csv', () => 'client,nom')} onBehaviorPdf={() => void downloadFile('/admin/clients/behavior.pdf', 'orion-comportement-clients.pdf')} onContact={(p) => void contacter(p)} />}
        {section === 'messagesClients' && <MessagesClientsSection canWrite={can('notify:write')} canControle={can('alerts:write')} rides={rides} onAlerte={() => setSection('alerts')} />}
        {section === 'notify' && <NotifySection broadcasts={broadcasts} triggers={triggers} canWrite={can('notify:write')} onSend={sendBroadcast} onTrigger={runTrigger} />}
        {section === 'finance' && finance && <FinanceSection finance={finance} ops={ops} cashDebt={cashDebt} gateways={gateways} expenses={expenses} onExport={exportCsv} canExport={can('rides:read')} canWrite={can('pricing:write')} canGateway={can('services:write')} canApprove={can('treasury:request')} onSaveOps={saveOps} onToggleGateway={toggleGateway} onDecideExpense={decideExpense} onNewExpense={newExpense} onPayouts={() => void downloadCsv('/admin/payouts.csv', 'orion-payouts.csv', () => 'matricule,nom,solde')} />}
        {section === 'treasury' && <TreasurySection transfers={transfers} meName={me.name} liquidity={liquidity} amortization={amortization} canRequest={can('treasury:request')} canApprove={can('treasury:approve')} onRequest={requestTransfer} onDecide={decideTransfer} onExport={exportTreasuryCsv} onReportPdf={() => void downloadFile('/admin/treasury/report.pdf', 'orion-tresorerie-executif.pdf')} />}
        {section === 'pricing' && pricing && <PricingEditor pricing={pricing} canWrite={can('pricing:write')} onSave={savePricing} onShadow={shadowPricing} onMatrixCsv={() => void downloadCsv('/admin/pricing/matrix.csv', 'orion-matrice-tarifaire.csv', () => 'zone,facteur_zone')} />}
        {section === 'zones' && <ZonesSection zones={zones} canWrite={can('pricing:write')} onSave={saveZone} onToggle={toggleZone} onDelete={deleteZone} onReset={resetZones} onMatrixCsv={() => void downloadCsv('/admin/zones/matrix.csv', 'orion-matrice-zones.csv', () => 'zone_depart,zone_arrivee,forfait_fcfa')} />}
        {section === 'promos' && <PromosSection promos={promos} canWrite={can('promos:write')} onSave={savePromo} onToggle={togglePromo} onDelete={deletePromo} />}
        {section === 'services' && services && <ServicesSection config={services} canWrite={can('services:write')} onSave={saveServices} />}
        {section === 'rental' && (
          <RentalSection
            reservations={rentals} fleet={prestige} stats={rentalStats} dispos={rentalDispos} drivers={drivers}
            canWrite={can('rental:write')}
            onAssign={assignRental} onStatus={setRentalStatus} onCancel={cancelRental} onContact={(p) => void contacter(p)}
            onBon={(id) => void downloadFile(`/admin/rental/${id}/bon.pdf`, `orion-location-${id}.pdf`)}
          />
        )}
        {section === 'rentalTarifs' && (
          <RentalTarifsSection etat={rentalTarifs} canWrite={can('rental:write')} onSave={saveRentalTarifs} onReset={resetRentalTarifs} />
        )}
        {section === 'subscriptions' && (
          <SubscriptionsSection
            plans={subPlans} subscriptions={subscriptions} invoices={subInvoices} stats={subStats}
            canWrite={can('rental:write')} clients={clients} onContact={(p) => void contacter(p)}
            onPayInvoice={paySubInvoice} onEcheances={runEcheances} onResilier={cancelSub}
          />
        )}
        {section === 'audit' && <AuditSection entries={audit} />}
        {section === 'sessions' && <SessionsSection sessions={sessions} self={selfSession} canWrite={can('sessions:write')} onRevoke={revokeSess} />}
        {section === 'sessions' && appareils && <AppareilsPanneau etat={appareils} canWrite={can('sessions:write')} onRevoquer={(id) => void revoquerAppareil(id)} />}
        {section === 'security' && <SecuritySection attempts={security} />}
        {section === 'roles' && <RolesSection me={me} />}
        {section === 'habilitations' && <HabilitationsSection can={can} />}
      </main>

      {driverSel && <DriverDrawer d={driverSel} onClose={() => setDriverSel(null)} />}
      {(mdpOuvert || me?.mustChangePassword) && (
        <ChangerMotDePasse
          obligatoire={Boolean(me?.mustChangePassword)}
          onChanger={changerMotDePasse}
          onFermer={() => setMdpOuvert(false)}
        />
      )}
      {clientSel && <ClientDrawer c={clientSel} onClose={() => setClientSel(null)} onOpenSupport={() => { setClientSel(null); setSection('support'); }} />}
      {forensic && <ForensicDrawer f={forensic} onClose={() => setForensic(null)} />}
      {sosSel && (
        <SosDrawer
          d={sosSel}
          canWrite={can('alerts:write')}
          onClose={() => setSosSel(null)}
          onMessage={sosMessage}
          onCloseAlert={closeSos}
          onPdf={(id) => void downloadFile(`/admin/sos/${id}/report.pdf`, `orion-requisition-${id.slice(0, 8)}.pdf`)}
          onCsv={(id) => void downloadFile(`/admin/sos/${id}/telemetry.csv`, `orion-telemetrie-${id.slice(0, 8)}.csv`)}
          onContact={(id, p) => void sosContact(id, p)}
          onIssue={(id, e, i, c) => void sosContactIssue(id, e, i, c)}
          onDemandeFaite={(id, cle) => void sosDemandeFaite(id, cle)}
        />
      )}
      {denied && (
        <div className="adm-denied-wrap" onClick={() => setDenied(null)}>
          <div className="adm-denied" onClick={(e) => e.stopPropagation()}>
            <h3>Accès refusé</h3>
            <p>{denied}</p>
            <button className="adm-btn solid" onClick={() => setDenied(null)}>J’ai compris</button>
          </div>
        </div>
      )}

      {/* Bandeau d'erreur serveur : l'opération n'a PAS été enregistrée. */}
      {notice && (
        <div className="adm-notice" role="alert">
          <span>{notice}</span>
          <button className="adm-notice-x" onClick={() => setNotice(null)} aria-label="Fermer">✕</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Sections ----------------------------- */

