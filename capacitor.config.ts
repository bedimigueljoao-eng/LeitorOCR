import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.roletavision.app',
  appName: 'RoletaVision',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
