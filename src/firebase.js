import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// Replaced getFirestore with initializeFirestore for advanced cache management
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDupGOm4Ubay7wKIoRVMYpp0UUyBEZme1g",
  authDomain: "partswalaflutter.firebaseapp.com",
  projectId: "partswalaflutter",
  storageBucket: "partswalaflutter.firebasestorage.app",
  messagingSenderId: "125136160557",
  appId: "1:125136160557:web:b494fc2e2aa796958b35a4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_PHONE_AUTH_TESTING === "true") {
  auth.settings.appVerificationDisabledForTesting = true;
}

// Enabled offline persistence storage so Firestore caches data directly in the browser
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager() // Keeps data synced perfectly if you open the app in multiple browser tabs
  })
});
