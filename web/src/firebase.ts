import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC7ynej0nGJas9me9M5oW6jHfLsWe5gHbU",
  authDomain: "monsoonfire-portal.firebaseapp.com",
  projectId: "monsoonfire-portal",
  storageBucket: "monsoonfire-portal.firebasestorage.app",
  messagingSenderId: "667865114946",
  appId: "1:667865114946:web:7275b02c9345aa975200db",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
