// Always "logged in" as a test user.
const user = { email: "test@example.com" };
export const getAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (a, cb) => setTimeout(() => cb(user), 0);
export const signInWithEmailAndPassword = async () => {}, signOut = async () => {}, signInWithPopup = async () => {};
export class GoogleAuthProvider {}
