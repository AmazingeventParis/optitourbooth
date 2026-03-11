import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.swipego.optitourbooth',
  appName: 'OptiTour',
  webDir: 'dist',
  server: {
    // In production, the app loads from the built files
    // For dev, uncomment to use live reload:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
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
