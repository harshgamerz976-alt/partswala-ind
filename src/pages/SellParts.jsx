import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Eye, Loader2, PackagePlus, Pencil, RotateCcw, Send, Store, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { useAuth } from "../context/useAuth";
import { db } from "../firebase";
import { uploadImageToCloudinary } from "../services/cloudinaryService";
import { getVendorDashboard, getVendorPickupLocation, saveVendorPickupLocation } from "../services/orderService";
import ShippingEstimateCard from "../components/ShippingEstimateCard";

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const EMPTY_PRODUCT = { name: "", partNumber: "", brand: "", category: "Engine Parts", mrp: "", price: "", stock: "", compatibility: "", weight: "", length: "", width: "", height: "", description: "" };
const EMPTY_PICKUP = { name: "", contactPerson: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "", pincode: "", country: "India" };
const CATEGORIES = [
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

function statusLabel(status) {
  if (status === "pending") return "Pending Review";
  return status === "approved" ? "Approved" : "Rejected";
}

function money(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function displayDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-IN") : "—";
}

export default function SellParts() {
  const { currentUser, userProfile, logout, showToast } = useAuth();
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [submissions, setSubmissions] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [message, setMessage] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [editingProduct, setEditingProduct] = useState(null);
  const [pickup, setPickup] = useState(EMPTY_PICKUP);
  const [pickupLoading, setPickupLoading] = useState(true);
  const [pickupSaving, setPickupSaving] = useState(false);
  const [pickupMessage, setPickupMessage] = useState("");

  const loadSubmissions = useCallback(async () => {
    setRefreshing(true);
    try {
      const snapshot = await getDocs(query(collection(db, "sellerSubmissions"), where("sellerId", "==", currentUser.uid)));
      setSubmissions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((left, right) => String(right.submittedAt || right.createdAt || "").localeCompare(String(left.submittedAt || left.createdAt || ""))));
      setMessage("");
    } catch (error) {
      console.error("Vendor submissions could not be loaded:", error);
      setMessage("Your submissions could not be loaded. Please refresh the page.");
    } finally {
      setRefreshing(false);
    }
  }, [currentUser.uid]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      setDashboard(await getVendorDashboard());
    } catch (error) {
      setDashboardError(error.message || "Vendor dashboard data could not be loaded.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    let active = true;
    getVendorPickupLocation().then((result) => {
      if (active && result.pickupLocation) setPickup({ ...EMPTY_PICKUP, ...result.pickupLocation });
    }).catch((error) => { if (active) setPickupMessage(error.message || "Pickup location could not be loaded."); }).finally(() => { if (active) setPickupLoading(false); });
    return () => { active = false; };
  }, []);

  function updateField(event) {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  function updatePickup(event) {
    setPickup((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submitPickup(event) {
    event.preventDefault();
    setPickupSaving(true);
    setPickupMessage("");
    try {
      const result = await saveVendorPickupLocation(pickup);
      setPickup({ ...EMPTY_PICKUP, ...result.pickupLocation });
      setPickupMessage("Pickup location saved. New shipping quotes will use this address.");
    } catch (error) {
      setPickupMessage(error.message || "Pickup location could not be saved.");
    } finally {
      setPickupSaving(false);
    }
  }

  function chooseImages(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length + selectedImages.length + existingImages.length > MAX_IMAGES) {
      setMessage(`A product submission can include at most ${MAX_IMAGES} images.`);
      return;
    }
    if (files.some((file) => !file.type.startsWith("image/") || file.size > MAX_IMAGE_SIZE)) {
      setMessage("Select image files no larger than 5 MB each.");
      return;
    }
    setMessage("");
    setSelectedImages((previous) => [...previous, ...files]);
  }

  function startResubmission(submission) {
    setEditingSubmission(submission);
    setEditingProduct(null);
    setForm({ ...EMPTY_PRODUCT, ...submission, length: submission.dimensions?.length || "", width: submission.dimensions?.width || "", height: submission.dimensions?.height || "" });
    setExistingImages(submission.images || (submission.imageUrl ? [submission.imageUrl] : []));
    setSelectedImages([]);
    setMessage("");
    document.getElementById("vendor-product-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetForm() {
    setEditingSubmission(null);
    setEditingProduct(null);
    setForm(EMPTY_PRODUCT);
    setExistingImages([]);
    setSelectedImages([]);
    setMessage("");
  }

  function hasCompletePickupLocation() {
    return Boolean(
      pickup?.name &&
      pickup?.contactPerson &&
      pickup?.phone &&
      pickup?.addressLine1 &&
      pickup?.city &&
      pickup?.state &&
      /^\d{6}$/.test(String(pickup?.pincode || ""))
    );
  }

  function startProductEdit(product) {
    setEditingSubmission(null);
    setEditingProduct(product);
    setForm({ ...EMPTY_PRODUCT, ...product, length: product.dimensions?.length || "", width: product.dimensions?.width || "", height: product.dimensions?.height || "" });
    setExistingImages(product.images || (product.imageUrl ? [product.imageUrl] : []));
    setSelectedImages([]);
    setMessage("");
    document.getElementById("vendor-product-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitProduct(event) {
    event.preventDefault();
    if (!hasCompletePickupLocation()) {
      setMessage("Save a complete vendor pickup location and valid 6-digit pincode before submitting a product.");
      return;
    }
    const numericFields = ["price", "mrp", "stock", "weight", "length", "width", "height"];
    if (numericFields.some((field) => form[field] !== "" && (!Number.isFinite(Number(form[field])) || Number(form[field]) < 0))) {
      setMessage("Enter valid non-negative numbers for price, stock, weight, and dimensions.");
      return;
    }
    if (!form.partNumber.trim() || form.weight === "" || Number(form.weight) <= 0) {
      setMessage("Part number and a positive shipping weight are required.");
      return;
    }
    if (existingImages.length + selectedImages.length === 0) {
      setMessage("Add at least one product image before submitting.");
      return;
    }
    if (existingImages.length + selectedImages.length > MAX_IMAGES) {
      setMessage(`A product submission can include at most ${MAX_IMAGES} images.`);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const timestamp = new Date().toISOString();
      const imageUrls = [...existingImages];
      const submissionId = editingSubmission?.id || crypto.randomUUID();
      const submissionRef = doc(db, "sellerSubmissions", submissionId);
      const uploadedUrls = await Promise.all(selectedImages.map((file) => uploadImageToCloudinary(file, "submission")));
      imageUrls.push(...uploadedUrls);
      if (imageUrls.length > MAX_IMAGES) throw new Error(`A product submission can include at most ${MAX_IMAGES} images.`);
      const productData = {
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        brand: form.brand.trim(),
        partNumber: form.partNumber.trim(),
        mrp: Number(form.mrp || 0),
        price: Number(form.price || 0),
        stock: Number(form.stock || 0),
        hsn: "",
        gstRate: dashboard?.vendor?.gstRate ?? 18,
        compatibility: String(form.compatibility || "").trim(),
        weight: Number(form.weight),
        dimensions: { length: Number(form.length || 0), width: Number(form.width || 0), height: Number(form.height || 0) },
        images: imageUrls,
        imageUrl: imageUrls[0] || "",
        sellerId: currentUser.uid,
        vendorName: userProfile?.vendorProfile?.businessName || userProfile?.displayName || "Vendor",
        status: "pending",
        rejectionReason: "",
        submittedAt: timestamp,
      };
      if (editingSubmission) {
        const latest = await getDoc(submissionRef);
        if (!latest.exists() || String(latest.data().status).toLowerCase() !== "rejected") throw new Error("Only rejected submissions can be resubmitted.");
        await updateDoc(submissionRef, { ...productData, resubmittedAt: timestamp });
      } else {
        await setDoc(submissionRef, {
          ...productData,
          ...(!editingSubmission && editingProduct?.id ? { existingProductId: editingProduct.id } : {}),
          sellerEmail: currentUser.email || "",
          createdAt: timestamp,
          reviewHistory: [],
        });
      }
      const wasEditing = Boolean(editingSubmission);
      const wasEditingProduct = Boolean(editingProduct || editingSubmission?.existingProductId);
      resetForm();
      showToast?.(wasEditing ? "Product resubmitted for review" : wasEditingProduct ? "Product update sent for review" : "Product submitted for review", "success");
      await loadSubmissions();
      await loadDashboard();
    } catch (error) {
      console.error("Vendor product submission failed:", error);
      setMessage(error.message || "Could not submit this product. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const vendorProfile = userProfile?.vendorProfile || {};
  const vendorName = dashboard?.vendor?.name || vendorProfile.businessName || userProfile?.displayName || "Vendor";
  const vendorGstRate = dashboard?.vendor?.gstRate ?? 18;
  const metrics = dashboard?.metrics || {};
  const products = dashboard?.products || [];
  const orders = dashboard?.orders || [];
  const settlements = dashboard?.settlements || [];

  return (
    <main className="vendor-page vendor-dashboard">
      <header className="vendor-dashboard-header"><div><p className="vendor-kicker">PARTSWALA IND · VENDOR WORKSPACE</p><h1>Vendor Dashboard</h1><p>{vendorName}</p></div><div className="vendor-header-actions"><button className="vendor-secondary" type="button" onClick={loadDashboard} disabled={dashboardLoading}><RotateCcw size={15} />Refresh</button><button className="vendor-secondary" type="button" onClick={logout}>Logout</button></div></header>
      {dashboardError && <p className="vendor-error vendor-dashboard-error" role="alert">{dashboardError}</p>}
      {dashboardLoading && !dashboard ? <div className="vendor-loading" role="status">Loading vendor dashboard...</div> : dashboardError && !dashboard ? <div className="vendor-load-error"><p>Vendor dashboard data is unavailable.</p><button className="vendor-secondary" type="button" onClick={loadDashboard}>Try again</button></div> : <>
        <section id="vendor-dashboard-overview" className="vendor-overview" aria-label="Business overview">
          {[
            ["Total Products", metrics.totalProducts, "count"],
            ["Active Products", metrics.activeProducts, "count"],
            ["Total Orders", metrics.totalOrders, "count"],
            ["Pending Orders", metrics.pendingOrders, "count"],
            ["Total Sales", metrics.totalSales, "money"],
            ["Pending Payout", metrics.pendingPayouts, "money"],
            ["Available Balance", metrics.availableBalance, "money"],
            ["Paid Amount", metrics.paidAmount, "money"],
          ].map(([label, value, type]) => <article className="vendor-metric" key={label}><span>{label}</span><strong>{value === undefined ? "—" : type === "money" ? money(value) : Number(value).toLocaleString("en-IN")}</strong></article>)}
        </section>
        <div className="vendor-dashboard-grid">
          <aside className="vendor-profile-panel vendor-sidebar"><div className="vendor-brand"><Store size={18} /><span>PARTSWALA</span></div><p className="vendor-kicker">VENDOR MENU</p><nav className="vendor-sidebar-menu" aria-label="Vendor dashboard sections"><a href="#vendor-dashboard-overview">Overview</a><a href="#vendor-products">Products</a><a href="#vendor-orders">Orders</a><a href="#vendor-sales">Sales</a><a href="#vendor-payouts">Payouts</a><a href="#vendor-product-form">Add Product</a><a href="#vendor-reviews">Product Reviews</a><Link to="/profile">Account Settings</Link></nav><div id="vendor-account" className="vendor-account-details"><p className="vendor-kicker">APPROVED VENDOR</p><h2>{vendorName}</h2><dl><div><dt>Owner / contact</dt><dd>{vendorProfile.ownerName || userProfile?.displayName || "—"}</dd></div><div><dt>Email</dt><dd>{currentUser.email || "—"}</dd></div><div><dt>Phone</dt><dd>{vendorProfile.phone || "—"}</dd></div><div><dt>Location</dt><dd>{[vendorProfile.city, vendorProfile.state, vendorProfile.pincode].filter(Boolean).join(", ") || "—"}</dd></div><div><dt>Vendor commission</dt><dd>{dashboard?.vendor?.commissionRate == null ? "—" : `${dashboard.vendor.commissionRate}%`}</dd></div></dl></div></aside>
          <section className="vendor-content">
            <section id="vendor-products" className="vendor-section-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">CATALOG</p><h2>My Products</h2></div><button className="vendor-primary" type="button" onClick={() => document.getElementById("vendor-product-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}><PackagePlus size={15} />Add Product</button></div>
              {dashboardLoading && !dashboard ? <p className="vendor-muted">Loading products...</p> : products.length === 0 ? <p className="vendor-empty">No products yet.</p> : <div className="vendor-table-scroll"><table className="vendor-data-table"><thead><tr><th>Product</th><th>Brand</th><th>SKU / Part No.</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="vendor-product-cell">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="vendor-product-placeholder"><Store size={16} /></span>}<strong>{product.name || "—"}</strong></div></td><td>{product.brand || "—"}</td><td>{product.partNumber || "—"}</td><td>{product.category || "—"}</td><td>{money(product.price)}</td><td>{product.stock ?? "—"}</td><td><em className={`vendor-status ${product.enabled ? "vendor-status-approved" : "vendor-status-rejected"}`}>{product.enabled ? "Active" : product.status || "Inactive"}</em></td><td><div className="vendor-row-actions"><Link to={`/products/${product.id}`} aria-label={`View ${product.name}`} title="View product"><Eye size={15} /></Link><button type="button" onClick={() => startProductEdit(product)} aria-label={`Request edit for ${product.name}`} title="Request product edit"><Pencil size={15} /></button></div></td></tr>)}</tbody></table></div>}
            </section>

            <section id="vendor-orders" className="vendor-section-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">FULFILMENT</p><h2>Vendor Orders</h2></div></div>
              {orders.length === 0 ? <p className="vendor-empty">No orders yet.</p> : <div className="vendor-table-scroll"><table className="vendor-data-table vendor-order-table"><thead><tr><th>Order / Date</th><th>Customer</th><th>Products · Qty</th><th>Subtotal</th><th>Order / Payment</th><th>Settlement / Payout</th><th>Return / Refund</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>#{String(order.orderId).slice(0, 10)}<small>{displayDate(order.createdAt)}</small></td><td>{order.customerName || "Customer"}</td><td>{order.items.map((item) => <span className="vendor-order-item" key={item.productId}>{item.name} · {item.quantity}</span>)}</td><td>{money(order.productSubtotal)}</td><td><span>{order.status}</span><small>{order.paymentStatus}</small></td><td><span className={`vendor-status vendor-status-${order.settlementStatus}`}>{order.settlementStatus}</span><small>{money(order.vendorPayout)}</small></td><td>{order.refundStatus || "—"}{order.items.some((item) => item.refundAmount > 0) && <small>{money(order.items.reduce((sum, item) => sum + item.refundAmount, 0))}</small>}</td></tr>)}</tbody></table></div>}
            </section>

            <section id="vendor-sales" className="vendor-section-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">PERFORMANCE</p><h2>Sales</h2></div><TrendingUp size={18} /></div><div className="vendor-sales-grid"><div><span>Total sales</span><strong>{metrics.totalSales === undefined ? "—" : money(metrics.totalSales)}</strong></div><div><span>This month</span><strong>{metrics.monthSales === undefined ? "—" : money(metrics.monthSales)}</strong></div><div><span>Orders</span><strong>{metrics.totalOrders ?? "—"}</strong></div><div><span>Pending orders</span><strong>{metrics.pendingOrders ?? "—"}</strong></div><div><span>Delivered orders</span><strong>{metrics.deliveredOrders ?? "—"}</strong></div><div><span>Units sold</span><strong>{metrics.unitsSold ?? "—"}</strong></div><div><span>Commission charged</span><strong>{metrics.commissionCharged === undefined ? "—" : money(metrics.commissionCharged)}</strong></div><div><span>Pending payouts</span><strong>{metrics.pendingPayouts === undefined ? "—" : money(metrics.pendingPayouts)}</strong></div><div><span>Paid payouts</span><strong>{metrics.paidAmount === undefined ? "—" : money(metrics.paidAmount)}</strong></div><div><span>Returns</span><strong>{metrics.returnOrders ?? "—"}</strong></div><div><span>Refund adjustments</span><strong>{metrics.refundAdjustments === undefined ? "—" : money(metrics.refundAdjustments)}</strong></div></div></section>

            <section id="vendor-payouts" className="vendor-section-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">SETTLEMENTS</p><h2>Payouts</h2></div></div><div className="vendor-balance-grid vendor-payout-grid"><div><span>Available balance</span><strong>{metrics.availableBalance === undefined ? "—" : money(metrics.availableBalance)}</strong></div><div><span>Pending balance</span><strong>{metrics.pendingBalance === undefined ? "—" : money(metrics.pendingBalance)}</strong></div><div><span>Paid amount</span><strong>{metrics.paidAmount === undefined ? "—" : money(metrics.paidAmount)}</strong></div><div><span>Pending payouts</span><strong>{metrics.pendingPayouts === undefined ? "—" : money(metrics.pendingPayouts)}</strong></div><div><span>Payable amount</span><strong>{metrics.payableAmount === undefined ? "—" : money(metrics.payableAmount)}</strong></div></div>
              {settlements.length === 0 ? <p className="vendor-empty">No payouts yet.</p> : settlements.map((entry) => <article className="vendor-settlement-row" key={entry.id}><div><strong>Order #{String(entry.orderId).slice(0, 10)} · {entry.productName || "Vendor sale"}</strong><span>Sale {money(entry.sellerSubtotal)} · Commission {entry.commissionRate}% ({money(entry.commissionAmount)}) · Other deductions {money(entry.otherDeductions)}</span></div><b>{money(entry.vendorPayout)}</b><em className={`vendor-status vendor-status-${entry.settlementStatus}`}>{entry.settlementStatus}</em></article>)}
            </section>

            <section id="vendor-pickup-location" className="vendor-form-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">SHIPMENT ORIGIN</p><h2>Pickup Location</h2></div><Store size={20} /></div><p className="vendor-muted">Orders for your products are collected from this address. A valid pickup location is required before selling.</p><form className="vendor-product-form" onSubmit={submitPickup}><div className="vendor-two-fields"><label>Pickup location name<input required name="name" value={pickup.name} onChange={updatePickup} /></label><label>Contact person<input required name="contactPerson" value={pickup.contactPerson} onChange={updatePickup} /></label></div><div className="vendor-two-fields"><label>Phone number<input required name="phone" inputMode="tel" value={pickup.phone} onChange={updatePickup} /></label><label>Country<input required name="country" value={pickup.country} onChange={updatePickup} /></label></div><label>Address line 1<input required name="addressLine1" value={pickup.addressLine1} onChange={updatePickup} /></label><label>Address line 2 <span>Optional</span><input name="addressLine2" value={pickup.addressLine2} onChange={updatePickup} /></label><div className="vendor-two-fields"><label>City<input required name="city" value={pickup.city} onChange={updatePickup} /></label><label>State<input required name="state" value={pickup.state} onChange={updatePickup} /></label></div><label>Pincode<input required pattern="[0-9]{6}" maxLength="6" inputMode="numeric" name="pincode" value={pickup.pincode} onChange={updatePickup} /></label>{pickupMessage && <p className="vendor-error" role="alert">{pickupMessage}</p>}<button className="vendor-primary" type="submit" disabled={pickupLoading || pickupSaving}>{pickupSaving ? "Saving..." : "Save pickup location"}</button></form></section>

            <section id="vendor-product-form" className="vendor-form-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">PRODUCT REVIEW</p><h2>{editingSubmission ? "Edit and resubmit" : editingProduct ? "Request product edit" : "Add Product"}</h2></div><PackagePlus size={20} /></div>
              <form className="vendor-product-form" onSubmit={submitProduct}>
                <label>Product name<input required name="name" value={form.name} onChange={updateField} /></label>
                <div className="vendor-two-fields"><label>Category<select required name="category" value={form.category} onChange={updateField}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label>Brand<input required name="brand" value={form.brand} onChange={updateField} /></label></div>
                <div className="vendor-two-fields"><label>Part number / SKU<input required name="partNumber" value={form.partNumber} onChange={updateField} /></label><label>Stock<input required min="0" step="1" type="number" name="stock" value={form.stock} onChange={updateField} /></label></div>
                <div className="vendor-two-fields"><label>Price<input required min="0.01" step="0.01" type="number" name="price" value={form.price} onChange={updateField} /></label><label>MRP <span>Optional</span><input min="0" step="0.01" type="number" name="mrp" value={form.mrp} onChange={updateField} /></label></div>
                <div className="vendor-two-fields"><label>GST rate</label><div className="fixed-gst-field"><strong>{vendorGstRate}%</strong><span>Auto-applied</span></div></div>
                <label>Compatibility / fitment <span>Optional</span><input name="compatibility" value={form.compatibility || ""} onChange={updateField} /></label>
                <label>Weight in kg *<input required min="0.01" step="0.01" type="number" name="weight" value={form.weight || ""} onChange={updateField} /></label>
                <div className="vendor-dimensions"><span>Package dimensions <em>Optional</em></span><div><label>Length (cm)<input min="0" step="0.1" type="number" name="length" value={form.length || ""} onChange={updateField} /></label><label>Width (cm)<input min="0" step="0.1" type="number" name="width" value={form.width || ""} onChange={updateField} /></label><label>Height (cm)<input min="0" step="0.1" type="number" name="height" value={form.height || ""} onChange={updateField} /></label></div></div>
                <ShippingEstimateCard weight={form.weight} length={form.length} width={form.width} height={form.height} />
                <label>Description<textarea required name="description" rows="4" value={form.description} onChange={updateField} /></label>
                <label className="vendor-image-picker">Product images ({existingImages.length + selectedImages.length}/{MAX_IMAGES})<input type="file" accept="image/*" multiple onChange={chooseImages} disabled={existingImages.length + selectedImages.length >= MAX_IMAGES} /><small>At least one image required; up to five images, 5 MB maximum each.</small></label>
                {(existingImages.length > 0 || selectedImages.length > 0) && <div className="vendor-image-grid">{existingImages.map((image, index) => <figure key={image}><img src={image} alt={`Product image ${index + 1}`} /><button type="button" onClick={() => setExistingImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index))} aria-label="Remove image">×</button></figure>)}{selectedImages.map((image, index) => <div className="vendor-selected-file" key={`${image.name}-${index}`}>{image.name}<button type="button" onClick={() => setSelectedImages((previous) => previous.filter((_, fileIndex) => fileIndex !== index))} aria-label="Remove selected image">×</button></div>)}</div>}
                {message && <p className="vendor-error" role="alert">{message}</p>}
                <div className="vendor-form-actions"><button className="vendor-primary" type="submit" disabled={loading}>{loading ? <Loader2 size={16} /> : editingSubmission ? <RotateCcw size={16} /> : editingProduct ? <Pencil size={16} /> : <Send size={16} />}{loading ? "Saving..." : editingSubmission ? "Edit & Resubmit" : editingProduct ? "Send edit for review" : "Submit for review"}</button>{(editingSubmission || editingProduct) && <button className="vendor-secondary" type="button" onClick={resetForm}>Cancel</button>}</div>
              </form>
            </section>
            <section id="vendor-reviews" className="vendor-submissions-panel"><div className="vendor-panel-heading"><div><p className="vendor-kicker">SUBMISSION HISTORY</p><h2>Product reviews</h2></div><button className="vendor-refresh" type="button" onClick={loadSubmissions} disabled={refreshing} aria-label="Refresh product reviews"><RotateCcw size={15} /></button></div>
              {refreshing ? <p className="vendor-muted">Loading submissions...</p> : submissions.length === 0 ? <p className="vendor-muted">No product submissions yet.</p> : submissions.map((submission) => {
                const status = String(submission.status || "pending").toLowerCase();
                return <article className="vendor-submission-card" key={submission.id}><div className="vendor-submission-title"><div>{submission.imageUrl && <img src={submission.imageUrl} alt="" />}<div><strong>{submission.name}</strong><span>{submission.category} · {submission.partNumber || "No part number"}</span></div></div><em className={`vendor-status vendor-status-${status}`}>{status === "pending" ? "Pending Review" : statusLabel(status)}</em></div><p>₹{Number(submission.price || 0).toFixed(2)} · {submission.stock} in stock · GST 18%</p>{status === "rejected" && <div className="vendor-rejection"><strong>Reason</strong><p>{submission.rejectionReason || "Please contact PARTSWALA for review feedback."}</p><button type="button" onClick={() => startResubmission(submission)}>Edit &amp; Resubmit <ArrowUpRight size={14} /></button></div>}{status === "approved" && submission.approvedProductId && <Link to={`/products/${submission.approvedProductId}`}>View published product <ArrowUpRight size={14} /></Link>}</article>;
              })}
            </section>
          </section>
        </div>
      </>}
    </main>
  );
}
