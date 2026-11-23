import { useEffect, useRef, useState } from 'react';
import { vehiculesProches, type VehiculesProches } from './api';
import type { LatLng } from './types';

/**
 * VÉHICULES PROCHES (app cliente) : tant qu'un écran de commande est ouvert, l'app demande au
 * serveur ORION toutes les 4 s les véhicules libres autour du point de départ et, par gamme,
 * le temps d'approche du plus proche. La carte les fait rouler ; les gammes affichent
 * « 3 min » ou « aucun chauffeur ».
 *
 * Batterie : rien ne part quand l'app est en arrière-plan ou l'écran éteint ; une réponse
 * identique ne redessine rien.
 */
const PERIODE_MS = 4000;

export function useVehiculesProches(depart: LatLng | null): VehiculesProches | null {
  const [etat, setEtat] = useState<VehiculesProches | null>(null);
  const derniere = useRef('');
  const cle = depart ? `${depart.lat.toFixed(4)},${depart.lng.toFixed(4)}` : '';
  useEffect(() => {
    if (!depart) { setEtat(null); derniere.current = ''; return; }
    let actif = true;
    let minuteur = 0;
    const charger = async () => {
      window.clearTimeout(minuteur);
      if (!actif) return;
      if (!document.hidden) {
        const r = await vehiculesProches(depart);
        if (!actif) return;
        if (r) {
          const empreinte = JSON.stringify([r.vehicules, r.approche]);
          if (empreinte !== derniere.current) { derniere.current = empreinte; setEtat(r); }
        }
      }
      minuteur = window.setTimeout(() => void charger(), PERIODE_MS);
    };
    const auRetour = () => { if (!document.hidden) void charger(); };
    document.addEventListener('visibilitychange', auRetour);
    void charger();
    return () => { actif = false; window.clearTimeout(minuteur); document.removeEventListener('visibilitychange', auRetour); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  return etat;
}
