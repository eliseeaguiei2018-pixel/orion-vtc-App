import { useEffect, useRef, useState } from 'react';
import { IconVolume } from '../../icons';
import type { Manoeuvre } from '../../api';
import { localeCourante, tr } from '../i18n';
import { angleFleche, distanceLisible, texteManoeuvre, type Guidage } from '../navigation';

const CLE_VOIX = 'orion.driver.voix';

/** Pictogramme de la manœuvre : flèche orientée, rond-point numéroté, demi-tour, arrivée. */
function Picto({ m }: { m: Manoeuvre }) {
  if (m.type === 'arrive') {
    return <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><path d="M14 42V8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /><path d="M14 9h22l-5 7 5 7H14" fill="currentColor" /></svg>;
  }
  if (m.type === 'roundabout' || m.type === 'rotary' || m.type === 'roundabout turn') {
    return (
      <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
        <circle cx="24" cy="22" r="9" fill="none" stroke="currentColor" strokeWidth="4" />
        <path d="M24 31v12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        {m.sortie ? <text x="24" y="26.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor">{m.sortie}</text> : null}
      </svg>
    );
  }
  if (m.modificateur === 'uturn') {
    return <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><path d="M30 42V20a8 8 0 0 0-16 0v4" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" /><path d="M7 20l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" style={{ transform: `rotate(${angleFleche(m)}deg)` }}>
      <path d="M24 44V12" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M12 22L24 9l12 13" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Guidage vocal : annonce la manœuvre à l'approche (≈ 400 m, 120 m, puis au moment de tourner). */
function useVoix(guidage: Guidage | null, active: boolean, arrivee: string) {
  const annonces = useRef<{ cle: string; paliers: Set<number> }>({ cle: '', paliers: new Set() });
  useEffect(() => {
    const p = guidage?.prochaine;
    if (!active || !p || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const cle = `${p.type}|${p.position.lat}|${p.position.lng}`;
    if (annonces.current.cle !== cle) annonces.current = { cle, paliers: new Set() };
    const palier = p.distance <= 35 ? 0 : p.distance <= 150 ? 1 : p.distance <= 450 ? 2 : -1;
    if (palier < 0 || annonces.current.paliers.has(palier)) return;
    annonces.current.paliers.add(palier);
    const consigne = texteManoeuvre(p, arrivee);
    const phrase = palier === 0 ? consigne : tr('Dans {0} : {1}', [distanceLisible(p.distance), consigne]);
    try {
      const u = new SpeechSynthesisUtterance(phrase);
      u.lang = localeCourante().replace('-u-nu-latn', '');
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* synthèse vocale indisponible : le bandeau suffit */ }
  }, [guidage, active, arrivee]);
}

/**
 * Bandeau de navigation de l'écran de course : prochaine manœuvre (bretelle d'échangeur,
 * rond-point, pont…), distance, voie à prendre, puis reste du trajet et heure d'arrivée.
 */
export function BandeauGuidage({ guidage, recalcul, actif, arrivee }: { guidage: Guidage | null; recalcul: boolean; actif: boolean; arrivee: string }) {
  const vocalPossible = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voix, setVoix] = useState(() => { try { return localStorage.getItem(CLE_VOIX) !== 'non'; } catch { return true; } });
  useVoix(guidage, actif && voix && vocalPossible, arrivee);
  if (!actif) return null;
  if (!guidage) {
    return <div className="dv-nav dv-nav-calcul" role="status"><span className="dv-nav-spin" /> {tr('Calcul de l’itinéraire…')}</div>;
  }
  const p = guidage.prochaine;
  const heureArrivee = new Date(Date.now() + guidage.resteSecondes * 1000).toLocaleTimeString(localeCourante(), { hour: '2-digit', minute: '2-digit' });
  const basculerVoix = () => {
    const v = !voix;
    setVoix(v);
    try { localStorage.setItem(CLE_VOIX, v ? 'oui' : 'non'); } catch { /* préférence non mémorisée */ }
    if (!v) try { window.speechSynthesis.cancel(); } catch { /* rien à couper */ }
  };
  return (
    <div className="dv-nav" role="status" aria-live="polite">
      <div className="dv-nav-haut">
        {p && <div className="dv-nav-picto"><Picto m={p} /></div>}
        <div className="grow" style={{ minWidth: 0 }}>
          {p ? (
            <>
              <div className="dv-nav-distance">{p.type === 'arrive' && p.distance < 30 ? tr('Maintenant') : distanceLisible(p.distance)}</div>
              <div className="dv-nav-consigne">{texteManoeuvre(p, arrivee)}</div>
              {p.nom && p.type !== 'arrive' && <div className="dv-nav-voie">{p.nom}</div>}
            </>
          ) : (
            <div className="dv-nav-consigne">{guidage.fiable ? tr('Suivez l’itinéraire') : tr('Itinéraire approximatif : réseau indisponible')}</div>
          )}
        </div>
        {vocalPossible && (
          <button type="button" className={`dv-nav-voix${voix ? ' on' : ''}`} onClick={basculerVoix} aria-pressed={voix}
            aria-label={voix ? tr('Couper le guidage vocal') : tr('Activer le guidage vocal')}>
            <IconVolume size={18} />{!voix && <i />}
          </button>
        )}
      </div>
      {p && guidage.prochaine && guidage.prochaine.distance < 350 && guidage.puis && (
        <div className="dv-nav-puis">{tr('Puis : {0}', [texteManoeuvre(guidage.puis, arrivee)])}</div>
      )}
      <div className="dv-nav-bas">
        <strong>{distanceLisible(guidage.reste)}</strong>
        <span>· {tr('{0} min', [Math.max(1, Math.round(guidage.resteSecondes / 60))])}</span>
        <span>· {tr('arrivée {0}', [heureArrivee])}</span>
        {recalcul && <span className="dv-nav-recalcul">· {tr('Nouvel itinéraire…')}</span>}
      </div>
    </div>
  );
}
