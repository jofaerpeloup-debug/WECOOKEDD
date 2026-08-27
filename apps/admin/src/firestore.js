import {
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase.js';

// Recipes are fully REST-backed (see docs/architecture/admin-recipes-integration.md) —
// no recipe helpers here. Ingredients and substitutions were REST-only from the
// start. What remains below is the temporary Users / reports / seed layer,
// pending the Users / admin-management migration slice.

export function subscribeUsers(callback) {
  return onSnapshot(collection(db, 'users'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function saveUserDoc(data) {
  const { id, ...fields } = data;
  if (id) {
    await updateDoc(doc(db, 'users', id), fields);
  } else {
    await addDoc(collection(db, 'users'), fields);
  }
}

export async function deleteUserDoc(id) {
  await deleteDoc(doc(db, 'users', id));
}

export async function submitReportDoc(data) {
  await addDoc(collection(db, 'reports'), data);
}

export async function seedCollection(name, docs) {
  await Promise.all(docs.map(({ id, ...fields }) => setDoc(doc(db, name, id), fields)));
}
