import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";

type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_AUTH_DOMAIN?: string;
  VITE_DEBUG_TOOLS?: string;
  VITE_USE_EMULATORS?: string;
  VITE_USE_AUTH_EMULATOR?: string;
  VITE_USE_FIRESTORE_EMULATOR?: string;
  VITE_AUTH_EMULATOR_HOST?: string;
  VITE_AUTH_EMULATOR_PORT?: string;
  VITE_FIRESTORE_EMULATOR_HOST?: string;
  VITE_FIRESTORE_EMULATOR_PORT?: string;
};
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

const DEFAULT_AUTH_DOMAIN = "monsoonfire-portal.firebaseapp.com";
const AUTH_DOMAIN =
  typeof import.meta !== "undefined" && ENV.VITE_AUTH_DOMAIN
    ? String(ENV.VITE_AUTH_DOMAIN)
    : DEFAULT_AUTH_DOMAIN;

const firebaseConfig = {
  apiKey: "AIzaSyC7ynej0nGJas9me9M5oW6jHfLsWe5gHbU",
  authDomain: AUTH_DOMAIN,
  projectId: "monsoonfire-portal",
  storageBucket: "monsoonfire-portal.firebasestorage.app",
  messagingSenderId: "667865114946",
  appId: "1:667865114946:web:7275b02c9345aa975200db",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Force long polling to avoid watch stream teardown races seen during rapid nav in dev.
// This is emulator-safe and still works against prod.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

const USE_AUTH_EMULATOR =
  typeof import.meta !== "undefined" &&
  (ENV.VITE_USE_AUTH_EMULATOR ?? ENV.VITE_USE_EMULATORS) === "true";
const USE_FIRESTORE_EMULATOR =
  typeof import.meta !== "undefined" &&
  (ENV.VITE_USE_FIRESTORE_EMULATOR ?? ENV.VITE_USE_EMULATORS) === "true";
const ENABLE_DEBUG_TOOLS =
  typeof import.meta !== "undefined" &&
  (ENV.DEV === true || ENV.VITE_DEBUG_TOOLS === "true");

function attachDebugTools() {
  if (typeof window === "undefined") return;
  const runtimeWindow = window as Window & {
    mfDebug?: {
      getIdToken: () => Promise<string>;
      getUid: () => string;
      isSignedIn: () => boolean;
    };
  };

  if (!ENABLE_DEBUG_TOOLS) {
    delete runtimeWindow.mfDebug;
    return;
  }

  runtimeWindow.mfDebug = {
    getIdToken: async () => {
      const user = auth.currentUser;
      if (!user) {
        return "No authenticated Firebase user. Sign in to the portal first.";
      }
      return user.getIdToken();
    },
    getUid: () => auth.currentUser?.uid ?? "No authenticated Firebase user.",
    isSignedIn: () => Boolean(auth.currentUser),
  };
}

if (USE_AUTH_EMULATOR) {
  const authHost = String(ENV.VITE_AUTH_EMULATOR_HOST || "127.0.0.1");
  const authPort = Number(ENV.VITE_AUTH_EMULATOR_PORT || 9099);
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
}

if (USE_FIRESTORE_EMULATOR) {
  const host = String(ENV.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1");
  const port = Number(ENV.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  connectFirestoreEmulator(db, host, port);
}

attachDebugTools();
