import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.swipego.optitourbooth',
  appName: 'OptiTour',
  webDir: 'dist',
  server: {
    // L'APK charge le frontend déployé en direct → les correctifs web (Coolify)
    // arrivent automatiquement sans reconstruire/réinstaller l'APK.
    // NB: nécessite une connexion réseau au lancement (pas de repli hors-ligne).
    url: 'https://optitourbooth.swipego.app',
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#2563eb',
      showSpinner: true,
      spinnerColor: '#ffffff',
    },
    Geolocation: {
      // Enable background geolocation on Android
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
};

export default config;
