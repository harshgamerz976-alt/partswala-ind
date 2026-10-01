import { calculateShipmentEstimate } from "../../src/services/shippingService.js";
import { buildFinanceTotals, settlementStatusFor } from "../finance.js";
import { canUseAssistantTool } from "./authorization.js";

const PRODUCT_CACHE_TTL = 30_000;
export const AI_PRODUCT_CACHE_MAX = 1000;
const STOP_WORDS = new Set(["the", "and", "for", "with", "need", "find", "show", "help", "part", "parts", "is", "a", "an", "my", "me", "please", "what", "which", "does", "do", "have", "available", "price", "cost"]);
let productCache = { expiresAt: 0, products: [] };
let productRequest = null;

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function asProduct(document) {
  return { id: document.id, ...document.data() };
}

async function allProducts(db) {
  if (Date.now() < productCache.expiresAt) return productCache.products;
  if (!productRequest) {
    const productCollection = db.collection("products");
    const productQuery = typeof productCollection.limit === "function" ? productCollection.limit(AI_PRODUCT_CACHE_MAX) : productCollection;
    productRequest = productQuery.get().then((snapshot) => {
      return snapshot.docs.map(asProduct);
    }).then(async (products) => {
      const legacy = products.filter((product) => !product.sellerType);
      for (let index = 0; index < legacy.length; index += 30) {
        const batch = legacy.slice(index, index + 30);
        if (!batch.length) continue;
        const links = await db.collection("vendorProductLinks").where("productId", "in", batch.map((product) => product.id)).get();
        for (const link of links.docs) {
          const data = link.data();
          const product = products.find((item) => item.id === (data.productId || link.id));
          if (product && data.vendorId) {
            product.sellerId = data.vendorId;
            product.sellerType = "vendor";
          }
        }
      }
      for (const product of legacy) {
        if (!product.sellerType) {
          product.sellerType = "partswala";
          product.sellerId = "partswala";
        }
      }
      productCache = { products, expiresAt: Date.now() + PRODUCT_CACHE_TTL };
      return products;
    }).finally(() => { productRequest = null; });
  }
  return productRequest;
}

function publicProduct(product) {
  const sellerType = product.sellerType === "vendor" ? "vendor" : "partswala";
  return {
    id: product.id,
    name: product.name || product.title || "Product name not listed",
    brand: product.brand || "",
    partNumber: product.partNumber || product.sku || "",
    sku: product.sku || "",
    category: product.category || "",
    price: product.price ?? null,
    mrp: product.mrp ?? null,
    gstRate: product.gstRate ?? null,
    stock: product.stock ?? product.stockCount ?? null,
    compatibility: product.compatibility || "",
    weight: product.weight ?? null,
    dimensions: product.dimensions || {},
    seller: sellerType === "partswala" ? "PARTSWALA" : product.vendorName || "Marketplace vendor",
    sellerType,
    imageUrl: product.imageUrl || product.images?.[0] || "",
    description: product.description || "",
    warranty: product.warranty || product.warrantyPeriod || "",
    specifications: product.specifications || product.specs || null,
  };
}

export function searchCatalogProducts(products, query, { maxPrice, vehicle } = {}) {
  const terms = normalize(query).split(" ").filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  if (!terms.length) return [];
  const vehicleText = normalize([vehicle?.manufacturer, vehicle?.model, vehicle?.variant, vehicle?.year, vehicle?.engine].filter(Boolean).join(" "));
  return products
    .filter((product) => product.enabled !== false && !["disabled", "rejected", "pending"].includes(String(product.status || "").toLowerCase()))
    .map((product) => {
      const searchable = normalize([
        product.name, product.title, product.partNumber, product.sku, product.brand,
        product.category, product.description, product.compatibility,
      ].filter(Boolean).join(" "));
      const score = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0)
        + (vehicleText && normalize(product.compatibility).includes(vehicleText) ? 4 : 0);
      return { product, score };
    })
    .filter(({ product, score }) => score > 0 && (maxPrice == null || Number(product.price) <= Number(maxPrice)))
    .sort((left, right) => right.score - left.score || Number(right.product.stock || 0) - Number(left.product.stock || 0))
    .slice(0, 5)
    .map(({ product }) => ({ ...publicProduct(product), compatibilityStatus: vehicle ? compatibilityStatus(product, vehicle) : "unknown" }));
}

export function compatibilityStatus(product, vehicle) {
  const fitment = normalize(product.compatibility);
  if (!fitment) return "unknown";
  const requested = [vehicle?.manufacturer, vehicle?.model, vehicle?.variant, vehicle?.year, vehicle?.engine].filter(Boolean).map(normalize);
  if (!requested.length) return "unknown";
  return requested.every((value) => fitment.includes(value)) ? "verified" : "unconfirmed";
}

function publicOrder(document) {
  const order = asProduct(document);
  const tracking = order.tracking || {};
  return {
    id: order.id,
    orderNumber: order.orderNumber || order.id,
    createdAt: order.createdAt || null,
    status: order.status || order.orderStatus || "unknown",
    paymentStatus: order.paymentStatus || "unknown",
    paymentMethod: order.paymentMethod || "unknown",
    total: order.grandTotal ?? order.totalAmount ?? order.total ?? null,
    subtotal: order.subtotal ?? null,
    discount: order.discount ?? null,
    gst: order.gstTotal ?? null,
    shipping: order.shippingCharge ?? order.shipping ?? null,
    codFee: order.codFee ?? null,
    refundedAmount: order.refundedAmount ?? order.refundAmount ?? 0,
    refundStatus: order.refundStatus || "none",
    tracking: { carrier: tracking.carrier || "", awb: tracking.awb || "", estimatedDelivery: tracking.estimatedDelivery || null },
    items: (order.items || []).map((item) => ({ name: item.name || item.productName || item.title || "Part", quantity: item.quantity || 1 })),
  };
}

async function getUserOrders(db, actor, orderId) {
  if (!actor.user?.uid) return { needsLogin: true, orders: [] };
  if (actor.role === "vendor") {
    const rows = await vendorSettlementRows(db, actor.user.uid);
    const grouped = new Map();
    for (const row of rows) {
      if (orderId && row.orderId !== orderId && row.orderNumber !== orderId) continue;
      const order = grouped.get(row.orderId) || {
        id: row.orderId,
        orderNumber: row.orderNumber || row.orderId,
        createdAt: row.createdAt || null,
        status: row.orderStatus || "unknown",
        paymentStatus: row.paymentStatus || "unknown",
        paymentMethod: "not available",
        total: null,
        items: [],
      };
      if (row.productName) order.items.push({ name: row.productName });
      grouped.set(row.orderId, order);
    }
    return { orders: [...grouped.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 5) };
  }
  if (actor.role === "admin") {
    const snapshot = await db.collection("orders").get();
    return { orders: snapshot.docs.map(publicOrder).filter((order) => !orderId || order.id === orderId || order.orderNumber === orderId).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 5) };
  }
  const snapshot = await db.collection("orders").where("userId", "==", actor.user.uid).get();
  const orders = snapshot.docs.map(publicOrder)
    .filter((order) => !orderId || order.id === orderId || order.orderNumber === orderId)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 5);
  return { orders };
}

async function vendorSettlementRows(db, vendorId) {
  const snapshot = await db.collection("vendorSettlements").where("vendorId", "==", vendorId).get();
  return snapshot.docs.map((document) => {
    const row = document.data();
    return { id: document.id, ...row, settlementStatus: settlementStatusFor({ orderStatus: row.orderStatus, paymentStatus: row.paymentStatus, eligibleAt: row.eligibleAt, currentStatus: row.settlementStatus }) };
  }).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

function vendorBalances(rows) {
  const sum = (status) => Number(rows.filter((row) => row.settlementStatus === status).reduce((total, row) => total + Number(row.vendorPayout || 0), 0).toFixed(2));
  return {
    pending: sum("pending") + sum("held"),
    payable: sum("payable"),
    paid: Number(rows.filter((row) => row.settlementStatus === "paid" || Number(row.paidAmount || 0) > 0).reduce((total, row) => total + Number(row.paidAmount || 0), 0).toFixed(2)),
  };
}

function payoutStatusReason(row) {
  if (row.settlementStatus === "paid") return "Marked paid in settlement records.";
  if (row.settlementStatus === "held") return "Held in settlement records.";
  if (row.settlementStatus === "refunded") return "Reversed for a refund or cancellation.";
  if (!["delivered", "completed"].includes(String(row.orderStatus || "").toLowerCase())) return "Awaiting order delivery.";
  if (!["paid", "cod collected"].includes(String(row.paymentStatus || "").toLowerCase())) return "Awaiting confirmed payment collection.";
  if (!row.eligibleAt) return "Settlement eligibility date is not recorded yet.";
  if (new Date(row.eligibleAt).getTime() > Date.now()) return `Settlement hold ends ${new Date(row.eligibleAt).toLocaleDateString("en-IN")}.`;
  return "Settlement status is pending an update.";
}

async function getVendorSales(db, actor) {
  if (actor.role === "vendor") {
    const rows = await vendorSettlementRows(db, actor.user.uid);
    const today = new Date().toISOString().slice(0, 10);
    return {
      seller: "Your account",
      todaySales: rows.filter((row) => String(row.createdAt || "").slice(0, 10) === today).reduce((sum, row) => sum + Number(row.sellerSubtotal || 0), 0),
      totalSales: rows.reduce((sum, row) => sum + Number(row.sellerSubtotal || 0), 0),
      commission: rows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0),
      payout: vendorBalances(rows),
    };
  }
  const snapshot = await db.collection("vendorSettlements").get();
  const grouped = new Map();
  for (const document of snapshot.docs) {
    const row = document.data();
    const current = grouped.get(row.vendorId) || { vendorId: row.vendorId, sales: 0, commission: 0, payout: 0, orders: new Set() };
    current.sales += Number(row.sellerSubtotal || 0);
    current.commission += Number(row.commissionAmount || 0);
    current.payout += Number(row.vendorPayout || 0);
    if (row.orderId) current.orders.add(row.orderId);
    grouped.set(row.vendorId, current);
  }
  return [...grouped.values()].map((row) => ({ ...row, orders: row.orders.size }));
}

async function getVendorPayout(db, actor) {
  if (actor.role === "vendor") {
    const rows = await vendorSettlementRows(db, actor.user.uid);
    return { balances: vendorBalances(rows), settlements: rows.slice(0, 10).map((row) => ({
      id: row.id,
      orderId: row.orderId,
      productName: row.productName,
      vendorPayout: row.vendorPayout,
      commissionAmount: row.commissionAmount,
      settlementStatus: row.settlementStatus,
      statusReason: payoutStatusReason(row),
      createdAt: row.createdAt,
    })) };
  }
  const snapshot = await db.collection("vendorSettlements").get();
  const rows = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  return rows.reduce((summary, row) => {
    const status = settlementStatusFor({ ...row, currentStatus: row.settlementStatus });
    if (status === "pending" || status === "held") summary.pending += Number(row.vendorPayout || 0);
    if (status === "payable") summary.payable += Number(row.vendorPayout || 0);
    if (status === "paid") summary.paid += Number(row.paidAmount || row.vendorPayout || 0);
    return summary;
  }, { pending: 0, payable: 0, paid: 0 });
}

async function getLowStockProducts(db, actor) {
  const products = await allProducts(db);
  let owned = products;
  if (actor.role === "vendor") {
    const [linked, direct] = await Promise.all([
      db.collection("vendorProductLinks").where("vendorId", "==", actor.user.uid).get(),
      Promise.resolve(products.filter((product) => product.sellerId === actor.user.uid)),
    ]);
    const ids = new Set([...linked.docs.map((document) => document.data().productId || document.id), ...direct.map((product) => product.id)]);
    owned = products.filter((product) => ids.has(product.id));
  }
  return owned.filter((product) => product.stock != null && Number(product.stock) <= 5).map(publicProduct);
}

async function getAdminFinance(db) {
  const [orderSnapshot, settlementSnapshot] = await Promise.all([db.collection("orders").get(), db.collection("vendorSettlements").get()]);
  const orders = orderSnapshot.docs.map(asProduct);
  const settlements = settlementSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const activeOrders = orders.filter((order) => order.status !== "cancelled");
  const items = activeOrders.flatMap((order) => order.items || []);
  const sum = (selector) => Number(activeOrders.reduce((total, order) => total + Number(selector(order) || 0), 0).toFixed(2));
  const finance = buildFinanceTotals(items, {
    shippingChargedToCustomer: sum((order) => order.shippingChargedToCustomer ?? order.shippingCharge),
    shippingRefundAmount: sum((order) => order.shippingRefundAmount),
    codFeeAmount: sum((order) => order.codFee),
    codFeeRefundAmount: sum((order) => order.codFeeRefundAmount),
    actualShippingCost: activeOrders.some((order) => order.actualShippingCost == null) ? null : sum((order) => order.actualShippingCost),
    paymentGatewayFee: sum((order) => order.paymentGatewayFee),
    paymentGatewayTax: sum((order) => order.paymentGatewayTax),
    refundAmount: sum((order) => order.refundedAmount ?? order.refundAmount),
    shippingDifferencePolicy: orders[0]?.finance?.shippingDifferencePolicy || "absorb",
  });
  const payout = (statuses) => Number(settlements.filter((row) => statuses.includes(settlementStatusFor({ ...row, currentStatus: row.settlementStatus }))).reduce((total, row) => total + Number(row.vendorPayout || 0), 0).toFixed(2));
  const today = new Date().toISOString().slice(0, 10);
  return {
    todaySales: sum((order) => String(order.createdAt || "").slice(0, 10) === today ? order.grandTotal || order.totalAmount : 0),
    totalSales: sum((order) => order.grandTotal || order.totalAmount),
    grossCustomerCollections: sum((order) => order.grandTotal || order.totalAmount),
    productSubtotal: finance.vendorSales + finance.partswalaSales,
    taxesCollected: finance.taxesCollected,
    vendorSales: finance.vendorSales,
    partswalaSales: finance.partswalaSales,
    pendingVendorPayouts: payout(["pending", "held"]),
    payableVendorAmount: payout(["payable"]),
    paidVendorAmount: payout(["paid"]),
    platformCommission: finance.platformCommission,
    platformRevenue: finance.platformRevenue,
    shippingCollected: finance.shippingCollectedNet,
    actualShippingCost: finance.actualShippingCost,
    paymentGatewayFees: finance.paymentGatewayFee,
    paymentGatewayTax: finance.paymentGatewayTax,
    refunds: finance.refundAmount,
    refundsToday: Number(orders.filter((order) => order.refundActivity?.date === today).reduce((total, order) => total + Number(order.refundActivity.amount || 0), 0).toFixed(2)),
    codFee: sum((order) => order.codFee),
    tcsAmount: finance.tcsAmount,
    tdsAmount: finance.tdsAmount,
    note: "GST/tax collected is not platform profit. Customer collections, product sales, shipping, fees, commission, payouts, and taxes are separate figures.",
  };
}

export async function executeAssistantTool({ db, actor, tool, args = {}, context = {} }) {
  if (!canUseAssistantTool(actor.role, tool)) throw new Error("This assistant action is not available for your account.");
  if (tool === "getStoreInfo") {
    const snapshot = await db.doc("settings/assistant").get();
    const settings = snapshot.exists ? snapshot.data() : {};
    const query = normalize(args.query);
    const reply = query.includes("return") || query.includes("refund") ? settings.returnPolicy
      : query.includes("payment") || query.includes("cod") || query.includes("prepaid") ? settings.paymentInformation
        : query.includes("shipping") || query.includes("delivery") ? settings.shippingInformation
          : query.includes("contact") || query.includes("support") || query.includes("email") || query.includes("phone") ? [settings.supportEmail, settings.supportPhone, settings.whatsAppNumber].filter(Boolean).join(" · ")
            : settings.businessInformation;
    return { reply: reply || "I can't verify that information from the current PARTSWALA settings. Please contact support." };
  }
  if (tool === "searchProducts") return { products: searchCatalogProducts(await allProducts(db), args.query || "", { maxPrice: args.maxPrice, vehicle: args.vehicle }) };
  if (tool === "getProduct") {
    const product = (await allProducts(db)).find((item) => item.id === args.productId);
    return { product: product ? publicProduct(product) : null };
  }
  if (tool === "compareProducts") {
    const ids = [...new Set((args.productIds || []).filter((id) => typeof id === "string"))].slice(0, 3);
    return { products: (await allProducts(db)).filter((product) => ids.includes(product.id)).map(publicProduct) };
  }
  if (tool === "checkCompatibility") {
    const catalogue = await allProducts(db);
    const candidates = args.productIds?.length
      ? catalogue.filter((product) => args.productIds.includes(product.id))
      : searchCatalogProducts(catalogue, args.query || "").map((summary) => catalogue.find((product) => product.id === summary.id));
    return { products: candidates.filter(Boolean).slice(0, 5).map((product) => ({ ...publicProduct(product), compatibilityStatus: compatibilityStatus(product, args.vehicle) })) };
  }
  if (tool === "getOrders") return getUserOrders(db, actor, args.orderId);
  if (tool === "getShippingEstimate") {
    const products = await allProducts(db);
    const ids = [...new Set(args.productIds || [])];
    const selected = products.filter((product) => ids.includes(product.id));
    const storeSnapshot = await db.doc("settings/store").get();
    const store = storeSnapshot.exists ? storeSnapshot.data() : {};
    const pickupPincode = args.pickupPincode || store.pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE || "";
    if (!selected.length) return { available: false, message: "Shipping needs to be calculated at checkout after the product is selected." };
    if (selected.some((product) => !(Number(product.weight) > 0))) return { available: false, message: "I can't calculate shipping without the product's required weight. Please ask the seller to update the listing." };
    if (!/^\d{6}$/.test(pickupPincode) || !/^\d{6}$/.test(args.deliveryPincode || "")) return { available: false, message: "Please provide a valid 6-digit destination PIN code; final shipping is calculated at checkout." };
    const estimate = calculateShipmentEstimate(selected.map((product) => ({ quantity: Math.max(1, Number(args.quantity) || 1), product: { weight: product.weight, ...(product.dimensions || {}) } })), {
      pickupPincode,
      deliveryPincode: args.deliveryPincode,
      paymentMethod: args.paymentMethod || "COD",
    });
    return { available: false, amount: null, actualWeight: estimate.actualWeight, volumetricWeight: estimate.volumetricWeight, chargeableWeight: estimate.chargeableWeight, isEstimate: false, message: "Final courier pricing is calculated at checkout." };
  }
  if (tool === "getVendorSales") return getVendorSales(db, actor);
  if (tool === "getVendorPayout") return getVendorPayout(db, actor);
  if (tool === "getLowStockProducts") return { products: await getLowStockProducts(db, actor) };
  if (tool === "getAdminFinance") return getAdminFinance(db);
  if (tool === "getCart") {
    const cart = Array.isArray(context.cart) ? context.cart.slice(0, 50) : [];
    const products = await allProducts(db);
    const items = cart.map((entry) => {
      const product = products.find((item) => item.id === entry.id);
      return product ? { id: product.id, name: product.name || product.title || "Product", partNumber: product.partNumber || "", quantity: Math.max(1, Number(entry.quantity) || 1), price: Number(product.price) || 0, stock: product.stock ?? null, imageUrl: product.imageUrl || "" } : null;
    }).filter(Boolean);
    return { items, subtotal: Number(items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2)) };
  }
  if (tool === "addToCart") {
    if (!(context.recentProductIds || []).includes(args.productId)) return { product: null };
    const product = (await allProducts(db)).find((item) => item.id === args.productId);
    const stock = Number(product?.stock ?? product?.stockCount ?? 0);
    const purchasable = Boolean(product && product.enabled !== false && !["disabled", "pending", "rejected"].includes(String(product.status || "").toLowerCase()) && stock > 0);
    return { product: product ? { ...publicProduct(product), stock: purchasable ? stock : 0 } : null, purchasable, quantity: args.quantity };
  }
  if (tool === "removeFromCart") {
    const item = (context.cart || []).find((entry) => entry.id === args.productId);
    return { found: Boolean(item), productId: item?.id || "", name: item?.name || item?.title || "that item" };
  }
  return { reply: args.reply || "Tell me which truck part or account task you need help with." };
}