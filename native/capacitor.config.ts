import type { CapacitorConfig } from '@capacitor/cli';
import { appUrl } from './scripts/app-url.mjs';

// Ledger's iOS and Android apps (docs/NATIVE_MIGRATION.md). Phase 1: a native shell around
// the live web app — the same code, origin, sign-in and data as https://ledger.sgj.luxe.
const url: string = appUrl();
const host = new URL(url).hostname;

const config: CapacitorConfig = {
  appId: 'luxe.sgj.ledger',
  appName: 'Ledger',
  webDir: 'www',
  // Ledger's dark ground, behind the page while it loads (and the splash)
  backgroundColor: '#0e0b08',
  server: {
    url,
    // shown when the page can't load (no connection): bundled, so it always works
    errorPath: 'offline.html',
    // Firebase Auth's helper frame lives on the project's auth domain: it must load in
    // the app, never be handed to the system browser. Everything else off-site opens
    // outside Ledger, as on the web.
    allowNavigation: ['ledger-6aec3.firebaseapp.com'],
    // plain http only for a development server on this network (never production)
    cleartext: url.startsWith('http://'),
  },
  ios: {
    // the page itself handles the notch and home indicator (viewport-fit=cover + env())
    contentInset: 'never',
  },
  plugins: {
    // Edge to edge: the page receives correct env(safe-area-inset-*) values, as on iOS
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
    SplashScreen: {
      launchShowDuration: 700,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#0e0b08',
      showSpinner: false,
    },
    Keyboard: {
      // the web view shrinks above the keyboard, so a sheet's field stays in view
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

if (host !== 'ledger.sgj.luxe') console.warn('[ledger] This build loads ' + url + ' — not production.');

export default config;
