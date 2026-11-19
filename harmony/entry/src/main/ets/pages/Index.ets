import { webview } from '@kit.ArkWeb';
import { abilityAccessCtrl, common } from '@kit.AbilityKit';

/**
 * ORION Chauffeur sur HarmonyOS (Huawei).
 *
 * Même application web que sur Android, iPhone et le navigateur, affichée dans le moteur
 * ArkWeb de HarmonyOS. On ne réécrit rien : une correction publiée sur ORION arrive ici au
 * prochain lancement. Les voitures Huawey équipées de HarmonyOS peuvent donc héberger
 * l'app Chauffeur telle quelle (écran embarqué ou mode écran de véhicule).
 *
 * L'adresse par défaut est celle de l'app Chauffeur. Sur un écran embarqué, pointer plutôt
 * vers « vehicule.html » (mode paysage plein écran, appairage par code).
 */
const ADRESSE: string = 'https://chauffeur.orion.ci/driver.html';

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

  build() {
    Column() {
      Web({ src: ADRESSE, controller: this.controller })
        .domStorageAccess(true)        // sessions et préférences de l'app web
        .geolocationAccess(true)       // position du chauffeur
        .mediaPlayGestureAccess(false)
        .darkMode(WebDarkMode.Auto)    // suit le thème du véhicule / de l'appareil
        .cacheMode(CacheMode.Default)
        .width('100%')
        .height('100%')
        // L'app web gère ses propres liens ORION ; un lien externe (tel:, carte) part au système.
        .onGeolocationShow((event) => { event?.geolocation.invoke(event.origin, true, false); })
    }
    .width('100%')
    .height('100%')
  }
}
