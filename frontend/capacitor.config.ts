import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuration Capacitor pour empaqueter l'app web ORION en application native
 * iOS & Android (Play Store / App Store). Voir ../NATIVE.md pour l'installation et
 * la configuration complète des permissions et fonctionnalités natives.
 *
 * Les projets natifs sont générés (frontend/android, frontend/ios) : après `npm run build`,
 * lancer `npx cap sync` pour y copier l'app web.
 */
/**
 * Deux applications natives à partir du même code :
 * - ORION (clients) : par défaut, projets android/ et ios/ ;
 * - ORION Chauffeur : ORION_APP=chauffeur, projets chauffeur/android et chauffeur/ios,
 *   app web dist-chauffeur (driver.html devient la page d'accueil). Voir
 *   scripts/construire-app-chauffeur.mjs et NATIVE.md.
 */
const chauffeur = process.env.ORION_APP === 'chauffeur';
/**
 * APK de test temps réel (installées À PART des apps officielles, voir src/tempsReel.ts) :
 * ORION_APP=test-client → app client de test ; ORION_APP=test-console → mini console.
 */
const TESTS: Record<string, { appId: string; appName: string; webDir: string; path: string }> = {
  'test-client': { appId: 'ci.orion.test.client', appName: 'ORION Test', webDir: 'dist-test-client', path: 'test/client/android' },
  'test-console': { appId: 'ci.orion.test.console', appName: 'ORION Console test', webDir: 'dist-test-console', path: 'test/console/android' },
};
const test = TESTS[process.env.ORION_APP ?? ''];

const config: CapacitorConfig = {
  appId: test?.appId ?? (chauffeur ? 'ci.orion.chauffeur' : 'ci.orion.app'),
  appName: test?.appName ?? (chauffeur ? 'ORION Chauffeur' : 'ORION'),
  webDir: test?.webDir ?? (chauffeur ? 'dist-chauffeur' : 'dist'),
  backgroundColor: '#0c0d0f',
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Geolocation: {},
    LocalNotifications: { smallIcon: 'ic_stat_orion', iconColor: '#00e08a' },
  },
  ios: {
    ...(chauffeur ? { path: 'chauffeur/ios' } : {}),
    contentInset: 'always',
    // ProMotion / taux de rafraîchissement adaptatif (jusqu'à 120 Hz) géré par le système.
  },
  android: {
    ...(test ? { path: test.path } : chauffeur ? { path: 'chauffeur/android' } : {}),
    allowMixedContent: false,
  },
};

export default config;
