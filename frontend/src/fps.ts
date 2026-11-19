/**
 * DIAGNOSTIC DE FLUIDITÉ (opt-in).
 *
 * Ouvrir n'importe quelle interface avec `?fps=1` affiche un petit badge qui mesure les
 * images par seconde réellement rendues et la fréquence maximale que l'écran a laissée
 * atteindre. C'est la preuve visible que la chaîne graphique tire parti des dalles
 * 90/120/144 Hz : sur un écran 60 Hz le badge plafonne à 60, sur un écran 120 Hz il peut
 * afficher ~120. Jamais actif sans le paramètre : aucun coût en usage normal.
 */
export function demarrerDiagnosticFluidite(): void {
  try {
    if (new URLSearchParams(location.search).get('fps') !== '1') return;
  } catch {
    return;
  }
  const badge = document.createElement('div');
  badge.setAttribute('role', 'status');
  badge.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'bottom:12px', 'right:12px',
    'padding:7px 11px', 'border-radius:12px', 'font:600 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace',
    'color:#04140d', 'background:linear-gradient(140deg,#2bffa6,#00b46e)',
    'box-shadow:0 8px 24px -10px rgba(0,0,0,.5)', 'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(badge);

  let images = 0;
  let max = 0;
  let debut = performance.now();
  let dernier = debut;
  const boucle = (t: number) => {
    images += 1;
    const dt = t - dernier;
    if (dt > 0) max = Math.max(max, 1000 / dt);
    dernier = t;
    if (t - debut >= 500) {
      const fps = Math.round((images * 1000) / (t - debut));
      badge.textContent = `${fps} i/s  ·  crête ${Math.round(max)}`;
      images = 0; debut = t; max = 0;
    }
    requestAnimationFrame(boucle);
  };
  requestAnimationFrame(boucle);
}
