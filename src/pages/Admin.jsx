import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, getDoc, setDoc } from "firebase/firestore";
import { BarChart3, Bot, Boxes, Check, ClipboardList, Edit3, ImagePlus, LayoutDashboard, Loader2, LogOut, MapPin, Package, Plus, Search, Settings, ShoppingCart, Store, Trash2, Truck, Users, Wallet, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { db } from "../firebase";
import { getAdminProductsPage, getAdminRecordsPage, getAdminUsersPage } from "../services/adminService";
import { approveSelectedAdminVendorProducts, completeManualAdminRefund, deleteAdminProduct, getAdminFinance, getAdminFinanceDetails, getAdminOrdersPage, getAdminPickupLocations, getPendingAdminVendorProducts, ORDER_STATUSES, reconcileAdminCodCollection, requestAdminRefund, retryShiprocketOrder, reviewAdminInvoice, reviewAdminVendorApplication, reviewAdminVendorSubmission, reviewOrderReturn, saveAdminProduct, saveAdminStoreSettings, setAdminPickupLocationStatus, setAdminProductEnabled, subscribeToAllOrders, updateAdminOrderFinance, updateOrderStatus } from "../services/orderService";
import { needsAccountingReview } from "../services/invoicePolicy";
import { uploadImageToCloudinary } from "../services/cloudinaryService";
import ShippingEstimateCard from "../components/ShippingEstimateCard";

const DEFAULT_CATEGORIES = [
  "Engine Parts",
  "Clutch & Transmission",
  "Brake System",
  "Suspension & Steering",
  "Electrical Parts",
  "Cooling System",
  "Fuel System",
  "Filters",
  "Exhaust System",
  "Body & Exterior",
  "Wheels & Tyres",
  "Lubricants & Fluids",
  "Accessories",
  "Other Parts",
];
const NAV_ITEMS = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["products", "Products", Boxes],
  ["orders", "Orders", ShoppingCart],
  ["returns", "Return requests", ClipboardList],
  ["customers", "Customers", Users],
  ["vendors", "Vendor applications", Users],
  ["pickupLocations", "Pickup locations", MapPin],
  ["submissions", "Vendor submissions", Package],
  ["categories", "Categories", Store],
  ["settings", "Settings", Settings],
  ["finance", "Finance", Wallet],
  ["assistant", "AI Assistant", Bot],
];
const WORKFLOW_ORDER_STATUSES = new Set([
  "shipped", "in_transit", "out_for_delivery", "delivered", "return_window", "completed", "settled",
  "return_requested", "return_approved", "return_rejected", "refunded", "rto", "rto_completed",
  "partially_rto", "partially_delivered",
]);

const emptyProduct = { name: "", partNumber: "", brand: "", category: "Engine Parts", mrp: "", price: "", costPrice: "", stock: "", hsn: "", gstRate: 18, discountPercent: "0", description: "", compatibility: "", imageUrl: "", weight: "", length: "", width: "", height: "", enabled: true };

function statusFor(order) {
  const status = String(order.orderStatus || order.status || "Pending").toLowerCase();
  if (status === "processing") return "confirmed";
  return status;
}

function money(value) {
  const amount = Number(value);
  return value == null || !Number.isFinite(amount) ? "—" : `₹${amount.toLocaleString("en-IN")}`;
}

export default function Admin() {
  const { currentUser, isAdmin, loading: authLoading, logout, showToast } = useAuth();
  const navigate = useNavigate();
  const isAuthorized = Boolean(currentUser && isAdmin);
  const [section, setSection] = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [productsCursor, setProductsCursor] = useState(null);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersCursor, setOrdersCursor] = useState(null);
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeDetailsLoading, setFinanceDetailsLoading] = useState(false);
  const [financeDateStart, setFinanceDateStart] = useState(`${new Date().getUTCFullYear()}-01-01`);
  const [financeDateEnd, setFinanceDateEnd] = useState(new Date().toISOString().slice(0, 10));
  const [customers, setCustomers] = useState([]);
  const [customersCursor, setCustomersCursor] = useState(null);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [loadingMoreCustomers, setLoadingMoreCustomers] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [adminRecordPages, setAdminRecordPages] = useState({
    submissions: { cursor: null, hasMore: false },
    returns: { cursor: null, hasMore: false },
    applications: { cursor: null, hasMore: false },
  });
  const [loadingAdminRecord, setLoadingAdminRecord] = useState("");
  const [returnRequests, setReturnRequests] = useState([]);
  const [vendorApplications, setVendorApplications] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({ storeName: "PARTSWALA IND", logo: "", phone: "", email: "", address: "", gst: "", businessState: "", pickupPincode: "", shippingFee: 0, freeShippingThreshold: 0, codFee: 0, productGstRate: 18, vendorCommissionRate: 10, platformServiceFeeRate: 0, vendorGatewayFeeShareRate: 0, settlementHoldDays: 7, shippingDifferencePolicy: "absorb", pricesIncludeGst: true, shippingTaxTreatment: "", codFeeTaxTreatment: "" });
  const [assistantSettings, setAssistantSettings] = useState({ enabled: true, assistantName: "PARTSWALA AI", welcomeMessage: "Hi! I'm PARTSWALA AI. I can help you find truck parts, understand products, track your orders, use the website, and answer common questions. What can I help you with?", supportEmail: "", supportPhone: "", whatsAppNumber: "", returnPolicy: "", shippingInformation: "", paymentInformation: "", businessInformation: "", faqJson: "[]" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retryingOrderId, setRetryingOrderId] = useState("");
  const [approvingSubmissionId, setApprovingSubmissionId] = useState("");
  const [pendingApprovalProducts, setPendingApprovalProducts] = useState([]);
  const [selectedApprovalIds, setSelectedApprovalIds] = useState([]);
  const [approvalSelectionOpen, setApprovalSelectionOpen] = useState(false);
  const [loadingPendingApproval, setLoadingPendingApproval] = useState(false);
  const [approvingSelected, setApprovingSelected] = useState(false);
  const [approvalProgress, setApprovalProgress] = useState({ completed: 0, total: 0 });
  const [approvalError, setApprovalError] = useState("");
  const [approvalResult, setApprovalResult] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [orderFilter, setOrderFilter] = useState("All");
  const [productModal, setProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [productImage, setProductImage] = useState(null);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [pickupLocations, setPickupLocations] = useState([]);

  useEffect(() => {
    if (authLoading || !isAuthorized) return undefined;
    return subscribeToAllOrders((page, cursor, hasMore) => {
      setOrders((previous) => {
        const merged = new Map(previous.map((order) => [order.id, order]));
        page.forEach((order) => merged.set(order.id, order));
        return [...merged.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
      });
      setOrdersCursor(cursor);
      setHasMoreOrders(hasMore);
    }, () => showToast?.("Live order updates are temporarily unavailable", "error"));
  }, [authLoading, isAuthorized, showToast]);

  const loadPickupLocations = useCallback(async () => {
    try { setPickupLocations((await getAdminPickupLocations()).pickupLocations || []); } catch (error) { showToast?.(error.message || "Pickup locations could not be loaded", "error"); }
  }, [showToast]);

  async function togglePickupLocation(entry) {
    try { await setAdminPickupLocationStatus(entry.vendorId, entry.pickupLocation?.isActive !== true); await loadPickupLocations(); showToast?.("Pickup location status updated", "success"); } catch (error) { showToast?.(error.message || "Pickup location could not be updated", "error"); }
  }

  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      setFinanceSummary(await getAdminFinance(financeDateStart, financeDateEnd));
    } catch (error) {
      showToast?.(error.message || "Finance report could not be loaded", "error");
    } finally {
      setFinanceLoading(false);
    }
  }, [financeDateEnd, financeDateStart, showToast]);

  async function loadMoreFinance() {
    if (!financeSummary?.ordersCursor && !financeSummary?.settlementsCursor) return;
    setFinanceDetailsLoading(true);
    try {
      const page = await getAdminFinanceDetails(financeDateStart, financeDateEnd, financeSummary.ordersCursor, financeSummary.settlementsCursor);
      setFinanceSummary((previous) => ({
        ...previous,
        orders: [...(previous.orders || []), ...page.orders],
        settlements: [...(previous.settlements || []), ...page.settlements],
        ordersCursor: page.ordersCursor,
        settlementsCursor: page.settlementsCursor,
      }));
    } catch (error) {
      showToast?.(error.message || "More finance details could not be loaded", "error");
    } finally {
      setFinanceDetailsLoading(false);
    }
  }

  async function loadMoreOrders() {
    if (!ordersCursor || !hasMoreOrders || loadingMoreOrders) return;
    setLoadingMoreOrders(true);
    try {
      const page = await getAdminOrdersPage(ordersCursor);
      setOrders((previous) => {
        const merged = new Map(previous.map((order) => [order.id, order]));
        page.orders.forEach((order) => merged.set(order.id, order));
        return [...merged.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
      });
      setOrdersCursor(page.cursor);
      setHasMoreOrders(page.hasMore);
    } catch (error) {
      showToast?.(error.message || "Older orders could not be loaded", "error");
    } finally {
      setLoadingMoreOrders(false);
    }
  }

  async function updateFinance(orderId, details) {
    try {
      await updateAdminOrderFinance(orderId, details);
      await loadFinance();
      showToast?.("Finance record updated", "success");
    } catch (error) {
      showToast?.(error.message || "Finance record could not be updated", "error");
    }
  }

  async function reviewInvoice(orderId, invoice) {
    const reason = window.prompt(`Review note for ${invoice.invoiceNumber}:`, "");
    if (!reason?.trim() || reason.trim().length < 10) return;
    try {
      await reviewAdminInvoice(orderId, invoice.invoiceNumber, reason.trim());
      await loadFinance();
      showToast?.("Invoice accounting review recorded", "success");
    } catch (error) {
      showToast?.(error.message || "Invoice review could not be recorded", "error");
    }
  }

  async function reconcileCodOrder(order) {
    const total = Number(order.grandTotal ?? order.totalAmount ?? order.total ?? 0);
    const previouslyCollected = Number(order.paymentCollectedAmount ?? order.codCollectedAmount ?? 0);
    const remaining = Math.max(0, Math.round((total - previouslyCollected) * 100) / 100);
    const amount = Number(window.prompt(`Courier remittance received so far: ${money(previouslyCollected)}. Enter this remittance amount (up to ${money(remaining)}):`, String(remaining)));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const reference = window.prompt("Enter the courier settlement reference for this remittance:", "");
    if (!reference?.trim()) return;
    try {
      const result = await reconcileAdminCodCollection(order.id, amount, reference.trim());
      showToast?.(result.paymentStatus === "COD collected" ? "COD total fully reconciled" : `Partial COD remittance recorded: ${money(result.paymentCollectedAmount)} collected`, "success");
    } catch (error) {
      showToast?.(error.message || "COD collection could not be reconciled", "error");
    }
  }

  async function updateReturnRequest(returnRequest, status) {
    if (status === "manual_refund_complete") {
      const reference = window.prompt("Enter the completed manual COD refund reference:", "");
      if (!reference?.trim()) return;
      try {
        await completeManualAdminRefund(returnRequest.refundRequestId, reference.trim());
        await loadData();
        showToast?.("Manual refund reconciliation saved", "success");
      } catch (error) {
        showToast?.(error.message || "Manual refund could not be reconciled", "error");
      }
      return;
    }
    const note = status === "rejected" ? window.prompt("Review note (explain the decision; missing evidence alone is not a rejection reason):", "") : window.prompt("Optional review note:", "") || "";
    if (status === "rejected" && note == null) return;
    let inspections;
    if (status === "approved") {
      inspections = [];
      for (const item of returnRequest.items || []) {
        const condition = window.prompt(`Inspection condition for ${item.name} (RESELLABLE, DAMAGED, USED/INSTALLED, WRONG_PART, MISSING_PARTS, TAMPERED, OTHER):`, "RESELLABLE");
        if (condition == null) return;
        const notes = window.prompt(`Inspection notes for ${item.name}:`, "");
        if (notes == null) return;
        inspections.push({ productId: item.productId, quantity: Number(item.quantity), condition: condition.trim().toUpperCase(), notes: notes.trim(), expectedPartNumber: item.partNumber || "", receivedPartNumber: "" });
      }
    }
    try {
      await reviewOrderReturn({ returnId: returnRequest.id, status, note: note || "", ...(inspections ? { inspections } : {}) });
      await loadData();
      showToast?.("Return review updated", "success");
    } catch (error) {
      showToast?.(error.message || "Return review could not be updated", "error");
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [productPage, customerPage, submissionPage, vendorPage, categorySnap, settingsSnap, assistantSnap, returnPage] = await Promise.all([
        getAdminProductsPage(),
        getAdminUsersPage(),
        getAdminRecordsPage("sellerSubmissions", "createdAt"),
        getAdminRecordsPage("vendorApplications", "submittedAt"),
        getDocs(collection(db, "categories")),
        getDoc(doc(db, "settings", "store")),
        getDoc(doc(db, "settings", "assistant")),
        getAdminRecordsPage("returnRequests", "createdAt"),
      ]);
      setProducts(productPage.products);
      setProductsCursor(productPage.cursor);
      setHasMoreProducts(productPage.hasMore);
      setCustomers(customerPage.users);
      setCustomersCursor(customerPage.cursor);
      setHasMoreCustomers(customerPage.hasMore);
      setSubmissions(submissionPage.records);
      setReturnRequests(returnPage.records);
      setVendorApplications(vendorPage.records);
      setAdminRecordPages({
        submissions: { cursor: submissionPage.cursor, hasMore: submissionPage.hasMore },
        returns: { cursor: returnPage.cursor, hasMore: returnPage.hasMore },
        applications: { cursor: vendorPage.cursor, hasMore: vendorPage.hasMore },
      });
      setCategories(categorySnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name)));
      if (settingsSnap.exists()) setSettings((previous) => ({ ...previous, ...settingsSnap.data() }));
      if (assistantSnap.exists()) {
        const data = assistantSnap.data();
        setAssistantSettings((previous) => ({ ...previous, ...data, faqJson: JSON.stringify(data.faqs || [], null, 2) }));
      }
    } catch (error) {
      console.error("Admin data load failed:", error);
      showToast?.("Some admin data could not be loaded", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!authLoading && isAuthorized) loadData();
    if (!authLoading && !isAuthorized) setLoading(false);
  }, [authLoading, isAuthorized, loadData]);

  useEffect(() => {
    if (section === "finance" && isAuthorized) loadFinance();
    if (section === "pickupLocations" && isAuthorized) loadPickupLocations();
  }, [section, isAuthorized, loadFinance, loadPickupLocations]);

  async function loadMoreProducts() {
    if (!productsCursor || !hasMoreProducts || loadingMoreProducts) return;
    setLoadingMoreProducts(true);
    try {
      const page = await getAdminProductsPage(productsCursor);
      setProducts((previous) => [...previous, ...page.products]);
      setProductsCursor(page.cursor);
      setHasMoreProducts(page.hasMore);
    } catch (error) {
      showToast?.(error.message || "More products could not be loaded", "error");
    } finally {
      setLoadingMoreProducts(false);
    }
  }

  async function loadMoreCustomers() {
    if (!customersCursor || !hasMoreCustomers || loadingMoreCustomers) return;
    setLoadingMoreCustomers(true);
    try {
      const page = await getAdminUsersPage(customersCursor);
      setCustomers((previous) => [...previous, ...page.users]);
      setCustomersCursor(page.cursor);
      setHasMoreCustomers(page.hasMore);
    } catch (error) {
      showToast?.(error.message || "More customers could not be loaded", "error");
    } finally {
      setLoadingMoreCustomers(false);
    }
  }

  async function loadMoreAdminRecords(listName) {
    const config = {
      submissions: { collection: "sellerSubmissions", orderField: "createdAt" },
      returns: { collection: "returnRequests", orderField: "createdAt" },
      applications: { collection: "vendorApplications", orderField: "submittedAt" },
    }[listName];
    const pageState = adminRecordPages[listName];
    if (!config || !pageState?.cursor || !pageState.hasMore || loadingAdminRecord) return;
    setLoadingAdminRecord(listName);
    try {
      const page = await getAdminRecordsPage(config.collection, config.orderField, pageState.cursor);
      if (listName === "submissions") setSubmissions((previous) => [...previous, ...page.records]);
      if (listName === "returns") setReturnRequests((previous) => [...previous, ...page.records]);
      if (listName === "applications") setVendorApplications((previous) => [...previous, ...page.records]);
      setAdminRecordPages((previous) => ({ ...previous, [listName]: { cursor: page.cursor, hasMore: page.hasMore } }));
    } catch (error) {
      showToast?.(error.message || "More admin records could not be loaded", "error");
    } finally {
      setLoadingAdminRecord("");
    }
  }

  const categoryOptions = categories.length > 0 ? categories.map((category) => category.name) : DEFAULT_CATEGORIES;
  const metrics = useMemo(() => ({
    products: products.length,
    orders: orders.length,
    pending: orders.filter((order) => ["pending", "confirmed"].includes(statusFor(order))).length,
    sales: orders.filter((order) => statusFor(order) !== "cancelled").reduce((total, order) => total + Number(order.totalAmount ?? order.total ?? 0), 0),
    lowStock: products.filter((product) => Number(product.stock || 0) <= 5).length,
  }), [products, orders]);

  const filteredProducts = products.filter((product) => `${product.name} ${product.partNumber} ${product.brand} ${product.category}`.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredOrders = orders.filter((order) => orderFilter === "All" || statusFor(order) === orderFilter);
  const filteredCustomers = customers.filter((customer) => `${customer.displayName} ${customer.email} ${customer.phone}`.toLowerCase().includes(searchQuery.toLowerCase()));

  function openProduct(product = null) {
    setEditingProduct(product);
    setProductForm(product ? { ...emptyProduct, ...product, length: product.dimensions?.length || "", width: product.dimensions?.width || "", height: product.dimensions?.height || "", gstRate: Number(settings.productGstRate ?? 18), priceIncludesGst: settings.pricesIncludeGst !== false, enabled: product.enabled !== false && product.status !== "Disabled" } : { ...emptyProduct, category: categoryOptions[0] || "Engine Parts", gstRate: Number(settings.productGstRate ?? 18), priceIncludesGst: settings.pricesIncludeGst !== false });
    setProductImage(null);
    setProductModal(true);
  }

  async function saveProduct(event) {
    event.preventDefault();
    const numericFields = ["price", "mrp", "costPrice", "stock", "weight", "length", "width", "height"];
    if (numericFields.some((field) => productForm[field] !== "" && (!Number.isFinite(Number(productForm[field])) || Number(productForm[field]) < 0))) {
      showToast?.("Enter valid non-negative numbers for price, stock, weight, and dimensions.", "error");
      return;
    }
    if (!String(productForm.partNumber || "").trim() || productForm.weight === "" || Number(productForm.weight) <= 0) {
      showToast?.("Part number and a positive shipping weight are required.", "error");
      return;
    }
    setSaving(true);
    try {
      let imageUrl = productForm.imageUrl;
      if (productImage) {
        imageUrl = await uploadImageToCloudinary(productImage, "product");
      }
      const dimensions = { length: Number(productForm.length || 0), width: Number(productForm.width || 0), height: Number(productForm.height || 0) };
      if (Number(productForm.mrp || 0) > 0 && Number(productForm.price) > Number(productForm.mrp)) throw new Error("Selling price cannot exceed MRP.");
      const data = { ...productForm, mrp: Number(productForm.mrp || 0), price: Number(productForm.price || 0), stock: Number(productForm.stock || 0), hsn: productForm.hsn.trim(), gstRate: Number(settings.productGstRate ?? 18), priceIncludesGst: settings.pricesIncludeGst !== false, weight: Number(productForm.weight), dimensions, shippingEstimate: null, discountPercent: Number(productForm.discountPercent || 0), imageUrl, sellerId: editingProduct?.sellerId || "partswala", sellerType: editingProduct?.sellerType === "vendor" ? "vendor" : "partswala", enabled: productForm.enabled, status: productForm.enabled ? "Available" : "Disabled", updatedAt: new Date().toISOString() };
      const productDocument = { ...data };
      delete productDocument.costPrice;
      await saveAdminProduct(editingProduct?.id, productDocument, productForm.costPrice === "" ? null : Number(productForm.costPrice));
      setProductModal(false);
      showToast?.(editingProduct ? "Product updated" : "Product added", "success");
      await loadData();
    } catch (error) {
      console.error("Product save failed:", error);
      showToast?.(error.message || "Could not save the product. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Delete ${product.name}?`)) return;
    await deleteAdminProduct(product.id, `Deleted product ${product.name}`);
    setProducts((previous) => previous.filter((item) => item.id !== product.id));
    showToast?.("Product deleted", "success");
  }

  async function toggleProduct(product) {
    const enabled = product.enabled === false || product.status === "Disabled";
    await setAdminProductEnabled(product.id, enabled);
    setProducts((previous) => previous.map((item) => item.id === product.id ? { ...item, enabled, status: enabled ? "Available" : "Disabled" } : item));
  }

  async function loadPendingApprovalProducts() {
    setLoadingPendingApproval(true);
    setApprovalError("");
    try {
      const result = await getPendingAdminVendorProducts();
      setPendingApprovalProducts(result.products || []);
      setSelectedApprovalIds([]);
      setApprovalSelectionOpen(true);
    } catch (error) {
      const message = error.message || "Pending vendor products could not be loaded.";
      setApprovalError(message);
      showToast?.(message, "error");
    } finally {
      setLoadingPendingApproval(false);
    }
  }

  function toggleApprovalSelection(productId) {
    setSelectedApprovalIds((previous) => previous.includes(productId)
      ? previous.filter((id) => id !== productId)
      : [...previous, productId]);
  }

  async function approveSelectedProducts() {
    if (!selectedApprovalIds.length || approvingSelected) return;
    const ids = [...selectedApprovalIds];
    const combinedResult = { requestedCount: ids.length, approved: [], skipped: [], remainingEligibleNotAttempted: 0 };
    setApprovingSelected(true);
    setApprovalError("");
    setApprovalProgress({ completed: 0, total: ids.length });

    try {
      for (let offset = 0; offset < ids.length; offset += 50) {
        const batchIds = ids.slice(offset, offset + 50);
        try {
          const result = await approveSelectedAdminVendorProducts(batchIds);
          combinedResult.approved.push(...result.approved);
          combinedResult.skipped.push(...result.skipped);
          setApprovalProgress({ completed: offset + batchIds.length, total: ids.length });
        } catch (error) {
          combinedResult.skipped.push(...batchIds.map((productId) => ({
            productId,
            reason: `Approval request failed; status may need verification: ${error.message || "request failed"}`,
          })));
          combinedResult.remainingEligibleNotAttempted = ids.length - offset - batchIds.length;
          break;
        }
      }
      const approvedById = new Map(combinedResult.approved.map(({ product, businessName }) => [product.id, { ...product, vendorName: businessName || undefined, vendorBusinessName: businessName || undefined }]));
      setProducts((previous) => previous.map((product) => {
        const approved = approvedById.get(product.id);
        return approved ? { ...product, ...approved, enabled: true, status: "Available" } : product;
      }));
      setApprovalResult(combinedResult);
      setApprovalSelectionOpen(false);
    } finally {
      setApprovingSelected(false);
    }
  }

  async function updateOrder(order, status) {
    await updateOrderStatus(order.id, status);
    setOrders((previous) => previous.map((item) => item.id === order.id ? { ...item, status, orderStatus: status } : item));
    showToast?.("Order status updated", "success");
  }

  async function retryShipping(order) {
    setRetryingOrderId(order.id);
    try {
      await retryShiprocketOrder(order.id);
      showToast?.("Shiprocket shipping retry completed", "success");
    } catch (error) {
      showToast?.(error.message || "Shipping retry failed", "error");
    } finally {
      setRetryingOrderId("");
    }
  }

  async function approveSubmission(submission) {
    setApprovingSubmissionId(submission.id);
    try {
      await reviewAdminVendorSubmission(submission.id, "approved");
      showToast?.("Vendor product approved and published", "success");
      await loadData();
    } catch (error) {
      showToast?.(error.message || "Vendor product could not be published", "error");
    } finally {
      setApprovingSubmissionId("");
    }
  }

  async function rejectSubmission(submission) {
    const reason = window.prompt(`Rejection reason for ${submission.name}:`);
    if (!reason?.trim()) return;
    try {
      await reviewAdminVendorSubmission(submission.id, "rejected", reason.trim());
      showToast?.("Submission rejected with feedback", "success");
      await loadData();
    } catch (error) {
      showToast?.(error.message || "Submission could not be rejected", "error");
    }
  }

  async function reviewVendorApplication(application, status) {
    const rejectionReason = status === "rejected" ? window.prompt(`Reason for rejecting ${application.businessName}:`) : "";
    if (status === "rejected" && !rejectionReason?.trim()) return;
    try {
      await reviewAdminVendorApplication(application.vendorId, status, rejectionReason?.trim() || "");
      showToast?.(status === "approved" ? "Vendor account approved" : "Vendor application rejected", "success");
      await loadData();
    } catch (error) {
      showToast?.(error.message || "Vendor application could not be reviewed", "error");
    }
  }

  async function saveCategory(event) {
    event.preventDefault();
    const cleanName = categoryName.trim();
    if (!cleanName) return;
    const id = editingCategory || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await setDoc(doc(db, "categories", id), { name: cleanName, updatedAt: new Date().toISOString() }, { merge: true });
    setCategoryName("");
    setEditingCategory(null);
    await loadData();
  }

  async function removeCategory(category) {
    if (!window.confirm(`Delete ${category.name}?`)) return;
    await deleteDoc(doc(db, "categories", category.id));
    setCategories((previous) => previous.filter((item) => item.id !== category.id));
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      await saveAdminStoreSettings({ ...settings, businessState: settings.businessState.trim(), pickupPincode: String(settings.pickupPincode || "").trim(), shippingFee: Number(settings.shippingFee), freeShippingThreshold: Number(settings.freeShippingThreshold), codFee: Number(settings.codFee), productGstRate: Number(settings.productGstRate ?? 18), vendorCommissionRate: Number(settings.vendorCommissionRate), platformServiceFeeRate: Number(settings.platformServiceFeeRate), vendorGatewayFeeShareRate: Number(settings.vendorGatewayFeeShareRate), settlementHoldDays: Number(settings.settlementHoldDays) });
      showToast?.("Store settings saved", "success");
    } catch (error) {
      showToast?.(error.message || "Store settings could not be saved", "error");
    }
  }

  async function saveAssistantSettings(event) {
    event.preventDefault();
    let faqs;
    try {
      faqs = JSON.parse(assistantSettings.faqJson || "[]");
      if (!Array.isArray(faqs) || faqs.some((faq) => typeof faq.question !== "string" || typeof faq.answer !== "string")) throw new Error("FAQs must be an array of entries with question and answer fields.");
    } catch (error) {
      showToast?.(error.message.includes("JSON") ? "FAQ content must be valid JSON." : error.message, "error");
      return;
    }
    const { faqJson: _faqJson, ...publicSettings } = assistantSettings;
    const savedSettings = { ...publicSettings, faqs };
    await setDoc(doc(db, "settings", "assistant"), { ...savedSettings, updatedAt: new Date().toISOString() }, { merge: true });
    window.dispatchEvent(new CustomEvent("partswala-assistant-settings-updated", { detail: savedSettings }));
    showToast?.("AI Assistant settings saved", "success");
  }

  async function handleLogout() {
    await logout();
    navigate("/admin/login");
  }

  if (authLoading || loading) return <div className="admin-loading"><Loader2 size={28} /><span>Loading admin console...</span></div>;
  if (!isAuthorized) return <div className="admin-denied"><ShieldIcon /><h1>Admin access required</h1><p>This account does not have the required administrator role.</p><button onClick={() => navigate("/")}>Return to storefront</button></div>;

  return (
    <main className="admin-v1">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span>PW</span><div><strong>PARTSWALA</strong><small>ADMIN / V1</small></div></div>
        <nav>{NAV_ITEMS.map(([key, label, Icon]) => <button key={key} className={section === key ? "is-active" : ""} onClick={() => { setSection(key); setSearchQuery(""); }}><Icon size={17} />{label}</button>)}</nav>
        <button className="admin-logout" onClick={handleLogout}><LogOut size={16} /> Logout</button>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar"><div><p>OPERATIONS / {section.toUpperCase()}</p><h1>{NAV_ITEMS.find(([key]) => key === section)?.[1]}</h1></div><span className="admin-user"><i /> {currentUser.email}</span></header>
        {section === "dashboard" && <Dashboard metrics={metrics} products={products} orders={orders} />}
        {section === "products" && <ProductsSection products={filteredProducts} searchQuery={searchQuery} setSearchQuery={setSearchQuery} openProduct={openProduct} toggleProduct={toggleProduct} removeProduct={removeProduct} onRefresh={loadData} loadMore={loadMoreProducts} hasMore={hasMoreProducts} loadingMore={loadingMoreProducts} loadPendingApproval={loadPendingApprovalProducts} loadingPendingApproval={loadingPendingApproval} approvalError={approvalError} />}
        {section === "orders" && <OrdersSection orders={filteredOrders} filter={orderFilter} setFilter={setOrderFilter} updateOrder={updateOrder} reconcileCodOrder={reconcileCodOrder} retryOrder={retryShipping} retryingOrderId={retryingOrderId} loadMore={loadMoreOrders} hasMore={hasMoreOrders} loadingMore={loadingMoreOrders} />}
        {section === "returns" && <><ReturnsSection requests={returnRequests} review={updateReturnRequest} />{adminRecordPages.returns.hasMore && <div className="admin-content"><button className="admin-secondary" disabled={loadingAdminRecord === "returns"} onClick={() => loadMoreAdminRecords("returns")}>{loadingAdminRecord === "returns" ? "Loading returns..." : "Load older returns"}</button></div>}</>}
        {section === "customers" && <CustomersSection customers={filteredCustomers} searchQuery={searchQuery} setSearchQuery={setSearchQuery} orders={orders} loadMore={loadMoreCustomers} hasMore={hasMoreCustomers} loadingMore={loadingMoreCustomers} />}
        {section === "vendors" && <><VendorApplicationsSection applications={vendorApplications} review={reviewVendorApplication} />{adminRecordPages.applications.hasMore && <div className="admin-content"><button className="admin-secondary" disabled={loadingAdminRecord === "applications"} onClick={() => loadMoreAdminRecords("applications")}>{loadingAdminRecord === "applications" ? "Loading applications..." : "Load older applications"}</button></div>}</>}
        {section === "pickupLocations" && <PickupLocationsSection locations={pickupLocations} toggle={togglePickupLocation} />}
        {section === "submissions" && <><SubmissionsSection submissions={submissions} approve={approveSubmission} reject={rejectSubmission} approvingSubmissionId={approvingSubmissionId} />{adminRecordPages.submissions.hasMore && <div className="admin-content"><button className="admin-secondary" disabled={loadingAdminRecord === "submissions"} onClick={() => loadMoreAdminRecords("submissions")}>{loadingAdminRecord === "submissions" ? "Loading submissions..." : "Load older submissions"}</button></div>}</>}
        {section === "categories" && <CategoriesSection categories={categories} name={categoryName} setName={setCategoryName} editing={editingCategory} setEditing={setEditingCategory} save={saveCategory} remove={removeCategory} />}
        {section === "settings" && <SettingsSection settings={settings} setSettings={setSettings} save={saveSettings} />}
        {section === "finance" && <FinanceSection finance={financeSummary} loading={financeLoading} update={updateFinance} reviewInvoice={reviewInvoice} refresh={loadFinance} loadMore={loadMoreFinance} loadingMore={financeDetailsLoading} dateStart={financeDateStart} dateEnd={financeDateEnd} setDateStart={setFinanceDateStart} setDateEnd={setFinanceDateEnd} />}
        {section === "assistant" && <AssistantSettingsSection settings={assistantSettings} setSettings={setAssistantSettings} save={saveAssistantSettings} />}
      </section>
      {productModal && <ProductModal product={productForm} setProduct={setProductForm} setImage={setProductImage} categories={categoryOptions} saving={saving} editing={Boolean(editingProduct)} gstRate={Number(settings.productGstRate ?? 18)} save={saveProduct} close={() => setProductModal(false)} />}
      {approvalSelectionOpen && <PendingApprovalModal products={pendingApprovalProducts} selectedIds={selectedApprovalIds} toggle={toggleApprovalSelection} setSelectedIds={setSelectedApprovalIds} approve={approveSelectedProducts} approving={approvingSelected} progress={approvalProgress} close={() => setApprovalSelectionOpen(false)} />}
      {approvalResult && <ApprovalResultModal result={approvalResult} close={() => setApprovalResult(null)} />}
    </main>
  );
}

function ShieldIcon() { return <div className="admin-denied-icon">!</div>; }

function PickupLocationsSection({ locations, toggle }) {
  return <div className="admin-content"><div className="admin-panel admin-table-panel"><div className="admin-panel-heading"><h2>Seller pickup locations</h2><span>{locations.length} configured</span></div>{locations.length === 0 ? <p className="admin-muted">No vendor pickup locations have been configured.</p> : <div className="admin-table"><div className="admin-table-head"><span>Vendor</span><span>Pickup location</span><span>Address</span><span>Pincode</span><span>Shiprocket ID</span><span>Status</span></div>{locations.map((entry) => { const pickup = entry.pickupLocation; return <div className="admin-table-row" key={entry.vendorId}><strong>{entry.vendorName}</strong><span>{pickup.name}</span><span>{[pickup.addressLine1, pickup.city, pickup.state].filter(Boolean).join(", ")}</span><span>{pickup.pincode}</span><span>{pickup.shiprocketPickupLocationId || "Pending"}</span><div className="admin-actions"><em className={`admin-status ${pickup.isActive === false ? "disabled" : "available"}`}>{pickup.isActive === false ? "Disabled" : "Active"}</em><button onClick={() => toggle(entry)}>{pickup.isActive === false ? "Enable" : "Disable"}</button></div></div>; })}</div>}</div></div>;
}

function Dashboard({ metrics, products, orders }) {
  const cards = [["Products loaded", metrics.products, Boxes], ["Orders loaded", metrics.orders, ShoppingCart], ["Pending in loaded orders", metrics.pending, Truck], ["Sales · loaded orders", money(metrics.sales), BarChart3], ["Low stock · loaded products", metrics.lowStock, Package]];
  return <div className="admin-content"><div className="admin-metric-grid">{cards.map(([label, value, Icon]) => <div className="admin-metric" key={label}><span><Icon size={17} /></span><small>{label}</small><strong>{value}</strong></div>)}</div><div className="admin-dashboard-grid"><div className="admin-panel"><div className="admin-panel-heading"><h2>Recent orders</h2><span>{orders.length} loaded</span></div>{orders.slice(0, 6).map((order) => <div className="admin-mini-row" key={order.id}><div><strong>#{order.id.slice(0, 8).toUpperCase()}</strong><small>{order.customer?.fullName || order.customerName || "Customer"}</small></div><b>{money(order.totalAmount ?? order.total)}</b><em className={`admin-status ${statusFor(order).toLowerCase()}`}>{statusFor(order)}</em></div>)}{orders.length === 0 && <p className="admin-muted">No orders yet.</p>}</div><div className="admin-panel"><div className="admin-panel-heading"><h2>Stock watch</h2><span>{products.filter((product) => Number(product.stock || 0) <= 5).length} loaded items</span></div>{products.filter((product) => Number(product.stock || 0) <= 5).slice(0, 7).map((product) => <div className="admin-mini-row" key={product.id}><div><strong>{product.name}</strong><small>{product.partNumber || product.category}</small></div><b className="admin-stock-low">{product.stock || 0} left</b></div>)}{products.filter((product) => Number(product.stock || 0) <= 5).length === 0 && <p className="admin-muted">No low-stock items in the loaded products.</p>}</div></div></div>;
}

function ProductsSection({ products, searchQuery, setSearchQuery, openProduct, toggleProduct, removeProduct, loadMore, hasMore, loadingMore, loadPendingApproval, loadingPendingApproval, approvalError }) {
  return <div className="admin-content"><div className="admin-section-toolbar"><label className="admin-search"><Search size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search loaded products" /></label><button className="admin-secondary" type="button" onClick={loadPendingApproval} disabled={loadingPendingApproval}>{loadingPendingApproval ? "Loading pending products..." : "Select products to approve"}</button><button className="admin-primary" onClick={() => openProduct()}><Plus size={16} /> Add product</button></div>{approvalError && <p className="admin-bulk-approval-error" role="alert">{approvalError}</p>}<div className="admin-panel admin-table-panel"><div className="admin-table admin-product-table"><div className="admin-table-head"><span>Product</span><span>Category</span><span>Price</span><span>Stock</span><span>Status</span><span>Actions</span></div>{products.map((product) => <div className="admin-table-row" key={product.id}><div className="admin-product-cell"><div className="admin-product-image">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <ImagePlus size={16} />}</div><span><strong>{product.name}</strong><small>{product.partNumber || product.brand || "No part number"}</small></span></div><span>{product.category || "Other"}</span><strong>{money(product.price)}</strong><span className={Number(product.stock || 0) <= 5 ? "admin-stock-low" : ""}>{product.stock || 0}</span><em className={`admin-status ${product.enabled === false || product.status === "Disabled" ? "disabled" : "available"}`}>{product.enabled === false || product.status === "Disabled" ? "Disabled" : "Enabled"}</em><div className="admin-actions"><button onClick={() => toggleProduct(product)} title="Enable or disable"><Check size={15} /></button><button onClick={() => openProduct(product)} title="Edit"><Edit3 size={15} /></button><button onClick={() => removeProduct(product)} title="Delete"><Trash2 size={15} /></button></div></div>)}</div>{products.length === 0 && <p className="admin-muted">No products match this search.</p>}{hasMore && <div className="admin-section-toolbar"><button className="admin-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading products..." : "Load more products"}</button></div>}</div></div>;
}

function PendingApprovalModal({ products, selectedIds, toggle, setSelectedIds, approve, approving, progress, close }) {
  const allSelected = products.length > 0 && selectedIds.length === products.length;
  return (
    <div className="admin-modal-backdrop">
      <section className="admin-modal admin-approval-modal" role="dialog" aria-modal="true" aria-labelledby="pending-approval-title">
        <header><div><p>VENDOR PRODUCT REVIEW</p><h2 id="pending-approval-title">Select pending products</h2></div></header>
        <div className="admin-approval-toolbar">
          <label><input type="checkbox" checked={allSelected} disabled={approving || products.length === 0} onChange={(event) => setSelectedIds(event.target.checked ? products.map((product) => product.id) : [])} /> Select all {products.length} products</label>
          <span>{selectedIds.length} selected</span>
        </div>
        {products.length === 0 ? <p className="admin-muted">No pending vendor products from approved vendors were found.</p> : (
          <div className="admin-approval-list">
            {products.map((product) => <label className="admin-approval-select-row" key={product.id}>
              <input type="checkbox" checked={selectedIds.includes(product.id)} disabled={approving} onChange={() => toggle(product.id)} />
              <span><strong>{product.name || "Unnamed product"}</strong><small>{[product.partNumber, product.brand, product.businessName].filter(Boolean).join(" · ") || `Product ID ${product.id}`}</small></span>
            </label>)}
          </div>
        )}
        {approving && <p className="admin-muted" role="status">Approving {progress.completed} of {progress.total} selected products…</p>}
        <footer><button className="admin-secondary" type="button" onClick={close} disabled={approving}>Cancel</button><button className="admin-primary" type="button" onClick={approve} disabled={approving || !selectedIds.length}>{approving ? "Approving selected…" : `Approve ${selectedIds.length} selected`}</button></footer>
      </section>
    </div>
  );
}

function ApprovalResultModal({ result, close }) {
  return (
    <div className="admin-modal-backdrop">
      <section className="admin-modal admin-approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-result-title">
        <header><div><p>VENDOR PRODUCT REVIEW</p><h2 id="approval-result-title">Approval complete</h2></div></header>
        <p className="admin-muted">Approved {result.approved.length} of {result.requestedCount} selected products.</p>
        {result.approved.length > 0 ? <div className="admin-approval-list">{result.approved.map(({ product, businessName }) => <div key={product.id}><strong>{product.name || "Unnamed product"}</strong><small>{[product.partNumber, product.brand, businessName].filter(Boolean).join(" · ") || `Product ID ${product.id}`}</small></div>)}</div> : <p className="admin-muted">No products were approved. Check the skipped reasons below and try again.</p>}
        {result.skipped.length > 0 && <details className="admin-approval-skipped"><summary>{result.skipped.length} item(s) skipped or failed</summary><ul>{result.skipped.map((item) => <li key={item.productId}><span>{item.productId}</span> — {item.reason}</li>)}</ul></details>}
        {result.remainingEligibleNotAttempted > 0 && <p className="admin-muted">{result.remainingEligibleNotAttempted} other pending vendor product(s) were not processed.</p>}
        <footer><button className="admin-primary" onClick={close}>Done</button></footer>
      </section>
    </div>
  );
}

function OrdersSection({ orders, filter, setFilter, updateOrder, reconcileCodOrder, retryOrder, retryingOrderId, loadMore, hasMore, loadingMore }) {
  return (
    <div className="admin-content">
      <div className="admin-filter-tabs">{["All", ...ORDER_STATUSES].map((status) => <button className={filter === status ? "is-active" : ""} key={status} onClick={() => setFilter(status)}>{status.replace(/_/g, " ")}</button>)}</div>
      <div className="admin-order-grid">
        {orders.map((order) => {
          const tracking = order.tracking || {};
          const canRetry = ["shiprocket_failed", "pickup_failed"].includes(order.shippingStatus);
          const latestUpdate = tracking.latestUpdate || order.timeline?.at(-1)?.note || "Awaiting Shiprocket update";
          return (
            <article className="admin-order-card" key={order.id}>
              <div className="admin-order-card-head"><div><small>ORDER #{order.id.slice(0, 10).toUpperCase()}</small><h2>{order.customer?.fullName || order.customerName || "Guest customer"}</h2></div><em className={`admin-status ${statusFor(order).toLowerCase()}`}>{statusFor(order).replace(/_/g, " ")}</em></div>
              <div className="admin-order-meta"><span>{order.customer?.phone || order.customerPhone || "No phone"}</span><span>{order.customer?.city || order.address || "No address"}</span><span>Payment: {order.paymentMethod || "COD"}</span><span>Shipping: {order.shippingStatus || "pending"}</span></div>
              <div className="admin-shipping-details">
                <span>Shiprocket order: {tracking.shiprocketOrderId || order.shiprocketOrderId || "Pending"}</span>
                <span>Shipment ID: {tracking.shipmentId || order.shipmentId || "Pending"}</span>
                <span>AWB: {tracking.awb || tracking.trackingId || "Pending"}</span>
                <span>Courier: {tracking.courier || "Pending"}</span>
                <span>Estimated delivery: {tracking.estimatedDelivery || "Pending"}</span>
                <span>Latest update: {latestUpdate}</span>
              </div>
              <div className="admin-order-items">{(order.items || []).map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name || item.title} × {item.quantity || 1}</span><b>{money(Number(item.price || 0) * Number(item.quantity || 1))}</b></div>)}</div>
              <div className="admin-order-footer"><strong>{money(order.totalAmount ?? order.total)}</strong><select value={statusFor(order)} onChange={(event) => updateOrder(order, event.target.value)}>{[...new Set([...ORDER_STATUSES, statusFor(order)])].map((status) => <option key={status} value={status} disabled={WORKFLOW_ORDER_STATUSES.has(status)}>{status.replace(/_/g, " ")}</option>)}</select>{order.paymentMethod === "COD" && statusFor(order) === "delivered" && order.paymentStatus !== "COD collected" && <button className="admin-secondary" onClick={() => reconcileCodOrder(order)}>Reconcile COD</button>}{canRetry && <button className="admin-secondary" disabled={retryingOrderId === order.id} onClick={() => retryOrder(order)}>{retryingOrderId === order.id ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />} Retry Shiprocket</button>}</div>
            </article>
          );
        })}
      </div>
      {orders.length === 0 && <div className="admin-empty"><ShoppingCart size={32} /><p>No orders in this view.</p></div>}
      {hasMore && <div className="admin-section-toolbar"><button className="admin-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading orders..." : "Load older orders"}</button></div>}
    </div>
  );
}

function ReturnsSection({ requests, review }) {
  const transitions = { submitted: ["under_review", "rejected"], under_review: ["pickup_pending", "rejected", "closed"], pickup_pending: ["received", "rejected"], received: ["approved", "rejected", "closed"], approved: ["closed"], rejected: [], closed: [] };
  return <div className="admin-content"><div className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><h2>Customer return requests</h2><span>Review claims individually. Evidence supports review but its absence does not decide the outcome.</span></div><span>{requests.length} requests</span></div>{requests.length === 0 ? <p className="admin-muted">No return requests have been submitted.</p> : requests.map((request) => <article className="admin-return-card" key={request.id}><header><div><small>ORDER #{String(request.orderId).slice(0, 12).toUpperCase()} · {request.userId}</small><h3>{request.status.replace(/_/g, " ")}</h3></div><time>{request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "—"}</time></header><p>{request.reason}</p>{request.serialNumber && <p>Serial number: {request.serialNumber}</p>}<div className="admin-return-items">{(request.items || []).map((item) => <span key={`${item.productId}:${item.sellerId}`}>{item.name} · {item.partNumber || item.productId} · Qty {item.quantity} · {item.sellerType === "vendor" ? `Vendor ${item.sellerId}` : "PARTSWALA"}</span>)}</div>{request.evidenceImages?.length > 0 && <div className="admin-return-evidence">{request.evidenceImages.map((image) => <a href={image} target="_blank" rel="noreferrer" key={image}><img src={image} alt="Return evidence" /></a>)}</div>}{request.refundRequestId && <small>Refund request: {request.refundRequestId}</small>}<div className="admin-return-actions">{(transitions[request.status] || []).map((status) => <button className={status === "rejected" ? "admin-secondary" : "admin-primary"} key={status} onClick={() => review(request, status)}>{status.replace(/_/g, " ")}</button>)}{request.status === "approved" && request.refundRequestId && request.refundProvider === "manual_cod" && <button className="admin-primary" onClick={() => review(request, "manual_refund_complete")}>Confirm COD refund</button>}</div>{request.adminNote && <small>Admin note: {request.adminNote}</small>}</article>)}</div></div>;
}

function CustomersSection({ customers, searchQuery, setSearchQuery, orders, loadMore, hasMore, loadingMore }) {
  return <div className="admin-content"><div className="admin-section-toolbar"><label className="admin-search"><Search size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search loaded customers" /></label><span className="admin-count">{customers.length} loaded</span></div><div className="admin-customer-grid">{customers.map((customer) => { const customerOrders = orders.filter((order) => order.userId === customer.id || order.userEmail === customer.email); return <article className="admin-customer-card" key={customer.id}><div className="admin-customer-avatar">{customer.photoURL ? <img src={customer.photoURL} alt="" /> : (customer.displayName || customer.email || "U").charAt(0).toUpperCase()}</div><h2>{customer.displayName || "Unnamed customer"}</h2><p>{customer.email || "No email"}</p><p>{customer.phone || "No phone"}</p><div><span>{customerOrders.length} loaded orders</span><span>{money(customerOrders.reduce((total, order) => total + Number(order.totalAmount ?? order.total ?? 0), 0))}</span></div><details><summary>Order history</summary>{customerOrders.length ? customerOrders.map((order) => <p key={order.id}>#{order.id.slice(0, 8)} · {statusFor(order)} · {money(order.totalAmount ?? order.total)}</p>) : <p>No loaded orders.</p>}</details></article>; })}</div>{hasMore && <div className="admin-section-toolbar"><button className="admin-secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading customers..." : "Load more customers"}</button></div>}</div>;
}

function VendorApplicationsSection({ applications, review }) {
  const pending = applications.filter((application) => application.status === "pending");
  return <div className="admin-content"><div className="admin-panel-heading"><div><h2>Vendor applications</h2><span>Only approval grants vendor dashboard access.</span></div></div><div className="admin-order-grid">{applications.map((application) => <article className="admin-order-card" key={application.id}><div className="admin-order-card-head"><div><small>VENDOR ID / {application.vendorId}</small><h2>{application.businessName}</h2></div><em className={`admin-status ${application.status}`}>{application.status}</em></div><div className="admin-order-meta"><span>Owner: {application.ownerName}</span><span>Email: {application.email}</span><span>Phone: {application.phone}</span><span>Location: {[application.city, application.state, application.pincode].filter(Boolean).join(", ")}</span></div><details className="admin-submission-details"><summary>Complete business application</summary><p>{application.businessAddress}</p><p>GSTIN: {application.gstin || "Not provided"}</p><p>PAN: {application.pan || "Not provided"}</p><p>Submitted: {application.submittedAt ? new Date(application.submittedAt).toLocaleString("en-IN") : "—"}</p>{application.rejectionReason && <p>Rejection reason: {application.rejectionReason}</p>}{application.status === "pending" && <div className="admin-order-footer"><button className="admin-secondary" onClick={() => review(application, "rejected")}>Reject application</button><button className="admin-primary" onClick={() => review(application, "approved")}>Approve vendor</button></div>}</details></article>)}</div>{pending.length === 0 && applications.length === 0 && <div className="admin-empty"><Users size={32} /><p>No vendor applications yet.</p></div>}</div>;
}

function SubmissionsSection({ submissions, approve, reject, approvingSubmissionId }) {
  const pending = submissions.filter((submission) => String(submission.status).toLowerCase() === "pending");
  return (
    <div className="admin-content">
      <div className="admin-panel-heading">
        <div>
          <h2>Vendor product submissions</h2>
          <span>Open each complete submission before approving or rejecting it.</span>
        </div>
      </div>
      <div className="admin-order-grid">
        {submissions.map((submission) => {
          const status = String(submission.status || "pending").toLowerCase();
          const images = submission.images || (submission.imageUrl ? [submission.imageUrl] : []);
          const isApproving = approvingSubmissionId === submission.id;
          return (
            <article className="admin-order-card" key={submission.id}>
              <div className="admin-order-card-head">
                <div><small>VENDOR {submission.sellerId} · {submission.vendorName || submission.sellerEmail}</small><h2>{submission.name}</h2></div>
                <em className={`admin-status ${status}`}>{status}</em>
              </div>
              <div className="admin-order-meta">
                <span>{submission.partNumber || "No part number"}</span>
                <span>{submission.category}</span>
                <span>{money(submission.price)}</span>
                <span>{submission.stock} in stock</span>
                <span>HSN {submission.hsn || "—"}</span>
                <span>GST {submission.gstRate ?? "—"}%</span>
                <span>Submitted: {submission.submittedAt || submission.createdAt ? new Date(submission.submittedAt || submission.createdAt).toLocaleString("en-IN") : "—"}</span>
              </div>
              {status === "rejected" && <p className="admin-rejection-reason"><strong>Rejection reason:</strong> {submission.rejectionReason || "—"}</p>}
              <details className="admin-submission-details">
                <summary>Open complete submission</summary>
                <p><strong>Description</strong><br />{submission.description || "—"}</p>
                <p><strong>Brand / part number</strong><br />{submission.brand || "—"} · {submission.partNumber || "—"}</p>
                <p><strong>Price / stock</strong><br />{money(submission.price)} · {submission.stock}</p>
                <p><strong>Tax</strong><br />HSN {submission.hsn || "—"} · GST {submission.gstRate ?? "—"}%</p>
                <p><strong>Compatibility</strong><br />{submission.compatibility || "—"}</p>
                <p><strong>Weight</strong><br />{submission.weight ?? "—"} kg</p>
                <div className="admin-submission-images">
                  {images.map((image, index) => <a key={`${image}-${index}`} href={image} target="_blank" rel="noreferrer"><img src={image} alt={`${submission.name} ${index + 1}`} /></a>)}
                </div>
                {status === "pending" && (
                  <div className="admin-order-footer">
                    <button className="admin-secondary" disabled={isApproving} onClick={() => reject(submission)}>Reject with reason</button>
                    <button className="admin-primary" disabled={isApproving} onClick={() => approve(submission)}>
                      {isApproving ? <><Loader2 size={14} className="animate-spin" /> Publishing...</> : "Approve & publish"}
                    </button>
                  </div>
                )}
              </details>
            </article>
          );
        })}
      </div>
      {pending.length === 0 && submissions.length === 0 && <div className="admin-empty"><Package size={32} /><p>No vendor product submissions yet.</p></div>}
    </div>
  );
}

function FinanceSection({ finance, loading, update, reviewInvoice, refresh, loadMore, loadingMore, dateStart, dateEnd, setDateStart, setDateEnd }) {
  const cards = [
    ["Today's sales", money(finance?.todaySales)],
    ["Total sales", money(finance?.totalSales)],
    ["Gross customer collections", money(finance?.grossCustomerCollections)],
    ["Net customer collections", money(finance?.netCustomerCollections)],
    ["Taxes collected (not revenue)", money(finance?.taxesCollected)],
    ["Vendor sales", money(finance?.vendorSales)],
    ["PARTSWALA sales", money(finance?.partswalaSales)],
    ["PARTSWALA product cost", money(finance?.partswalaProductCost)],
    ["PARTSWALA product margin", money(finance?.partswalaProductMargin)],
    ["Pending vendor payouts", money(finance?.pendingVendorPayouts)],
    ["Payable vendor amount", money(finance?.payableVendorAmount)],
    ["Paid vendor amount", money(finance?.paidVendorAmount)],
    ["Platform commission", money(finance?.platformCommission)],
    ["Platform revenue", money(finance?.platformRevenue)],
    ["Platform operating expenses", money(finance?.platformOperatingExpenses)],
    ["Platform net result", money(finance?.platformNetResult)],
    ["Shipping collected", money(finance?.shippingCollected)],
    ["Actual courier cost", finance ? `${money(finance.actualShippingCost)}${finance.actualShippingCostPendingOrders ? ` · ${finance.actualShippingCostPendingOrders} missing` : ""}` : "—"],
    ["Shipping difference", finance?.shippingDifference == null ? "Not fully recorded" : money(finance.shippingDifference)],
    ["Payment gateway fees", money(finance?.paymentGatewayFees)],
    ["Gateway fee tax", money(finance?.paymentGatewayTax)],
    ["Refunds", money(finance?.refunds)],
    ["COD orders", finance?.codOrders ?? 0],
    ["Prepaid orders", finance?.prepaidOrders ?? 0],
    ["TCS / TDS held separately", `${money(finance?.tcsAmount)} / ${money(finance?.tdsAmount)}`],
  ];
  const orders = finance?.orders || [];
  const settlements = finance?.settlements || [];
  return (
    <div className="admin-content">
      <div className="admin-section-toolbar"><label>From<input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} /></label><label>Through<input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} /></label><span className="admin-count">Totals are for {finance?.reportingPeriod?.startDate || dateStart} through {finance?.reportingPeriod?.endDate || dateEnd}; accounting values are estimates until actual settlement, tax and courier records are entered.</span><button className="admin-secondary" onClick={loadMore} disabled={loading || loadingMore || (!finance?.ordersCursor && !finance?.settlementsCursor)}>{loadingMore ? "Loading details..." : "Load older finance details"}</button><button className="admin-secondary" onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "Apply period"}</button></div>
      <div className="admin-metric-grid">{cards.map(([label, value]) => <div className="admin-metric" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <div className="admin-panel admin-table-panel">
        <div className="admin-panel-heading"><h2>Vendor settlements</h2><span>{settlements.length} line items</span></div>
        {settlements.map((row) => <div className="admin-mini-row" key={row.id}>
          <div><strong>#{String(row.orderId).slice(0, 8)} · {row.productName}</strong><small>{row.vendorId} · Sale {money(row.sellerSubtotal)} · Commission -{money(row.commissionAmount)}</small></div>
          <b>{money(row.vendorPayout)}</b><em className={`admin-status ${row.settlementStatus}`}>{row.settlementStatus}</em>
          {row.settlementStatus === "payable" && <button className="admin-primary" onClick={() => update(row.orderId, { action: "settle", settlementId: row.id })}>Mark paid</button>}
        </div>)}
        {settlements.length === 0 && <p className="admin-muted">Vendor settlement entries appear when vendor products are ordered.</p>}
      </div>
      <div className="admin-panel admin-table-panel">
        <div className="admin-panel-heading"><h2>Order costs and refunds</h2><span>Enter actual provider values; no gateway or courier fee is assumed.</span></div>
        {orders.map((order) => <details className="admin-finance-order" key={order.id}>
          <summary>#{order.id.slice(0, 10).toUpperCase()} · {order.customerName || "Customer"} · {money(order.grandTotal)} · {order.paymentMethod}</summary>
          {(order.sellerInvoiceSnapshots || []).filter(needsAccountingReview).map((invoice) => <div className="admin-section-toolbar" key={invoice.invoiceNumber}><span>{invoice.seller?.name || "Seller"} invoice requires accounting review</span><button className="admin-secondary" type="button" onClick={() => reviewInvoice(order.id, invoice)}>Record review</button></div>)}
          <form className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const sellerShippingCosts = (order.sellerSuborders || []).map((seller, index) => ({ sellerId: seller.sellerId, sellerType: seller.sellerType, actualForwardShippingCost: form.get(`sellerForward_${index}`), actualReturnShippingCost: form.get(`sellerReturn_${index}`) })); void update(order.id, { action: "costs", actualForwardShippingCost: Number(form.get("actualForwardShippingCost")), actualReturnShippingCost: form.get("actualReturnShippingCost") || null, ...(sellerShippingCosts.length > 1 ? { sellerShippingCosts } : {}), paymentGatewayFee: Number(form.get("paymentGatewayFee")), paymentGatewayTax: Number(form.get("paymentGatewayTax")), tcsAmount: Number(form.get("tcsAmount")), tdsAmount: Number(form.get("tdsAmount")) }); }}>
            {(order.sellerSuborders || []).length > 1 ? order.sellerSuborders.map((seller, index) => <div className="admin-inline-form" key={seller.id || `${seller.sellerType}:${seller.sellerId}`}><strong>{seller.sellerType === "vendor" ? seller.sellerId : "PARTSWALA"} shipment</strong><label>Actual forward cost<input required min="0" step="0.01" type="number" name={`sellerForward_${index}`} defaultValue={seller.actualForwardShippingCost ?? ""} /></label><label>Actual return / RTO cost<input min="0" step="0.01" type="number" name={`sellerReturn_${index}`} defaultValue={seller.actualReturnShippingCost ?? ""} /></label></div>) : <><label>Actual forward shipping cost<input required min="0" step="0.01" type="number" name="actualForwardShippingCost" defaultValue={order.actualForwardShippingCost ?? order.actualShippingCost ?? ""} /></label><label>Actual return / RTO cost<input min="0" step="0.01" type="number" name="actualReturnShippingCost" defaultValue={order.actualReturnShippingCost ?? ""} /></label></>}
            <label>Payment gateway fee<input required min="0" step="0.01" type="number" name="paymentGatewayFee" defaultValue={order.paymentGatewayFee || 0} /></label>
            <label>Gateway fee tax<input required min="0" step="0.01" type="number" name="paymentGatewayTax" defaultValue={order.paymentGatewayTax || 0} /></label>
            <label>TCS amount<input required min="0" step="0.01" type="number" name="tcsAmount" defaultValue={order.tcsAmount || 0} /></label>
            <label>TDS amount<input required min="0" step="0.01" type="number" name="tdsAmount" defaultValue={order.tdsAmount || 0} /></label>
            <button className="admin-primary" type="submit">Save actual costs</button>
            <button className="admin-secondary" type="button" onClick={() => { const refundable = (order.items || []).filter((item) => Number(item.refundedQuantity || 0) < Number(item.remainingQuantity ?? item.quantity ?? 0)); if (!refundable.length) return; const choices = refundable.map((item, index) => `${index + 1}. ${item.name || item.productName || item.productId} (${Number(item.remainingQuantity ?? item.quantity ?? 0) - Number(item.refundedQuantity || 0)} available)`).join("\n"); const selected = Number(window.prompt(`Select product number to refund:\n${choices}`, "1")) - 1; const item = refundable[selected]; if (!item) return; const available = Number(item.remainingQuantity ?? item.quantity ?? 0) - Number(item.refundedQuantity || 0); const quantity = Number(window.prompt(`Refund quantity (1-${available}):`, "1")); if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) return; const reason = window.prompt("Reason for refund:", ""); if (!reason?.trim()) return; void requestAdminRefund(order.id, [{ productId: item.productId, quantity }], reason.trim()).then(async (result) => { if (result.provider === "manual_cod") { const reference = window.prompt("Enter the completed manual COD refund reference to confirm:", ""); if (reference?.trim()) await completeManualAdminRefund(result.refundRequestId, reference.trim()); } await loadFinance(); }).catch((error) => showToast?.(error.message || "Refund request failed.", "error")); }}>Refund selected item</button>
            <small>Shipping charged {money(order.shippingChargedToCustomer)} · actual {order.actualShippingCost == null ? "not recorded" : money(order.actualShippingCost)} · refunded {money(order.refundedAmount)}</small>
          </form>
        </details>)}
        {orders.length === 0 && <p className="admin-muted">No orders to reconcile.</p>}
      </div>
    </div>
  );
}

function CategoriesSection({ categories, name, setName, editing, setEditing, save, remove }) {
  return <div className="admin-content"><div className="admin-panel admin-category-panel"><div className="admin-panel-heading"><div><h2>{editing ? "Edit category" : "Add category"}</h2><span>Keep the storefront taxonomy tidy.</span></div></div><form className="admin-inline-form" onSubmit={save}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Category name" /><button className="admin-primary" type="submit">{editing ? "Save changes" : "Add category"}</button>{editing && <button type="button" className="admin-secondary" onClick={() => { setEditing(null); setName(""); }}>Cancel</button>}</form></div><div className="admin-category-grid">{categories.map((category) => <div className="admin-category-card" key={category.id}><span>{category.name}</span><div><button onClick={() => { setEditing(category.id); setName(category.name); }}><Edit3 size={14} /></button><button onClick={() => remove(category)}><Trash2 size={14} /></button></div></div>)}{categories.length === 0 && <p className="admin-muted">No custom categories yet. The default catalogue categories are available to products.</p>}</div></div>;
}

function SettingsSection({ settings, setSettings, save }) {
  const update = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  return <div className="admin-content"><form className="admin-panel admin-settings-form" onSubmit={save}>
    <div className="admin-panel-heading"><div><h2>Store settings</h2><span>Business details, tax location and checkout charges.</span></div></div>
    <label>Store name<input value={settings.storeName} onChange={(event) => update("storeName", event.target.value)} /></label>
    <label>Logo URL<input value={settings.logo} onChange={(event) => update("logo", event.target.value)} placeholder="https://..." /></label>
    <div className="admin-two-col"><label>Phone<input value={settings.phone} onChange={(event) => update("phone", event.target.value)} /></label><label>Email<input type="email" value={settings.email} onChange={(event) => update("email", event.target.value)} /></label></div>
    <label>Address<textarea rows="3" value={settings.address} onChange={(event) => update("address", event.target.value)} /></label>
    <div className="admin-two-col"><label>GST details<input value={settings.gst} onChange={(event) => update("gst", event.target.value)} placeholder="GSTIN" /></label><label>Business state<input required value={settings.businessState} onChange={(event) => update("businessState", event.target.value)} placeholder="State registered for GST" /></label></div>
    <label>Applicable product GST rate (%)<input required min="0" max="100" step="0.01" type="number" value={settings.productGstRate ?? 18} onChange={(event) => update("productGstRate", event.target.value)} /></label>
    <div className="admin-two-col"><label>Store pickup pincode<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={settings.pickupPincode} onChange={(event) => update("pickupPincode", event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit pickup pincode" /></label><label>Free shipping threshold (0 disables)<input required min="0" step="0.01" type="number" value={settings.freeShippingThreshold} onChange={(event) => update("freeShippingThreshold", event.target.value)} /></label></div>
    <div className="admin-two-col"><label>Vendor Commission (%)<input required min="0" max="100" step="0.01" type="number" value={settings.vendorCommissionRate ?? 10} onChange={(event) => update("vendorCommissionRate", event.target.value)} /></label><label>Platform service fee (%)<input required min="0" max="100" step="0.01" type="number" value={settings.platformServiceFeeRate ?? 0} onChange={(event) => update("platformServiceFeeRate", event.target.value)} /></label></div>
    <label>Vendor share of gateway fee (%)<input required min="0" max="100" step="0.01" type="number" value={settings.vendorGatewayFeeShareRate ?? 0} onChange={(event) => update("vendorGatewayFeeShareRate", event.target.value)} /></label>
    <div className="admin-two-col"><label>Settlement hold after delivery (days)<input required min="0" max="365" step="1" type="number" value={settings.settlementHoldDays ?? 7} onChange={(event) => update("settlementHoldDays", event.target.value)} /></label><label>Product prices include GST<select value={settings.pricesIncludeGst === false ? "no" : "yes"} onChange={(event) => update("pricesIncludeGst", event.target.value === "yes")}><option value="no">No, add GST to price</option><option value="yes">Yes, GST is included</option></select></label></div>
    <label>Shipping difference policy<select value={settings.shippingDifferencePolicy || "absorb"} onChange={(event) => update("shippingDifferencePolicy", event.target.value)}><option value="absorb">Absorb difference</option><option value="pass_through">Pass through at cost</option><option value="retain">Retain positive difference as platform revenue</option></select></label>
    <div className="admin-two-col"><label>COD fee<input required min="0" step="0.01" type="number" value={settings.codFee} onChange={(event) => update("codFee", event.target.value)} /></label><label>COD-fee GST treatment<select required value={settings.codFeeTaxTreatment} onChange={(event) => update("codFeeTaxTreatment", event.target.value)}><option value="">Choose explicitly</option><option value="taxable">Include COD fee in GST taxable value</option><option value="non_taxable">Keep COD fee outside GST taxable value</option></select></label></div>
    <label>Shipping GST treatment<select required value={settings.shippingTaxTreatment} onChange={(event) => update("shippingTaxTreatment", event.target.value)}><option value="">Choose explicitly</option><option value="taxable">Include shipping in GST taxable value</option><option value="non_taxable">Keep shipping outside GST taxable value</option></select></label>
    <button className="admin-primary" type="submit"><Check size={16} /> Save settings</button>
  </form></div>;
}

function AssistantSettingsSection({ settings, setSettings, save }) {
  const update = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  return <div className="admin-content"><form className="admin-panel admin-settings-form" onSubmit={save}>
    <div className="admin-panel-heading"><div><h2>AI Assistant Settings</h2><span>Configure customer-facing help content. Do not enter API keys here.</span></div></div>
    <label className="admin-toggle-field"><input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} /> Enable assistant</label>
    <label>Assistant name<input value={settings.assistantName} onChange={(event) => update("assistantName", event.target.value)} /></label>
    <label>Welcome message<textarea rows="3" value={settings.welcomeMessage} onChange={(event) => update("welcomeMessage", event.target.value)} /></label>
    <div className="admin-two-col"><label>Support email<input type="email" value={settings.supportEmail} onChange={(event) => update("supportEmail", event.target.value)} /></label><label>Support phone<input value={settings.supportPhone} onChange={(event) => update("supportPhone", event.target.value)} /></label></div>
    <label>WhatsApp number<input value={settings.whatsAppNumber} onChange={(event) => update("whatsAppNumber", event.target.value)} placeholder="Country code + number" /></label>
    <label>Return and refund policy<textarea rows="4" value={settings.returnPolicy} onChange={(event) => update("returnPolicy", event.target.value)} /></label>
    <label>Shipping information<textarea rows="4" value={settings.shippingInformation} onChange={(event) => update("shippingInformation", event.target.value)} /></label>
    <label>Payment information<textarea rows="4" value={settings.paymentInformation} onChange={(event) => update("paymentInformation", event.target.value)} /></label>
    <label>Business information<textarea rows="4" value={settings.businessInformation} onChange={(event) => update("businessInformation", event.target.value)} /></label>
    <label>FAQs (JSON)<textarea rows="9" spellCheck="false" value={settings.faqJson} onChange={(event) => update("faqJson", event.target.value)} placeholder={'[{"category":"Orders","question":"How do I track an order?","answer":"Sign in and open My Orders."}]'} /></label>
    <button className="admin-primary" type="submit"><Check size={16} /> Save assistant settings</button>
  </form></div>;
}

function ProductModal({ product, setProduct, setImage, categories, saving, editing, gstRate, save, close }) {
  const update = (key, value) => setProduct((previous) => ({ ...previous, [key]: value }));
  return <div className="admin-modal-backdrop"><form className="admin-modal" onSubmit={save}>
    <header><div><p>INVENTORY / {editing ? "EDIT" : "NEW"}</p><h2>{editing ? "Edit product" : "Add product"}</h2></div><button type="button" onClick={close}><X size={18} /></button></header>
    <div className="admin-modal-fields">
      <label>Product name<input required value={product.name} onChange={(event) => update("name", event.target.value)} /></label>
      <div className="admin-two-col"><label>Part number / SKU<input required value={product.partNumber} onChange={(event) => update("partNumber", event.target.value)} /></label><label>Brand<input value={product.brand} onChange={(event) => update("brand", event.target.value)} /></label></div>
      <div className="admin-two-col"><label>Category<select required value={product.category} onChange={(event) => update("category", event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Stock<input required min="0" type="number" value={product.stock} onChange={(event) => update("stock", event.target.value)} /></label></div>
      <div className="admin-two-col"><label>MRP<input min="0" step="0.01" type="number" value={product.mrp} onChange={(event) => update("mrp", event.target.value)} /></label><label>Selling price<input required min="0" step="0.01" type="number" value={product.price} onChange={(event) => update("price", event.target.value)} /></label></div>
      {product.sellerType !== "vendor" && <label>PARTSWALA purchase cost <span>Admin-only; used for product margin</span><input min="0" step="0.01" type="number" value={product.costPrice ?? ""} onChange={(event) => update("costPrice", event.target.value)} /></label>}
      <div className="admin-two-col"><label>HSN code<input required value={product.hsn} onChange={(event) => update("hsn", event.target.value)} /></label><div className="fixed-gst-field"><span>GST rate</span><strong>{gstRate}%</strong><small>Managed in store tax settings</small></div></div>
      <label>Product discount (%)<input min="0" max="100" step="0.01" type="number" value={product.discountPercent} onChange={(event) => update("discountPercent", event.target.value)} /></label>
      <label>Compatibility / fitment <span>Optional</span><input value={product.compatibility || ""} onChange={(event) => update("compatibility", event.target.value)} /></label>
      <label>Weight in kg *<input required min="0.01" step="0.01" type="number" value={product.weight} onChange={(event) => update("weight", event.target.value)} /></label>
      <div className="admin-dimensions"><span>Package dimensions <em>Optional</em></span><div><label>Length (cm)<input min="0" step="0.1" type="number" value={product.length} onChange={(event) => update("length", event.target.value)} /></label><label>Width (cm)<input min="0" step="0.1" type="number" value={product.width} onChange={(event) => update("width", event.target.value)} /></label><label>Height (cm)<input min="0" step="0.1" type="number" value={product.height} onChange={(event) => update("height", event.target.value)} /></label></div></div>
      <ShippingEstimateCard weight={product.weight} length={product.length} width={product.width} height={product.height} />
      <label>Description<textarea rows="4" value={product.description} onChange={(event) => update("description", event.target.value)} /></label>
      <label className="admin-file-field">Product image<input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0] || null)} />{product.imageUrl && <img src={product.imageUrl} alt="Current product" />}</label>
      <label className="admin-toggle-field"><input type="checkbox" checked={product.enabled} onChange={(event) => update("enabled", event.target.checked)} /> Product enabled</label>
    </div>
    <footer><button type="button" className="admin-secondary" onClick={close}>Cancel</button><button type="submit" className="admin-primary" disabled={saving}>{saving ? <Loader2 size={16} /> : <Check size={16} />} {editing ? "Save product" : "Add product"}</button></footer>
  </form></div>;
}
