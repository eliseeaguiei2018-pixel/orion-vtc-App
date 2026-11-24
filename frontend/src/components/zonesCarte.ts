/**
 * ZONES SUR LA CARTE (ORION Pro, hors course) : zones à forte demande, zones habituelles de
 * l'heure et sièges ORION, posées sur la carte Google comme sur la carte de navigation. Un
 * toucher sur une zone la choisit (l'app propose alors l'itinéraire pour s'y rendre).
 */
export type GenreZone = 'forte' | 'elevee' | 'moderee' | 'prevue' | 'siege';
export interface ZoneCarte { id: string; lat: number; lng: number; genre: GenreZone; libelle: string; detail?: string; choisie?: boolean }

const BATIMENT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5"/><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/></svg>';

/** Élément HTML d'une zone (le nom est posé en texte, jamais interprété). */
export function elementZone(z: ZoneCarte, onZone?: (id: string) => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `carte-zone ${z.genre}${z.choisie ? ' choisie' : ''}`;
  b.innerHTML = `<span class="carte-zone-halo"></span><span class="carte-zone-point">${z.genre === 'siege' ? BATIMENT : ''}</span><span class="carte-zone-nom"></span>`;
  b.querySelector('.carte-zone-nom')!.textContent = z.libelle;
  b.setAttribute('aria-label', z.detail ? `${z.libelle} · ${z.detail}` : z.libelle);
  b.addEventListener('click', (e) => { e.stopPropagation(); onZone?.(z.id); });
  return b;
}

/** Clé de comparaison : les repères ne sont reposés que si les zones ont changé. */
export const cleZones = (zones?: ZoneCarte[]): string => (zones ?? []).map((z) => `${z.id}:${z.genre}:${z.choisie ? 1 : 0}:${z.libelle}`).join('|');
