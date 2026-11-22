import { useI18n } from '../i18n';
import { Objet, Scooter, Tuile, Voiture } from './Vehicules';

/**
 * VOLET SERVICES — tout ce qu'ORION propose, au même endroit.
 *
 * Les mêmes objets en volume que sur l'accueil, sur des pastilles rondes. Les services pas
 * encore ouverts (Food, Achat & Vente, Supermarché) n'y figurent pas : ils reviendront depuis
 * la console, sans mise à jour de l'application.
 */
export function ServicesScreen({ ferme, livraisonOff, assurance, onCourse, onReserver, onLivraison, onAbonnement, onLocation, onMariage, onAssurance }: {
  /** ORION momentanément fermé (maintenance) : les commandes sont grisées. */
  ferme: boolean; livraisonOff: boolean;
  /** ORION Assurance demande un compte : absente pour un visiteur. */
  assurance: boolean;
  onCourse: () => void; onReserver: () => void; onLivraison: () => void;
  onAbonnement: () => void; onLocation: () => void; onMariage: () => void; onAssurance: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="screen page services">
      <div className="page-body hub-body services-corps">
        <h1 className="volet-titre rise">{t('nav_services')}</h1>
        <p className="volet-sous rise">{t('srv2_sous')}</p>

        <span className="eyebrow rise rise-2">{t('srv2_deplacer')}</span>
        <div className="tuiles quatre rondes rise rise-2">
          <Tuile ronde off={ferme} rang={0} objet={<Voiture modele="berline" peinture="accent" largeur={120} accueil />} label={t('svc_course')} onClick={onCourse} />
          <Tuile ronde off={ferme} rang={1} objet={<Objet nom="reserver" volume />} label={t('svc_reserver')} onClick={onReserver} />
          {!livraisonOff && <Tuile ronde off={ferme} rang={2} objet={<Scooter largeur={104} accueil />} label={t('svc_delivery')} onClick={onLivraison} />}
          {!livraisonOff && <Tuile ronde off={ferme} rang={3} objet={<Objet nom="colis" volume />} label={t('svc_colis')} onClick={onLivraison} />}
        </div>

        <span className="eyebrow rise rise-3">{t('srv2_formules')}</span>
        <div className="tuiles quatre rondes rise rise-3">
          <Tuile ronde rang={4} objet={<Objet nom="abonnement" volume />} label={t('menu_subscription')} onClick={onAbonnement} />
          <Tuile ronde rang={5} objet={<Objet nom="location" volume />} label={t('rent_entry')} onClick={onLocation} />
          <Tuile ronde rang={6} objet={<Objet nom="mariage" volume />} label={t('menu_wedding')} onClick={onMariage} />
          {assurance && <Tuile ronde rang={7} objet={<Objet nom="protection" volume />} label={t('as_title')} onClick={onAssurance} />}
        </div>
      </div>
    </div>
  );
}
