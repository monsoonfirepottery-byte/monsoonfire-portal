import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaREDACTED",
  authDomain: "monsoonfire-portal.firebaseapp.com",
  projectId: "monsoonfire-portal",
  storageBucket: "monsoonfire-portal.firebasestorage.app",
  messagingSenderId: "667865114946",
  appId: "1:667865114946:web:7275b02c9345aa975200db",
};

const app = initializeApp(firebaseConfig);
type ImportMetaEnvShape = {
  VITE_USE_EMULATORS?: string;
  VITE_AUTH_EMULATOR_HOST?: string;
  VITE_AUTH_EMULATOR_PORT?: string;
  VITE_FIRESTORE_EMULATOR_HOST?: string;
  VITE_FIRESTORE_EMULATOR_PORT?: string;
};
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Force long polling to avoid watch stream teardown races seen during rapid nav in dev.
// This is emulator-safe and still works against prod.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

if (typeof import.meta !== "undefined" && ENV.VITE_USE_EMULATORS === "true") {
  const authHost = String(ENV.VITE_AUTH_EMULATOR_HOST || "127.0.0.1");
  const authPort = Number(ENV.VITE_AUTH_EMULATOR_PORT || 9099);
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });

  const host = String(ENV.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1");
  const port = Number(ENV.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  connectFirestoreEmulator(db, host, port);
}
