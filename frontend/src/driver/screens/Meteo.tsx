import { useEffect, useRef, useState } from 'react';
import { IconCloud, IconMoon, IconRain, IconStorm, IconSun } from '../../icons';
import type { DriverApp } from '../useDriver';
import type { AlerteMeteo, MeteoChauffeur } from '../types';
import { tr } from '../i18n';

/**
 * MÉTÉO D'ORION PRO : le temps qu'il fait dans la commune du chauffeur et la pluie qui arrive
 * ailleurs à Abidjan. Quand il pleut, les clients commandent davantage : le chauffeur prévenu
 * se place à temps. Les données viennent du serveur ORION (Google Météo), rafraîchies toutes
 * les 15 minutes ; sans service météo, rien ne s'affiche.
 */
const PLUIE = /RAIN|SHOWER|DRIZZLE/;

/** Libellé court du temps, dans la langue du chauffeur (Google répond en français). */
export function libelleTemps(type: string, description: string): string {
  if (/THUNDER/.test(type)) return tr('Orage');
  if (/HEAVY/.test(type) && PLUIE.test(type)) return tr('Forte pluie');
  if (/LIGHT|CHANCE|SCATTERED/.test(type) && PLUIE.test(type)) return tr('Averses');
  if (PLUIE.test(type)) return tr('Pluie');
  if (/FOG|HAZE|MIST/.test(type)) return tr('Brouillard');
  if (/WIND/.test(type)) return tr('Venteux');
  if (type === 'PARTLY_CLOUDY') return tr('Partiellement nuageux');
  if (/CLOUDY/.test(type)) return tr('Nuageux');
  if (/CLEAR/.test(type)) return tr('Dégagé');
  return description || '—';
}

function IconeTemps({ type, jour }: { type: string; jour: boolean }) {
  if (/THUNDER/.test(type)) return <IconStorm size={30} />;
  if (PLUIE.test(type)) return <IconRain size={30} />;
  if (/CLOUD|FOG|HAZE|MIST/.test(type)) return <IconCloud size={30} />;
  return jour ? <IconSun size={30} /> : <IconMoon size={30} />;
}

/** « en ce moment », « dans 40 min », « vers 15 h » (heure d'Abidjan = GMT). */
export function quand(a: AlerteMeteo): string {
  if (a.dansMinutes <= 10) return tr('en ce moment');
  if (a.dansMinutes < 60) return tr('dans {0} min', [a.dansMinutes]);
  return tr('vers {0} h', [new Date(a.heure).getUTCHours()]);
}

export function titreAlerte(commune: string, a: AlerteMeteo): string {
  if (a.niveau === 'orage') return tr('Orage attendu à {0} {1}', [commune, quand(a)]);
  if (a.niveau === 'forte_pluie') return tr('Forte pluie attendue à {0} {1}', [commune, quand(a)]);
  return tr('Pluie attendue à {0} {1}', [commune, quand(a)]);
}

export function MeteoAccueil({ app }: { app: DriverApp }) {
  const [m, setM] = useState<MeteoChauffeur | null>(null);
  const pos = useRef(app.position);
  pos.current = app.position;
  useEffect(() => {
    const charger = () => { void app.backend.meteo(pos.current).then(setM).catch(() => undefined); };
    charger();
    const id = window.setInterval(charger, 15 * 60_000);
    return () => window.clearInterval(id);
  }, [app.backend]);
  if (!m?.meteo) return null;
  const ici = m.meteo;
  const alertes = m.alertes.slice(0, 3);
  const pluieIci = ici.alerte && ici.alerte.dansMinutes <= 60;
  return (
    <div className="card dv-meteo-carte">
      <div className="dv-meteo">
        <IconeTemps type={ici.type} jour={ici.jour} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="dv-item-title">{tr('Météo · {0}', [m.commune])}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>{libelleTemps(ici.type, ici.description)}{ici.ressenti !== null ? ` · ${tr('ressenti {0}°', [Math.round(ici.ressenti)])}` : ''}</div>
        </div>
        {ici.temperature !== null && <span className="dv-meteo-temp">{Math.round(ici.temperature)}°</span>}
      </div>
      {alertes.length > 0 && (
        <div className="dv-meteo-alertes" style={{ padding: '0 14px 12px' }}>
          {alertes.map((a) => (
            <div key={a.commune} className="dv-meteo-alerte">
              <span className={`dv-pill ${a.alerte.niveau === 'pluie' ? '' : 'gold'}`}>{a.alerte.niveau === 'orage' ? <IconStorm size={13} /> : <IconRain size={13} />}</span>
              <span>{titreAlerte(a.commune, a.alerte)}</span>
            </div>
          ))}
          <div className="faint" style={{ fontSize: 12 }}>
            {pluieIci ? tr('Chaussée glissante : ralentissez et allumez vos feux.') : tr('Les clients commandent davantage quand il pleut : restez en ligne près de ces quartiers.')}
          </div>
        </div>
      )}
    </div>
  );
}
