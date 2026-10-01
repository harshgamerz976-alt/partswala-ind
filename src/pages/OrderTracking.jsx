import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, CircleDot, Download, MapPin, Package, Truck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { normalizeOrderStatus, subscribeToOrder } from "../services/orderService";
import { ProductDetailSkeleton } from "../components/Skeleton";
import { useAuth } from "../context/useAuth";
import { createOrderReturnRequest } from "../services/orderService";
import { uploadImageToCloudinary } from "../services/cloudinaryService";
import { isReturnWindowOpen, normalizeReturnWindowDays } from "../services/returnPolicy";
import { canDownloadInvoice } from "../services/invoicePolicy";

const STEPS = [
  { key: "pending", label: "Order placed", description: "Your order has been received." },
  { key: "confirmed", label: "Order confirmed", description: "Your order is confirmed and the warehouse is preparing your parts." },
  { key: "awb_assigned", label: "AWB assigned", description: "A courier has been assigned to your shipment." },
  { key: "pickup_scheduled", label: "Pickup scheduled", description: "Shiprocket has accepted the pickup request." },
  { key: "picked_up", label: "Picked up", description: "The courier has collected your package." },
  { key: "in_transit", label: "In transit", description: "Your package is moving through the courier network." },
  { key: "out_for_delivery", label: "Out for delivery", description: "Your package is with the delivery partner." },
  { key: "delivered", label: "Delivered", description: "Your order has arrived." },
];

function formatDate(value, includeTime = false) {
  if (!value) return "Awaiting update";
  return new Date(value).toLocaleString("en-IN", includeTime ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" });
}

function escapeInvoiceHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function downloadInvoice(order, orderId, invoiceSnapshot = null) {
  if (invoiceSnapshot) {
    const totals = invoiceSnapshot.totals || {};
    const seller = invoiceSnapshot.seller || {};
    const snapshotItems = (invoiceSnapshot.items || []).map((item) => ({
      ...item,
      sellerId: seller.sellerId,
      sellerType: seller.sellerType,
      sellerName: seller.name,
      sellerAddress: seller.address,
      sellerGstin: seller.gstin,
      sellerState: seller.state,
      customerLineTotal: item.customerLineTotal,
    }));
    order = {
      ...order,
      items: snapshotItems,
      invoiceNumber: invoiceSnapshot.invoiceNumber,
      invoiceDate: invoiceSnapshot.invoiceDate,
      seller: { storeName: seller.name, address: seller.address, gst: seller.gstin, state: seller.state },
      subtotal: Number(snapshotItems.reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0).toFixed(2)),
      discount: Number(totals.discount || 0),
      taxableAmount: Number(totals.taxableAmount || 0),
      shippingCharge: Number(totals.shippingChargedToCustomer || 0),
      cgst: Number(totals.cgst || 0),
      sgst: Number(totals.sgst || 0),
      igst: Number(totals.igst || 0),
      grandTotal: Number(totals.grandTotal || 0),
      orderTotals: { mrpTotal: Number(snapshotItems.reduce((sum, item) => sum + Number(item.mrp || 0) * Number(item.quantity || 0), 0).toFixed(2)) },
    };
  }
  const items = order.items || [];
  const customer = order.customer || {};
  const rows = items.map((item) => `<tr><td><strong>${escapeInvoiceHtml(item.name || item.title)}</strong><small>${escapeInvoiceHtml([item.brand, item.partNumber, item.hsn && `HSN ${item.hsn}`].filter(Boolean).join(" · ") || "-")}</small></td><td>${escapeInvoiceHtml(item.sellerName || (item.sellerType === "vendor" ? `Vendor ${item.sellerId || ""}` : order.seller?.storeName || "PARTSWALA IND"))}</td><td>${Number(item.quantity || 1)}</td><td>₹${Number(item.mrp || item.price || 0).toFixed(2)}</td><td>₹${Number(item.unitPrice || item.price || 0).toFixed(2)}</td><td>₹${Number(item.discountAmount ?? item.discount ?? 0).toFixed(2)}</td><td>₹${Number(item.taxableValue || 0).toFixed(2)}</td><td>${Number(item.gstRate || 0)}%</td><td>₹${Number(item.cgstAmount ?? item.cgst ?? 0).toFixed(2)}</td><td>₹${Number(item.sgstAmount ?? item.sgst ?? 0).toFixed(2)}</td><td>₹${Number(item.igstAmount ?? item.igst ?? 0).toFixed(2)}</td><td>₹${Number(item.customerLineTotal || 0).toFixed(2)}</td></tr>`).join("");
  const sellerNames = [...new Set(items.map((item) => item.sellerName || (item.sellerType === "vendor" ? `Vendor ${item.sellerId || ""}` : order.seller?.storeName || "PARTSWALA IND")))].join(", ");
  const total = Number(order.grandTotal ?? order.totalAmount ?? order.total ?? 0).toFixed(2);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeInvoiceHtml(orderId)}</title><style>body{font:14px Arial,sans-serif;color:#18202b;margin:32px}header{display:flex;justify-content:space-between;border-bottom:2px solid #f97316;padding-bottom:18px}h1{margin:0;color:#f97316;font-size:22px}h2{font-size:18px}section{margin:24px 0}.parties{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.label{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border-bottom:1px solid #dbe1e8;padding:9px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}td small{display:block;color:#64748b;margin-top:4px}.totals{margin-left:auto;max-width:320px}.totals div{display:flex;justify-content:space-between;padding:6px 0}.grand{border-top:2px solid #18202b;font-size:17px;font-weight:bold;margin-top:8px;padding-top:12px!important}@media print{body{margin:12mm}}</style></head><body><header><div><h1>PARTSWALA IND</h1><p>ORDER INVOICE</p></div><div><strong>Invoice #${escapeInvoiceHtml(order.invoiceNumber || orderId)}</strong><br>${escapeInvoiceHtml(formatDate(order.invoiceDate || order.createdAt))}</div></header><section class="parties"><div><span class="label">Supplier</span><p>${escapeInvoiceHtml(sellerNames)}</p><p>${escapeInvoiceHtml(order.seller?.address || "")}</p><p>${escapeInvoiceHtml(order.seller?.gst || "")}</p></div><div><span class="label">Bill to</span><p><strong>${escapeInvoiceHtml(customer.fullName || order.customerName || "Customer")}</strong></p><p>${escapeInvoiceHtml(order.address || [customer.streetAddress, customer.city, customer.state, customer.zipCode].filter(Boolean).join(", "))}</p><p>${escapeInvoiceHtml(customer.phone || order.customerPhone || "")}</p></div><div><span class="label">Payment</span><p>${escapeInvoiceHtml(order.paymentMethod || "COD")}</p><p>${escapeInvoiceHtml(order.paymentStatus || "Pending")}</p></div></section><section><table><thead><tr><th>Product / HSN</th><th>Supplier</th><th>Qty</th><th>MRP</th><th>Unit price</th><th>Discount</th><th>Taxable</th><th>GST</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></section><section class="totals"><div><span>Selling price</span><strong>₹${Number(order.subtotal || 0).toFixed(2)}</strong></div><div><span>Taxable amount</span><strong>₹${Number(order.taxableAmount || 0).toFixed(2)}</strong></div><div><span>Shipping</span><strong>₹${Number(order.shippingCharge ?? order.shipping ?? 0).toFixed(2)}</strong></div><div><span>GST</span><strong>₹${Number(order.gstTotal || 0).toFixed(2)}</strong></div><div class="grand"><span>Grand total</span><strong>₹${total}</strong></div></section></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `partswala-invoice-${String(invoiceSnapshot?.invoiceNumber || orderId).slice(0, 48)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildTimeline(order, status) {
  const saved = Array.isArray(order.timeline) ? order.timeline : [];
  const normalizeStage = (value) => value === "shipped" ? "in_transit" : value;
  const stageEvents = STEPS.map((step) => saved.find((event) => normalizeStage(event.status) === step.key)).filter(Boolean)
    .map((event) => ({ ...event, status: normalizeStage(event.status) }));
  const otherEvents = saved.filter((event) => !STEPS.some((step) => normalizeStage(event.status) === step.key));
  const events = [...stageEvents, ...otherEvents].sort((left, right) => (Date.parse(left.timestamp || "") || 0) - (Date.parse(right.timestamp || "") || 0));
  const currentStage = normalizeStage(status);
  if (!stageEvents.some((event) => event.status === currentStage) && STEPS.some((step) => step.key === currentStage)) {
    events.push({ status: currentStage, timestamp: order.updatedAt || order.createdAt });
  }
  return events;
}

export default function OrderTracking() {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [returnItems, setReturnItems] = useState({});
  const [returnReason, setReturnReason] = useState("");
  const [returnSerialNumber, setReturnSerialNumber] = useState("");
  const [returnEvidence, setReturnEvidence] = useState([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnMessage, setReturnMessage] = useState("");

  useEffect(() => {
    setLoading(true);
    setErrorMessage("");
    const unsubscribe = subscribeToOrder(id, (nextOrder) => {
      setOrder(nextOrder);
      setLoading(false);
    }, () => {
      setErrorMessage("This order could not be loaded.");
      setLoading(false);
    });
    return unsubscribe;
  }, [id]);

  const status = normalizeOrderStatus(order);
  const timeline = useMemo(() => buildTimeline(order || {}, status), [order, status]);
  const tracking = order?.tracking || {};
  const displayStatus = tracking.status || status;
  const currentStage = ["shipped", "delayed"].includes(displayStatus) ? "in_transit" : displayStatus;
  const currentIndex = STEPS.findIndex((step) => step.key === currentStage);

  if (loading) return <ProductDetailSkeleton />;
  if (errorMessage || !order) return <div className="tracking-empty"><Package size={46} /><h1>Order not found</h1><p>{errorMessage || "This tracking link is no longer available."}</p><Link to="/orders">Back to orders</Link></div>;

  const invoiceSellers = [...new Map((order.items || []).map((item) => {
    const key = `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}`;
    return [key, {
      key,
      name: item.sellerName || (item.sellerType === "vendor" ? `Vendor ${item.sellerId || ""}` : order.seller?.storeName || "PARTSWALA IND"),
      address: item.sellerAddress || order.seller?.address || "",
      gstin: item.sellerGstin || (item.sellerType !== "vendor" ? order.seller?.gst : "") || "",
      state: item.sellerState || order.seller?.state || "",
    }];
  }))];
  const invoiceTaxMode = order.taxMode || order.items?.[0]?.taxMode || "inter_state";
  const returnWindowDays = normalizeReturnWindowDays(order.returnWindowDays);
  const returnWindowOpen = isReturnWindowOpen({ ...order, returnWindowDays });
  const canRequestReturn = currentUser && ["delivered", "completed"].includes(String(status).toLowerCase()) && ["Paid", "COD collected"].includes(order.paymentStatus) && returnWindowOpen && !["submitted", "under_review", "pickup_pending", "received", "approved"].includes(String(order.returnStatus || "").toLowerCase());

  function selectReturnItem(productId, quantity, selected) {
    setReturnItems((previous) => {
      const next = { ...previous };
      if (selected) next[productId] = Math.max(1, Math.min(quantity, Number(next[productId] || 1)));
      else delete next[productId];
      return next;
    });
  }

  function chooseReturnEvidence(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length + returnEvidence.length > 8 || files.some((file) => !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024)) {
      setReturnMessage("Choose up to eight image files, each no larger than 5 MB.");
      return;
    }
    setReturnMessage("");
    setReturnEvidence((previous) => [...previous, ...files]);
  }

  async function submitReturnRequest(event) {
    event.preventDefault();
    const items = Object.entries(returnItems).map(([productId, quantity]) => ({ productId, quantity: Number(quantity) }));
    if (!items.length || !returnReason.trim()) {
      setReturnMessage("Select at least one product and describe the issue.");
      return;
    }
    setReturnLoading(true);
    setReturnMessage("");
    try {
      const evidenceImages = await Promise.all(returnEvidence.map((file) => uploadImageToCloudinary(file, "return")));
      await createOrderReturnRequest({ orderId: id, items, reason: returnReason.trim(), serialNumber: returnSerialNumber.trim(), evidenceImages });
      setReturnMessage("Return request submitted for review. Evidence is considered as part of the review, not an automatic decision.");
      setReturnItems({});
      setReturnReason("");
      setReturnSerialNumber("");
      setReturnEvidence([]);
    } catch (error) {
      setReturnMessage(error.message || "Return request could not be submitted.");
    } finally {
      setReturnLoading(false);
    }
  }

  return (
    <main className="tracking-page">
      <div className="tracking-shell">
        <Link to="/orders" className="tracking-back"><ChevronLeft size={16} /> Back to orders</Link>
        <header className="tracking-header">
          <div><p className="tracking-kicker">SHIPROCKET DELIVERY / LIVE TRACKING</p><h1>Your order is {displayStatus.replace(/_/g, " ")}.</h1><p>Order #{id.slice(0, 12).toUpperCase()} · Placed {formatDate(order.createdAt)}</p></div>
          <div className="tracking-live"><CircleDot size={15} /> Live status</div>
        </header>

        <section className="tracking-hero">
          <div className="tracking-hero-heading"><div><span className="tracking-label">CURRENT STATUS</span><strong>{displayStatus === "delayed" ? "Delayed" : STEPS[currentIndex]?.label || displayStatus.replace(/_/g, " ")}</strong></div><Truck size={31} /></div>
          <div className="tracking-progress"><span style={{ width: `${Math.max(5, (Math.max(currentIndex, 0) / (STEPS.length - 1)) * 100)}%` }} /></div>
          <div className="tracking-step-labels">{STEPS.filter((step) => timeline.some((event) => event.status === step.key)).map((step) => <span className="is-complete" key={step.key}>{step.label}</span>)}</div>
          <p className="tracking-next-note">{displayStatus === "delayed" ? tracking.latestUpdate || "The courier reported a delivery delay." : STEPS[currentIndex]?.description || "We will update this page as your shipment moves."}</p>
        </section>

        <div className="tracking-grid">
          <section className="tracking-panel tracking-timeline-panel"><div className="tracking-panel-heading"><div><span className="tracking-label">DELIVERY JOURNEY</span><h2>Shipment activity</h2></div><MapPin size={19} /></div><div className="tracking-timeline">{timeline.map((event, index) => { const step = STEPS.find((item) => item.key === event.status); return <div className="tracking-event" key={`${event.status}-${event.timestamp}`}><div className={`tracking-event-marker ${index === timeline.length - 1 ? "is-current" : ""}`}><Check size={14} /></div><div><strong>{event.label || step?.label || event.status.replace(/_/g, " ")}</strong><span>{event.note || step?.description}</span><time>{formatDate(event.timestamp, true)}</time></div></div>; })}</div></section>
          <aside className="tracking-side"><section className="tracking-panel"><div className="tracking-panel-heading"><div><span className="tracking-label">SHIPMENT DETAILS</span><h2>{tracking.courier || "Shiprocket delivery"}</h2></div><Truck size={19} /></div><dl className="tracking-facts"><div><dt>Shiprocket order</dt><dd>{tracking.shiprocketOrderId || order.shiprocketOrderId || "Pending"}</dd></div><div><dt>Shipment ID</dt><dd>{tracking.shipmentId || order.shipmentId || "Pending"}</dd></div><div><dt>Courier</dt><dd>{tracking.courier || "Pending assignment"}</dd></div><div><dt>AWB / tracking ID</dt><dd>{tracking.awb || tracking.trackingId || "Pending assignment"}</dd></div><div><dt>Shipping status</dt><dd>{order.shippingStatus || tracking.status || "pending"}</dd></div><div><dt>Estimated delivery</dt><dd>{formatDate(tracking.estimatedDelivery)}</dd></div></dl>{order.shippingError && <p className="tracking-next-note">{order.shippingError}</p>}</section><section className="tracking-panel tracking-address"><div className="tracking-panel-heading"><div><span className="tracking-label">DELIVERING TO</span><h2>{order.customer?.fullName || order.customerName || "Customer"}</h2></div><MapPin size={19} /></div><p>{order.address || [order.customer?.streetAddress, order.customer?.city, order.customer?.state, order.customer?.zipCode].filter(Boolean).join(", ")}</p><p>{order.customer?.phone || order.customerPhone || ""}</p></section></aside>
        </div>

        <section className="tracking-panel tracking-order-details invoice-panel">
          <div className="tracking-panel-heading invoice-toolbar"><div><span className="tracking-label">ORDER INVOICE</span><h2>{order.items?.length || 0} parts · #{id.slice(0, 10).toUpperCase()}</h2></div><div>{order.sellerInvoiceSnapshots?.length ? order.sellerInvoiceSnapshots.map((invoice) => canDownloadInvoice(invoice) ? <button key={invoice.invoiceNumber} type="button" className="invoice-print-button" onClick={() => downloadInvoice(order, id, invoice)}><Download size={15} /> {invoice.seller?.name || "Seller"} invoice</button> : <span key={invoice.invoiceNumber} className="invoice-review-pending">{invoice.seller?.name || "Seller"} invoice pending accounting review</span>) : <button type="button" className="invoice-print-button" onClick={() => downloadInvoice(order, id)}><Download size={15} /> Download invoice</button>}</div></div>
          {order.grandTotal == null ? <><div className="tracking-items">{order.items?.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name || item.title} × {item.quantity || 1}</span><strong>₹{Number(item.price || 0).toLocaleString("en-IN")}</strong></div>)}</div><div className="tracking-total"><span>Saved order total</span><strong>₹{Number(order.totalAmount ?? order.total ?? 0).toLocaleString("en-IN")}</strong></div><p className="invoice-legacy-note">This order predates itemized server pricing. Its saved total is shown without recalculating it.</p></> : <>
            <div className="invoice-parties"><div><span>{invoiceSellers.length > 1 ? "Suppliers" : "Supplier"}</span>{invoiceSellers.map((seller) => <article className="invoice-supplier" key={seller.key}><strong>{seller.name}</strong>{seller.address && <p>{seller.address}</p>}{seller.gstin && <p>GSTIN: {seller.gstin}</p>}{seller.state && <p>{seller.state}</p>}</article>)}</div><div><span>Bill to</span><strong>{order.customer?.fullName || order.customerName}</strong><p>{order.address || [order.customer?.streetAddress, order.customer?.city, order.customer?.state, order.customer?.zipCode].filter(Boolean).join(", ")}</p><p>{order.customer?.phone || order.customerPhone}</p></div><div><span>Payment</span><strong>{order.paymentMethod || "COD"}</strong><p>{order.paymentStatus || "Pending"}</p><p>Tax mode: {invoiceTaxMode === "mixed" ? "Supplier-specific" : invoiceTaxMode === "intra_state" ? "CGST + SGST" : "IGST"}</p></div></div>
            <div className="invoice-table-wrap"><table className="invoice-table"><thead><tr><th>Product / HSN</th><th>Supplier</th><th>Qty</th><th>MRP</th><th>Unit price</th><th>Discount</th><th>Taxable</th><th>GST</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Line total</th></tr></thead><tbody>{(order.items || []).map((item, index) => <tr key={`${item.productId || item.name}-${index}`}><td>{item.name || item.title}<small>{[item.brand, item.partNumber, item.hsn && `HSN ${item.hsn}`].filter(Boolean).join(" · ") || "—"}</small></td><td>{item.sellerName || (item.sellerType === "vendor" ? `Vendor ${item.sellerId || ""}` : order.seller?.storeName || "PARTSWALA IND")}<small>{item.sellerGstin || ""}</small></td><td>{item.quantity || 1}</td><td>₹{Number(item.mrp || item.price || 0).toFixed(2)}</td><td>₹{Number(item.unitPrice || item.price || 0).toFixed(2)}</td><td>₹{Number(item.discountAmount ?? item.discount ?? 0).toFixed(2)}</td><td>₹{Number(item.taxableValue || 0).toFixed(2)}</td><td>{Number(item.gstRate || 0)}%</td><td>₹{Number(item.cgstAmount ?? item.cgst ?? 0).toFixed(2)}</td><td>₹{Number(item.sgstAmount ?? item.sgst ?? 0).toFixed(2)}</td><td>₹{Number(item.igstAmount ?? item.igst ?? 0).toFixed(2)}</td><td>₹{Number(item.customerLineTotal ?? (Number(item.taxableValue || 0) + Number(item.shippingTaxableValue || 0) + Number(item.codFeeTaxableValue || 0) + Number(item.gstTotal || 0))).toFixed(2)}</td></tr>)}</tbody></table></div>
            <div className="invoice-totals">{Number(order.orderTotals?.mrpTotal ?? order.subtotal ?? 0) > Number(order.subtotal || 0) && <div><span>MRP total</span><strong>₹{Number(order.orderTotals?.mrpTotal ?? order.subtotal).toFixed(2)}</strong></div>}<div><span>Selling price</span><strong>₹{Number(order.subtotal || 0).toFixed(2)}</strong></div>{Number(order.discount || 0) > 0 && <div><span>Discount</span><strong>-₹{Number(order.discount).toFixed(2)}</strong></div>}<div><span>Taxable amount</span><strong>₹{Number(order.taxableAmount || 0).toFixed(2)}</strong></div><div><span>Shipping</span><strong>₹{Number(order.shippingCharge ?? order.shipping ?? 0).toFixed(2)}</strong></div>{Number(order.codFee || 0) > 0 && <div><span>COD fee</span><strong>₹{Number(order.codFee).toFixed(2)}</strong></div>}{Number(order.cgst || 0) > 0 && <div><span>CGST</span><strong>₹{Number(order.cgst).toFixed(2)}</strong></div>}{Number(order.sgst || 0) > 0 && <div><span>SGST</span><strong>₹{Number(order.sgst).toFixed(2)}</strong></div>}{Number(order.igst || 0) > 0 && <div><span>IGST</span><strong>₹{Number(order.igst).toFixed(2)}</strong></div>}<div className="invoice-grand-total"><span>Grand total</span><strong>₹{Number(order.grandTotal).toFixed(2)}</strong></div></div>
          </>}
        </section>
        {order.returnStatus && <section className="tracking-panel return-request-status"><span className="tracking-label">RETURN / REFUND REVIEW</span><strong>{String(order.returnStatus).replace(/_/g, " ")}</strong></section>}
        {canRequestReturn && <section className="tracking-panel return-request-panel"><div className="tracking-panel-heading"><div><span className="tracking-label">AFTER-SALES</span><h2>Request a return review</h2></div></div><p className="return-request-note">Tell us what happened. Photos of the part, packaging, label, or issue can help the review; missing photos do not automatically decide the request.</p><form className="return-request-form" onSubmit={submitReturnRequest}><fieldset><legend>Products to review</legend>{(order.items || []).map((item) => <label className="return-request-item" key={item.productId}><input type="checkbox" checked={Boolean(returnItems[item.productId])} onChange={(event) => selectReturnItem(item.productId, Number(item.quantity || 1), event.target.checked)} /><span>{item.name || item.productName} · {item.partNumber || item.productId}</span><span>Qty {item.quantity || 1}</span>{returnItems[item.productId] && <input aria-label={`Return quantity for ${item.name || item.productName}`} type="number" min="1" max={item.quantity || 1} value={returnItems[item.productId]} onChange={(event) => setReturnItems((previous) => ({ ...previous, [item.productId]: Math.max(1, Math.min(Number(item.quantity || 1), Number(event.target.value) || 1)) }))} />}</label>)}</fieldset><label>What is the issue?<textarea required maxLength="1000" rows="4" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Describe the product issue or return reason" /></label><label>Serial number <span>Optional, if available</span><input maxLength="120" value={returnSerialNumber} onChange={(event) => setReturnSerialNumber(event.target.value)} /></label><label>Evidence photos <span>Optional · up to 8 images, 5 MB each</span><input type="file" accept="image/*" multiple onChange={chooseReturnEvidence} /></label>{returnEvidence.length > 0 && <small>{returnEvidence.length} image(s) selected</small>}{returnMessage && <p className="return-request-note" role="status">{returnMessage}</p>}<button className="vendor-primary" type="submit" disabled={returnLoading}>{returnLoading ? "Submitting..." : "Submit return request"}</button></form></section>}
      </div>
    </main>
  );
}
