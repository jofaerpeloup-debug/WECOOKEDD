import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  reload,
  updateProfile,
  verifyBeforeUpdateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  deleteUser,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'firebase/auth';
import { auth } from './firebase.js';

export function toAccount(user) {
  if (!user) return null;
  return {
    name: user.displayName || '',
    email: user.email || '',
    emailVerified: user.emailVerified,
  };
}

export async function signUp(name, email, password) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: name });
  await sendEmailVerification(user);
}

export async function logIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function logOutUser() {
  await signOut(auth);
}

export async function resendVerificationEmail() {
  await sendEmailVerification(auth.currentUser);
}

export async function refreshEmailVerified() {
  await reload(auth.currentUser);
  return auth.currentUser.emailVerified;
}

export async function updateUserProfile(name, email) {
  const user = auth.currentUser;
  await updateProfile(user, { displayName: name });
  if (email.trim().toLowerCase() !== (user.email || '').toLowerCase()) {
    await verifyBeforeUpdateEmail(user, email);
  }
  return toAccount(auth.currentUser);
}

export async function changeUserPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function deleteCurrentAccount(password) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
  await deleteUser(user);
}

export async function requestPasswordReset(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function verifyResetCode(oobCode) {
  return verifyPasswordResetCode(auth, oobCode);
}

export async function confirmReset(oobCode, newPassword) {
  await confirmPasswordReset(auth, oobCode, newPassword);
}
