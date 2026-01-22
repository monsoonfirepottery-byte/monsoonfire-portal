import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaREDACTED",
  authDomain: "monsoonfire-portal.firebaseapp.com",
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
