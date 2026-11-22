/**
 * APPARENCE — thème et couleur de l'application (app cliente et app chauffeur).
 *
 *  - Thème : trois vignettes (Clair, Sombre, Système) qui montrent l'écran tel qu'il sera :
 *    une carte, deux lignes de texte, un point de la couleur choisie. « Système » suit le
 *    téléphone (la vignette est coupée en diagonale). La vignette choisie est cerclée.
 *  - Couleur : huit palettes sur deux rangées de quatre. « Blanc » garde les thèmes clair et
 *    sombre purs (aucune teinte dans les fonds) ; les sept autres teintent légèrement l'app.
 */
import { ACCENTS, useTheme, type Accent, type ThemeMode } from '../theme';
import { IconCheck } from '../icons';

export function ChoixTheme({ libelles }: { libelles: Record<ThemeMode, string> }) {
  const { mode, setMode } = useTheme();
  const ordre: ThemeMode[] = ['light', 'dark', 'system'];
  return (
    <div className="theme-choix" role="radiogroup" aria-label={libelles.system}>
      {ordre.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} className={`theme-option${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
          <span className={`theme-vignette theme-${m}`} aria-hidden="true">
            <span className="theme-ecran">
              <i className="theme-ligne longue" /><i className="theme-ligne" /><i className="theme-point" />
            </span>
            {m === 'system' && (
              <span className="theme-moitie">
                <span className="theme-ecran">
                  <i className="theme-ligne longue" /><i className="theme-ligne" /><i className="theme-point" />
                </span>
              </span>
            )}
          </span>
          <span className="theme-nom">{libelles[m]}</span>
        </button>
      ))}
    </div>
  );
}

export function ChoixCouleur({ libelle, titre }: { libelle: (a: Accent) => string; titre: string }) {
  const { accent, setAccent } = useTheme();
  return (
    <div className="accent-choix huit" role="radiogroup" aria-label={titre}>
      {ACCENTS.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={accent === a} className={`accent-option${accent === a ? ' active' : ''}`} onClick={() => setAccent(a)}>
          <span className={`accent-pastille accent-${a}`}>{accent === a && <IconCheck size={15} />}</span>
          <span>{libelle(a)}</span>
        </button>
      ))}
    </div>
  );
}
