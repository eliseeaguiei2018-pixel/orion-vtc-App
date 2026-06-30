import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Configuration Capacitor pour empaqueter l'app web ORION en application native
 * iOS & Android (Play Store / App Store). Voir ../NATIVE.md pour l'installation et
 * la configuration complète des permissions et fonctionnalités natives.
 *
 * Activation : `npm i @capacitor/core @capacitor/cli && npx cap init` puis `npx cap add ios|android`.
 */
const config: CapacitorConfig = {
  appId: 'ci.orion.app',
  appName: 'ORION',
  webDir: 'dist',
  backgroundColor: '#04100b',
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Geolocation: {},
    LocalNotifications: { smallIcon: 'ic_stat_orion', iconColor: '#00e08a' },
  },
  ios: {
    contentInset: 'always',
    // ProMotion / taux de rafraîchissement adaptatif (jusqu'à 120 Hz) géré par le système.
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
