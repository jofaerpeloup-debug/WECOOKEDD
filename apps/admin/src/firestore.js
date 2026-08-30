import { collection, addDoc } from 'firebase/firestore';
import { db } from './firebase.js';

// Ingredients, substitutions, recipes, and users are all REST-backed now (see
// docs/architecture/admin-api-integration.md) — no business-data helpers here.
// What remains is the temporary "Report a problem" writer, pending its own
// migration slice.

export async function submitReportDoc(data) {
  await addDoc(collection(db, 'reports'), data);
}