import { db } from "../firebase";
import { collection, doc, getDoc, getDocs, limit, query, orderBy, startAfter, where } from "firebase/firestore";

const COL = "products";

export async function getProductsPage(cursor = null, pageSize = 50) {
  const constraints = [orderBy("createdAt", "desc"), limit(pageSize)];
  if (cursor) constraints.splice(1, 0, startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, COL), ...constraints));
  return {
    products: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.size === pageSize,
  };
}

export async function getProductById(productId) {
  const snapshot = await getDoc(doc(db, COL, productId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function getRelatedProducts(category, productId) {
  if (!category) return [];
  const snapshot = await getDocs(query(collection(db, COL), where("category", "==", category), limit(6)));
  return snapshot.docs
    .filter((document) => document.id !== productId)
    .map((document) => ({ id: document.id, ...document.data() }))
    .slice(0, 4);
}