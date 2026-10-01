import { collection, doc, documentId, getDoc, getDocs, limit, query, orderBy, startAfter, where } from "firebase/firestore";
import { db } from "../firebase";
import { disableAdminCoupon, saveAdminCoupon } from "./orderService";

export async function getAdminProductsPage(cursor = null) {
  const constraints = [orderBy(documentId()), limit(100)];
  if (cursor) constraints.splice(1, 0, startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, "products"), ...constraints));
  const productIds = snapshot.docs.map((product) => product.id);
  const linkSnapshots = [];
  for (let index = 0; index < productIds.length; index += 30) {
    linkSnapshots.push(await getDocs(query(
      collection(db, "vendorProductLinks"),
      where("productId", "in", productIds.slice(index, index + 30)),
    )));
  }
  const vendorByProductId = new Map(linkSnapshots.flatMap((links) => links.docs.map((link) => [link.data().productId, link.data().vendorId])));
  const costSnapshots = await Promise.all(productIds.map((productId) => getDoc(doc(db, "productCosts", productId))));
  const costByProductId = new Map(costSnapshots.filter((cost) => cost.exists()).map((cost) => [cost.id, cost.data().costPrice]));
  const products = snapshot.docs.map((document) => {
    const product = document.data();
    const vendorId = product.sellerId || vendorByProductId.get(document.id);
    return {
      id: document.id,
      ...product,
      costPrice: costByProductId.get(document.id) ?? "",
      sellerId: vendorId || "partswala",
      sellerType: product.sellerType || (vendorId ? "vendor" : "partswala"),
    };
  });
  return { products, cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.size === 100 };
}

export async function getAdminUsersPage(cursor = null) {
  const constraints = [orderBy(documentId()), limit(100)];
  if (cursor) constraints.splice(1, 0, startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, "users"), ...constraints));
  return {
    users: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.size === 100,
  };
}

export async function getAdminRecordsPage(collectionName, orderField, cursor = null) {
  const constraints = [orderBy(orderField, "desc"), limit(100)];
  if (cursor) constraints.splice(1, 0, startAfter(cursor));
  const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
  return {
    records: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.size === 100,
  };
}

// --- Coupon Administration ---
export async function addCoupon(code, discountPercentage) {
  const cleanCode = code.toUpperCase().trim();
  const rate = parseFloat(discountPercentage);
  if (!cleanCode || !Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("Invalid parameters");
  await saveAdminCoupon(cleanCode, { type: "percentage", value: rate, active: true });
  return true;
}

export async function removeCoupon(code) {
  const cleanCode = code.toUpperCase().trim();
  await disableAdminCoupon(cleanCode, "Disabled by admin");
}