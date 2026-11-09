import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Same Brophy Firebase project as the TeamHub app. Drills for this site live
// in their own `drillLibrary` collection — never the app's `drills` collection.
const firebaseConfig = {
  apiKey: "AIzaSyCsKiTGtjJmh9tCHCPQ82oUFLXnUcpUy6Q",
  authDomain: "brophy-soccer-app.firebaseapp.com",
  projectId: "brophy-soccer-app",
  storageBucket: "brophy-soccer-app.firebasestorage.app",
  messagingSenderId: "134702834848",
  appId: "1:134702834848:web:dc2c53a34cc542633995c5",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline-capable Firestore: recently-viewed drills stay available offline and
// coach writes queue + sync on reconnect (multi-tab safe).
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return initializeFirestore(app, {});
  }
})();
