import {
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase.js';

export function subscribeRecipes(callback) {
  return onSnapshot(collection(db, 'recipes'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeUsers(callback) {
  return onSnapshot(collection(db, 'users'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function saveRecipeDoc(data) {
  const { id, ...fields } = data;
  if (id) {
    await updateDoc(doc(db, 'recipes', id), fields);
  } else {
    await addDoc(collection(db, 'recipes'), fields);
  }
}

export async function deleteRecipeDoc(id) {
  await deleteDoc(doc(db, 'recipes', id));
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
