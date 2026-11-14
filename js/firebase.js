// The only file that touches the Firebase SDK. Keep the version in sync with SDK in sw.js.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

export { onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
export { collection, getDocs, Timestamp, onSnapshot, setDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const itemsCol = collection(db, "items");
export const catsCol = collection(db, "categories");
export const mealsCol = collection(db, "meals");
export const recipesCol = collection(db, "recipes");
export const productsCol = collection(db, "products");
