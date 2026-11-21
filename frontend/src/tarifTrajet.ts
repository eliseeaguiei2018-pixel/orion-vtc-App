import { useEffect, useState } from 'react';
import type { LatLng } from './types';
import { definirTrajetTarif, itineraire, type TrajetTarif } from './api';
import { itineraireGoogle } from './itineraireGoogle';
import { dansLeDelai } from './servicesGoogle';

/**
 * TRAJET SERVANT AU PRIX (app cliente).
 *
 * Le prix d'une course se calcule sur le trajet par la route — le même que celui tracé sur
 * la carte : l'itinéraire de Google s'il répond (avec le trafic du moment), sinon le calcul
 * routier d'ORION (serveur ORION, ou calcul public sans serveur). Ce module le demande une
 * fois par trajet, le garde, et le fournit au calcul du prix (`definirTrajetTarif`).
 *
 * Sans réponse en quatre secondes (hors connexion), le prix se calcule sur l'estimation
 * habituelle : 1,3 fois la distance à vol d'oiseau.
 */
const connus = new Map<string, TrajetTarif | null>();
const enCours = new Map<string, Promise<TrajetTarif | null>>();
const cle = (points: LatLng[]): string => points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

const trajetConnu = (points: LatLng[]): TrajetTarif | null => connus.get(cle(points)) ?? null;
definirTrajetTarif(trajetConnu);

/** Demande le trajet (une seule fois par suite de points) ; null si aucun calcul n'a répondu. */
export function chargerTrajet(points: LatLng[]): Promise<TrajetTarif | null> {
  const k = cle(points);
  if (connus.has(k)) return Promise.resolve(connus.get(k) ?? null);
  const deja = enCours.get(k);
  if (deja) return deja;
  const promesse = dansLeDelai(itineraireGoogle(points).then((r) => r ?? itineraire(points)), 4000).then((r) => {
    const trajet = r && r.distanceMeters > 0 ? { distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, fluideSeconds: r.fluideSeconds } : null;
    enCours.delete(k);
    // Un échec n'est pas retenu : le prochain écran réessaiera. Un trajet trouvé reste le
    // même jusqu'à la fin de la commande : le prix annoncé ne bouge plus.
    if (trajet) connus.set(k, trajet);
    if (connus.size > 60) for (const vieux of [...connus.keys()].slice(0, connus.size - 60)) connus.delete(vieux);
    return trajet;
  });
  enCours.set(k, promesse);
  return promesse;
}

/**
 * Trajet d'une suite de points pour un écran : `pret` passe à vrai quand le trajet est connu
 * (ou que le calcul a renoncé). Tant qu'il est faux, l'écran n'annonce pas de prix.
 */
export function useTrajetTarif(points: LatLng[] | null): { pret: boolean; trajet: TrajetTarif | null } {
  const k = points && points.length > 1 ? cle(points) : '';
  const [etat, setEtat] = useState<{ k: string; pret: boolean; trajet: TrajetTarif | null }>(() => ({ k, pret: !k || connus.has(k), trajet: k ? connus.get(k) ?? null : null }));
  useEffect(() => {
    if (!k || !points) { setEtat({ k, pret: true, trajet: null }); return; }
    if (connus.has(k)) { setEtat({ k, pret: true, trajet: connus.get(k) ?? null }); return; }
    let actif = true;
    setEtat({ k, pret: false, trajet: null });
    void chargerTrajet(points).then((trajet) => { if (actif) setEtat({ k, pret: true, trajet }); });
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return etat.k === k ? { pret: etat.pret, trajet: etat.trajet } : { pret: !k || connus.has(k), trajet: k ? connus.get(k) ?? null : null };
}
