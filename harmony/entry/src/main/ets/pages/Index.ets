import { webview } from '@kit.ArkWeb';
import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { call } from '@kit.TelephonyKit';
import { deviceInfo } from '@kit.BasicServicesKit';

/**
 * ORION Chauffeur sur HarmonyOS (Huawei).
 *
 * Même application web que sur Android, iPhone et le navigateur, affichée dans le moteur
 * ArkWeb de HarmonyOS. On ne réécrit rien : une correction publiée sur ORION arrive ici au
 * prochain lancement. Les voitures équipées de HarmonyOS peuvent donc héberger
 * l'app Chauffeur telle quelle (écran embarqué ou mode écran de véhicule).
 *
 * L'adresse dépend de l'appareil : l'app Chauffeur sur téléphone et tablette, le mode
 * écran de véhicule (paysage plein écran, appairage par code) sur l'écran d'une voiture.
 */
// Écran embarqué d'une voiture (appareil de type « car ») : directement le mode écran de
// véhicule (plein écran paysage, appairage par code) ; téléphone et tablette : l'app Chauffeur.
const ADRESSE: string = deviceInfo.deviceType === 'car'
  ? 'https://chauffeur.orion.ci/vehicule.html'
  : 'https://chauffeur.orion.ci/driver.html';
/** Seule origine autorisée à s'afficher dans l'app et à lire la position. */
const ORIGINE: string = 'https://chauffeur.orion.ci';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    // La position sert au dispatch et à la navigation guidée : on demande l'accès à l'ouverture.
    const ctx = getContext(this) as common.UIAbilityContext;
    abilityAccessCtrl.createAtManager()
      .requestPermissionsFromUser(ctx, ['ohos.permission.APPROXIMATELY_LOCATION', 'ohos.permission.LOCATION'])
      .catch((e: Object) => console.error(`ORION: permission position refusée: ${e}`));
  }

  /** Bouton retour (téléphone, tablette, écran de véhicule) : page précédente de l'app. */
  onBackPress(): boolean {
    if (this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    return false;
  }

  /**
   * Liens sortants. « Appeler » ouvre le CLAVIER du système avec le numéro composé (le
   * chauffeur appuie lui-même sur appeler) ; un lien hors ORION (itinéraire, site externe)
   * s'ouvre dans l'application du système, jamais dans l'app (pas de page tierce déguisée).
   */
  private intercepter(url: string): boolean {
    if (url.startsWith('tel:')) {
      const numero = decodeURIComponent(url.substring(4)).replace(/[^0-9+]/g, '');
      call.makeCall(numero).catch((e: Object) => console.error(`ORION: clavier indisponible: ${e}`));
      return true;
    }
    if (url.startsWith(ORIGINE + '/') || url === ORIGINE) return false;
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.openLink(url, { appLinkingOnly: false })
      .catch((e: Object) => console.error(`ORION: lien externe non ouvert: ${e}`));
    return true;
  }

  build() {
    Column() {
      Web({ src: ADRESSE, controller: this.controller })
        .domStorageAccess(true)        // sessions et préférences de l'app web
        .geolocationAccess(true)       // position du chauffeur
        .fileAccess(false)             // aucun accès aux fichiers de l'appareil
        .mixedMode(MixedMode.None)     // jamais de contenu HTTP dans une page HTTPS
        .mediaPlayGestureAccess(false)
        .darkMode(WebDarkMode.Auto)    // suit le thème du véhicule / de l'appareil
        .cacheMode(CacheMode.Default)
        .width('100%')
        .height('100%')
        .onLoadIntercept((event) => this.intercepter(event.data.getRequestUrl()))
        // La position n'est donnée qu'à ORION, pour la durée de la session.
        .onGeolocationShow((event) => {
          event?.geolocation.invoke(event.origin, event.origin === ORIGINE, false);
        })
    }
    .width('100%')
    .height('100%')
  }
}
