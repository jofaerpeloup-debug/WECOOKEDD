import {
  signInWithEmailAndPassword,
  signOut,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from 'firebase/auth';
import { auth } from './firebase.js';

export async function logIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function logOutUser() {
  await signOut(auth);
}

// Temporary SP2B compatibility only. Backend identity/name/password authority
// no longer flows through this module; Firebase remains solely for the legacy
// email-change and account-delete surfaces until their REST cutover.
export async function requestUserEmailChange(email) {
  const user = auth.currentUser;
  if (!user) throw new Error('Legacy email change is unavailable for this account.');
  await verifyBeforeUpdateEmail(user, email.trim());
}

export async function deleteCurrentAccount(password) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  await deleteUser(user);
}
