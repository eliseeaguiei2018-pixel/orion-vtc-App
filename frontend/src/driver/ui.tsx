import { useState, type ReactNode } from 'react';
import { LogoApp } from '../components/Logo';
import { rendu, Scooter, Voiture, vehiculeDeGamme } from '../components/Vehicules';
import { IconActivity, IconAward, IconBell, IconBriefcase, IconCar, IconCheck, IconGlobe, IconHome, IconLeaf, IconSettings } from '../icons';
import { tr } from './i18n';
import { LANGUAGES, useI18n, type Lang } from '../i18n';
import { Drapeau } from '../components/Drapeau';

export type Tab = 'home' | 'rides' | 'activite' | 'prime' | 'poste' | 'green' | 'profile';

/** Barre d'onglets du bas (pouce-friendly). */
export function BottomNav({ tab, onTab, alert }: { tab: Tab; onTab: (t: Tab) => void; alert?: Partial<Record<Tab, boolean>> }) {
  const items: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: 'home', label: tr('Accueil'), icon: <IconHome size={21} /> },
    { id: 'rides', label: tr('Courses'), icon: <IconCar size={21} /> },
    { id: 'activite', label: tr('Activité'), icon: <IconActivity size={21} /> },
    { id: 'prime', label: tr('Prime'), icon: <IconAward size={21} /> },
    { id: 'poste', label: tr('Poste'), icon: <IconBriefcase size={21} /> },
    { id: 'green', label: tr('Éco'), icon: <IconLeaf size={21} /> },
    { id: 'profile', label: tr('Profil'), icon: <IconSettings size={21} /> },
  ];
  return (
    <nav className="dv-tabs" aria-label={tr('Navigation')}>
      {items.map((it) => (
        <button key={it.id} className={`dv-tab${tab === it.id ? ' on' : ''}`} onClick={() => onTab(it.id)} aria-current={tab === it.id}>
          <span className="dv-tab-ico">{it.icon}{alert?.[it.id] && <i className="dv-dot" />}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/**
 * En-tête de page en dégradé — la signature visuelle d'ORION, la même que l'accueil de
 * l'app cliente : marque, actions, titre, sous-titre, et un contenu libre (indicateurs).
 */
/** En-tête de page, comme les volets de l'app cliente : grand titre sur le fond, actions à droite.
 *  `marque` : le logo ORION en haut à gauche (accueil seulement). */
export function PageHeader({ title, sub, right, children, marque = false }: { title: string; sub?: string; right?: ReactNode; children?: ReactNode; marque?: boolean }) {
  return (
    <header className={`dv-hero${marque ? '' : ' sans-marque'}`}>
      <div className="dv-hero-top">
        {marque ? <span className="dv-hero-brand"><LogoApp size={28} className="hub-logo-volume" /> ORION</span> : <span />}
        <span className="dv-hero-actions">{right}</span>
      </div>
      <h1>{title}</h1>
      {sub && <div className="dv-hero-sub">{sub}</div>}
      {children}
    </header>
  );
}

/** Le véhicule du chauffeur, dessiné à la couleur de sa gamme (scooter pour un coursier). */
export function VehiculeChauffeur({ category, largeur = 150 }: { category: string; largeur?: number }) {
  if (category === 'moto') return <Scooter largeur={largeur} />;
  // Cargo : le petit camion bleu du volet livraison (gros colis).
  if (category === 'cargo') return <img src={rendu('livraison/liv-cargo')} alt="" width={largeur} style={{ height: 'auto', display: 'block' }} />;
  const v = vehiculeDeGamme(category);
  return <Voiture modele={v.modele} peinture={v.peinture} largeur={largeur} />;
}

export function BellButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className="avatar dv-bell" onClick={onClick} aria-label={tr('Notifications ({0})', [count])}>
      <IconBell size={20} />
      {count > 0 && <span className="dv-bell-n">{count > 9 ? '9+' : count}</span>}
    </button>
  );
}

/** Bandeau d'information (maintenance, suspension, dette…). */
export function Banner({ tone = 'info', icon, title, children, action }: {
  tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`dv-banner ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <div className="dv-banner-ico">{icon}</div>}
      <div className="grow">
        <strong>{title}</strong>
        {children && <div className="dv-banner-body">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Tuile de statistique. */
export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`dv-stat card${accent ? ' accent' : ''}`}>
      <span className="dv-stat-label">{label}</span>
      <span className="dv-stat-value">{value}</span>
      {sub && <span className="dv-stat-sub">{sub}</span>}
    </div>
  );
}

/** Jauge horizontale (0..max). */
export function Progress({ value, max, tone = 'green' }: { value: number; max: number; tone?: 'green' | 'gold' | 'danger' }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="dv-bar"><span className={tone} style={{ width: `${w}%` }} /></div>;
}

/** Section titrée dans une page défilante. */
export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="dv-section">
      <div className="row between"><h2 className="dv-section-title">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

/** Panneau modal en bas d'écran. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dv-modal-back" onClick={onClose}>
      <div className="dv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 className="h-title" style={{ fontSize: 19 }}>{title}</h2>
          <button className="dv-x" onClick={onClose} aria-label={tr('Fermer')}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Choix de la langue (les 8 langues de l'app cliente, même mémorisation « orion.lang »). */
export function ChoixLangue({ onChoisi }: { onChoisi?: () => void }) {
  const { lang, setLang } = useI18n();
  return (
    <div className="dv-langues" role="group" aria-label={tr('Langue')}>
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" className={`opt${l.code === lang ? ' active' : ''}`} lang={l.code}
          onClick={() => { setLang(l.code as Lang); onChoisi?.(); }}>
          <Drapeau code={l.code} /> <span className="grow" style={{ textAlign: 'start' }}>{l.label}</span>
          {l.code === lang && <IconCheck size={16} />}
        </button>
      ))}
    </div>
  );
}

/** Bouton globe : ouvre le choix de la langue (écran de connexion). */
export function BoutonLangue() {
  const [ouvert, setOuvert] = useState(false);
  const { lang } = useI18n();
  return (
    <>
      <button type="button" className="avatar dv-auth-lang" onClick={() => setOuvert(true)} aria-label={tr('Langue')}>
        <IconGlobe size={18} /><span className="dv-auth-drapeau"><Drapeau code={lang} taille={14} /></span>
      </button>
      {ouvert && <Modal title={tr('Langue')} onClose={() => setOuvert(false)}><ChoixLangue onChoisi={() => setOuvert(false)} /></Modal>}
    </>
  );
}
