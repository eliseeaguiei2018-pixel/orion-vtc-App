import { useI18n } from '../i18n';
import { formatXOF } from '../data';
import { IconPeage } from '../icons';
import { choixPropose, type ChoixItineraire, type Itineraires, type OptionItineraire } from '../itinerairesPeage';

/**
 * ITINÉRAIRE : PONT À PÉAGE OU VOIE NORMALE.
 *
 * Deux cartes côte à côte quand le trajet peut passer par un péage : durée avec le trafic,
 * distance, et ce que le péage ajoute au prix. Le choix change le tracé sur la carte et le
 * prix de chaque gamme. Sans voie normale possible (autoroute du Nord), une ligne dit que
 * le péage est compris dans le prix.
 */
export function ChoixRoute({ itineraires, choix, onChoix, compact = false }: {
  itineraires: Itineraires | null; choix: OptionItineraire | null; onChoix: (c: ChoixItineraire) => void; compact?: boolean;
}) {
  const { t, lang } = useI18n();
  if (!itineraires || !choix) return null;
  const km = (m: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(m / 1000);
  if (!choixPropose(itineraires)) {
    if (choix.choix !== 'peage' || choix.montantPeage <= 0) return null;
    return (
      <p className="route-inclus" role="status">
        <IconPeage size={16} /> <span>{t('route_peage_inclus', { nom: choix.peages.map((p) => p.nom).join(', ') })} · {formatXOF(choix.montantPeage)}</span>
      </p>
    );
  }
  const options = [itineraires.peage!, itineraires.normal!];
  return (
    <div className={`route-choix${compact ? ' compact' : ''}`} role="radiogroup" aria-label={t('route_titre')}>
      {options.map((o) => {
        const actif = o.choix === choix.choix;
        const titre = o.choix === 'normal' ? t('route_normale') : o.peages.some((p) => p.pont) ? t('route_pont') : t('route_autoroute');
        return (
          <button key={o.choix} type="button" role="radio" aria-checked={actif} className={`route-option${actif ? ' active' : ''}`} onClick={() => onChoix(o.choix)}>
            <span className="route-tete">
              {o.choix === 'peage' && <IconPeage size={15} />}
              <strong>{titre}</strong>
            </span>
            <span className="route-duree">{Math.max(1, Math.round(o.route.durationSeconds / 60))} {t('est_min')} · {km(o.route.distanceMeters)} km</span>
            <span className="route-cout">{o.choix === 'peage' ? t('route_peage_plus', { montant: formatXOF(o.montantPeage) }) : t('route_sans_peage')}</span>
            {!compact && o.choix === 'peage' && <span className="route-via">{o.peages.map((p) => p.nom).join(' · ')}</span>}
          </button>
        );
      })}
    </div>
  );
}
