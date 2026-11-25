import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from './i18n';
import { rendu } from './components/Vehicules';
import type { TensionMarche } from './api';
import type { DetailTrafic } from './types';

/**
 * OFFRE ET DEMANDE autour du client (écran des gammes) : une pastille en haut à gauche de la
 * carte, une fiche qui explique le prix du moment, et un guide en cinq pages.
 *
 * Tout vient du serveur ORION (`tension` dans /vehicules/proches) : même calcul que la
 * majoration appliquée au prix (commandes et chauffeurs libres à ~1 km, plafond de la
 * direction, majoration manuelle de zone). Rien n'est décidé dans l'application.
 */
type Niveau = TensionMarche['niveau'];

const TEINTES: Record<Niveau, { clair: string; face: string; ombre: string; bord: string; encre: string }> = {
  vert: { clair: '#b8f5d6', face: '#22c37a', ombre: '#0b7a47', bord: '#0f8f55', encre: '#075a34' },
  jaune: { clair: '#fff3b8', face: '#f5c21b', ombre: '#a87800', bord: '#c99300', encre: '#6e4d00' },
  orange: { clair: '#ffd2ad', face: '#f47d22', ombre: '#a5440a', bord: '#c4570f', encre: '#6b2a03' },
};

/**
 * Pièce ORION en volume : tranche, face bombée, reflet, « F » (franc CFA) en relief.
 * Une flèche par palier de demande : aucune au prix habituel, une ou deux quand il monte.
 */
export function PieceOrion({ niveau, taille = 32 }: { niveau: Niveau; taille?: number }) {
  const id = useId().replace(/:/g, '');
  const c = TEINTES[niveau];
  const fleches = niveau === 'vert' ? 0 : niveau === 'jaune' ? 1 : 2;
  return (
    <svg className="piece-orion" width={taille} height={taille} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}f`} cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor={c.clair} />
          <stop offset="0.45" stopColor={c.face} />
          <stop offset="1" stopColor={c.ombre} />
        </radialGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.bord} />
          <stop offset="1" stopColor={c.ombre} />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="33" cy="58" rx="20" ry="4.5" fill={`url(#${id}s)`} />
      {/* Tranche */}
      <circle cx="32" cy="33.5" r="25" fill={`url(#${id}t)`} />
      {/* Face et listel */}
      <circle cx="32" cy="30" r="25" fill={`url(#${id}f)`} />
      <circle cx="32" cy="30" r="20" fill="none" stroke={c.encre} strokeOpacity="0.28" strokeWidth="1.6" />
      <circle cx="32" cy="30" r="21.2" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8" />
      {/* F en relief : ombre portée puis lettre */}
      <g style={{ fontFamily: "var(--font-display, 'Sora'), system-ui, sans-serif" }} fontWeight="700" fontSize="25" textAnchor="middle">
        <text x={fleches ? 29.4 : 32.6} y="40.4" fill={c.encre} fillOpacity="0.45">F</text>
        <text x={fleches ? 28.4 : 31.6} y="39" fill="#fff">F</text>
      </g>
      {fleches > 0 && (
        <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M38.5 31.5 l4 -4 l4 4" />
          {fleches > 1 && <path d="M38.5 39 l4 -4 l4 4" strokeOpacity="0.8" />}
        </g>
      )}
      {/* Reflet */}
      <path d="M14.5 22.5 A19 19 0 0 1 30 10.6" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Place de la pièce sur la jauge (0 : beaucoup de chauffeurs, 1 : beaucoup de commandes). */
function position(t: TensionMarche): number {
  const p = t.ratio / (t.ratio + 1);
  const [min, max] = t.niveau === 'vert' ? [0.1, 0.5] : t.niveau === 'jaune' ? [0.58, 0.68] : [0.74, 0.92];
  return Math.min(max, Math.max(min, p));
}

/** Pastille en haut à gauche de la carte : voiture, jauge et pièce, clients. */
/** Trafic du trajet en une ligne : période, bouchons traversés, part ajoutée au prix. */
export function LigneTrafic({ trafic, detaillee = false }: { trafic?: DetailTrafic | null; detaillee?: boolean }) {
  const { t } = useI18n();
  if (!trafic || (trafic.pct <= 0 && trafic.periode !== 'pointe')) return null;
  const n = trafic.bouchons.length;
  const morceaux = [
    t(`traf_p_${trafic.periode}`),
    n > 0 ? (detaillee ? t('traf_bouchons_liste', { n, liste: trafic.bouchons.join(', ') }) : t('traf_bouchons', { n })) : null,
    trafic.pct > 0 ? t('traf_pct', { pct: String(Math.round(trafic.pct)) }) : null,
  ].filter(Boolean);
  return <p className={`traf-ligne${trafic.pct >= 15 ? ' fort' : ''}`} role="status">{morceaux.join(' · ')}{trafic.source === 'mesure' ? ` · ${t('traf_mesure')}` : ''}</p>;
}

export function PastilleDemande({ tension, trafic }: { tension: TensionMarche | null | undefined; trafic?: DetailTrafic | null }) {
  const { t } = useI18n();
  const [fiche, setFiche] = useState(false);
  const [guide, setGuide] = useState(false);
  if (!tension) return null;
  return (
    <>
      <button className={`dem-pastille ${tension.niveau}`} onClick={() => setFiche(true)} aria-label={`${t('dem_aria')} · ${t(`dem_titre_${tension.niveau}`)}`}>
        <img className="dem-voiture" src={rendu('berline-perle')} alt="" draggable={false} />
        <span className="dem-piste" aria-hidden="true">
          <span className="dem-piste-plein" style={{ width: `${Math.round(position(tension) * 100)}%` }} />
          <span className="dem-piste-piece" style={{ left: `${Math.round(position(tension) * 100)}%` }}><PieceOrion niveau={tension.niveau} taille={28} /></span>
        </span>
        <img className="dem-clients" src={rendu('clients')} alt="" draggable={false} />
      </button>
      {fiche && <FicheDemande tension={tension} trafic={trafic} onFermer={() => setFiche(false)} onGuide={() => { setFiche(false); setGuide(true); }} />}
      {guide && <GuideDemande plafondPct={tension.plafondPct} onFermer={() => setGuide(false)} />}
    </>
  );
}

function Fenetre({ children, onFermer, label }: { children: React.ReactNode; onFermer: () => void; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onFermer]);
  return createPortal(
    <div className="dem-fond" onClick={onFermer}>
      <div className="dem-fiche" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <span className="dem-poignee" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.querySelector('.phone') ?? document.body,
  );
}

/** Fiche : le prix du moment expliqué, la jauge « Autour de vous ». */
export function FicheDemande({ tension, trafic, onFermer, onGuide }: { tension: TensionMarche; trafic?: DetailTrafic | null; onFermer: () => void; onGuide: () => void }) {
  const { t } = useI18n();
  const n = tension.niveau;
  const p = Math.round(position(tension) * 100);
  const seuil = Math.round((tension.seuil / (tension.seuil + 1)) * 100);
  return (
    <Fenetre onFermer={onFermer} label={t(`dem_titre_${n}`)}>
      <div className="dem-entete">
        <PieceOrion niveau={n} taille={56} />
        <div className="col">
          <h2 className="dem-titre">{t(`dem_titre_${n}`)}</h2>
          {n !== 'vert' && <span className={`dem-taux ${n}`}>+{tension.majorationPct} %</span>}
        </div>
      </div>
      <p className="dem-texte">{t(n === 'orange' && tension.majorationPct >= tension.plafondPct ? 'dem_texte_orange_max' : `dem_texte_${n}`, { pct: tension.majorationPct, max: tension.plafondPct })}</p>
      <div className="dem-jauge-bloc">
        <span className="dem-jauge-titre">{t('dem_autour')}</span>
        <div className="dem-jauge">
          <img className="dem-jauge-voiture" src={rendu('berline-perle')} alt="" draggable={false} />
          <div className="dem-jauge-piste" role="img" aria-label={t(`dem_titre_${n}`)}>
            <span className="dem-zone vert" style={{ width: `${seuil}%` }} />
            <span className="dem-zone jaune" style={{ left: `${seuil}%`, width: `${67 - seuil}%` }} />
            <span className="dem-zone orange" style={{ left: '67%', right: 0 }} />
            <span className="dem-jauge-repere" style={{ left: `${seuil}%` }} />
            <span className="dem-jauge-piece" style={{ left: `${p}%` }}><PieceOrion niveau={n} taille={34} /></span>
          </div>
          <img className="dem-jauge-clients" src={rendu('clients')} alt="" draggable={false} />
        </div>
        <div className="dem-jauge-legende"><span>{t('dem_chauffeurs')}</span><span>{t('dem_commandes')}</span></div>
      </div>
      {trafic && (trafic.pct > 0 || trafic.periode === 'pointe') && (
        <div className="dem-trafic">
          <span className="dem-jauge-titre">{t('traf_titre')}</span>
          <LigneTrafic trafic={trafic} detaillee />
        </div>
      )}
      <p className="dem-garanti">{t('dem_garanti')}</p>
      <button className="dem-lien" onClick={onGuide}>{t('dem_comment')}<span aria-hidden="true">›</span></button>
      <button className="btn btn-primary dem-ok" onClick={onFermer}>{t('dem_compris')}</button>
    </Fenetre>
  );
}

const PAGES = [
  { titre: 'dem_g1_titre', texte: 'dem_g1_texte' },
  { titre: 'dem_titre_vert', texte: 'dem_g2_texte' },
  { titre: 'dem_titre_jaune', texte: 'dem_g3_texte' },
  { titre: 'dem_titre_orange', texte: 'dem_g4_texte' },
  { titre: 'dem_g5_titre', texte: 'dem_g5_texte' },
] as const;

function Illustration({ page }: { page: number }) {
  if (page === 0) {
    return (
      <div className="dem-illu scene">
        <img className="dem-illu-voiture" src={rendu('berline-perle')} alt="" draggable={false} />
        <PieceOrion niveau="jaune" taille={58} />
        <img className="dem-illu-clients" src={rendu('clients')} alt="" draggable={false} />
      </div>
    );
  }
  if (page === 4) {
    return (
      <div className="dem-illu">
        <img className="dem-illu-cadenas" src={rendu('cadenas')} alt="" draggable={false} />
        <span className="dem-illu-piece-coin"><PieceOrion niveau="vert" taille={54} /></span>
      </div>
    );
  }
  const niveau: Niveau = page === 1 ? 'vert' : page === 2 ? 'jaune' : 'orange';
  return <div className="dem-illu"><PieceOrion niveau={niveau} taille={112} /></div>;
}

/** Guide en cinq pages : comment ORION fixe le prix selon l'offre et la demande. */
export function GuideDemande({ plafondPct, onFermer }: { plafondPct: number; onFermer: () => void }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [depart, setDepart] = useState<number | null>(null);
  const derniere = page === PAGES.length - 1;
  const aller = (d: number) => setPage((p) => Math.min(PAGES.length - 1, Math.max(0, p + d)));
  // Le guide défile dans le sens de lecture de la langue (arabe : de droite à gauche).
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  return (
    <Fenetre onFermer={onFermer} label={t('dem_comment')}>
      <div
        className="dem-guide"
        onPointerDown={(e) => setDepart(e.clientX)}
        onPointerUp={(e) => {
          if (depart === null) return;
          const dx = e.clientX - depart;
          setDepart(null);
          if (Math.abs(dx) > 40) aller((dx < 0) !== rtl ? 1 : -1);
        }}
      >
        <div className="dem-guide-rail" style={{ transform: `translateX(${(rtl ? 1 : -1) * page * 100}%)` }}>
          {PAGES.map((pg, i) => (
            <section key={pg.titre} className="dem-page" aria-hidden={i !== page}>
              <Illustration page={i} />
              <h2 className="dem-titre">{t(pg.titre)}</h2>
              <p className="dem-texte">{t(pg.texte, { max: plafondPct })}</p>
            </section>
          ))}
        </div>
      </div>
      <div className="dem-points" role="tablist" aria-label={t('dem_comment')}>
        {PAGES.map((pg, i) => (
          <button key={pg.titre} role="tab" aria-selected={i === page} aria-label={`${i + 1} / ${PAGES.length}`} className={i === page ? 'actif' : ''} onClick={() => setPage(i)} />
        ))}
      </div>
      <button className="btn btn-primary dem-ok" onClick={() => (derniere ? onFermer() : aller(1))}>{t(derniere ? 'dem_terminer' : 'dem_suivant')}</button>
    </Fenetre>
  );
}
