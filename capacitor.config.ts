import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Bundle ID; must match the App ID registered for the personal team.
  appId: 'com.dustrunner.app',
  appName: 'Dust Runner',
  webDir: 'dist',
  backgroundColor: '#05080F',
  ios: {
    // Let the page handle the notch itself (it reads env(safe-area-inset-*)).
    contentInset: 'never',
    // The game is one fixed screen: no rubber-band scrolling.
    scrollEnabled: false,
    backgroundColor: '#05080F',
  },
};

export default config;
