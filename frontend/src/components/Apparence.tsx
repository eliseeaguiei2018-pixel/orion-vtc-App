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

/** Une ligne de réglage : titre, explication, interrupteur iOS. */
function Interrupteur({ titre, detail, actif, onChange }: { titre: string; detail: string; actif: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="reglage-interrupteur">
      <span className="col grow"><strong>{titre}</strong><small>{detail}</small></span>
      <button type="button" className={`toggle${actif ? ' on' : ''}`} role="switch" aria-checked={actif} aria-label={titre} onClick={() => onChange(!actif)}><span /></button>
    </div>
  );
}

/**
 * « Mêler les couleurs » : sous les pastilles, dans les deux styles. Activé, la couleur choisie
 * teinte légèrement les fonds, les surfaces et le haut de l'accueil (comme en version 2.6) ;
 * désactivé, l'app reste en blanc pur (ou noir pur en sombre).
 */
export function MelerCouleurs({ titre, detail }: { titre: string; detail: string }) {
  const { meler, setMeler } = useTheme();
  return <Interrupteur titre={titre} detail={detail} actif={meler} onChange={setMeler} />;
}

/** « Style Orion » : le dessin de la version 2.6.0 (icônes au trait, tuiles…), avec les tons de la 2.7. */
export function StyleOrion({ titre, detail }: { titre: string; detail: string }) {
  const { styleOrion, setStyleOrion } = useTheme();
  return <Interrupteur titre={titre} detail={detail} actif={styleOrion} onChange={setStyleOrion} />;
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
