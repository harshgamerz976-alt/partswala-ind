import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot, Check, ChevronDown, CircleHelp, ClipboardList, ExternalLink,
  GitCompareArrows, PackageSearch, RotateCcw, Send, ShoppingCart, Sparkles,
  Trash2, Truck, X,
} from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { useCart } from "../../context/useCart";
import { db } from "../../firebase";
import { sendAssistantMessage } from "../services/assistantApi";
import { doc, onSnapshot } from "firebase/firestore";
import "../assistant.css";

const WELCOME = "How can I help you find the right part? Tell me your truck model, part, or order question.";
const SUGGESTIONS = [
  ["Find parts for my truck", PackageSearch],
  ["Check compatibility", CircleHelp],
  ["Track my order", Truck],
  ["Compare products", GitCompareArrows],
];

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "Not listed";
}

function stockLabel(stock) {
  if (stock === null || stock === undefined || stock === "") return "Stock not listed";
  const count = Number(stock);
  return count > 0 ? `${count} in stock` : "Out of stock";
}

function ProductCard({ product, addProduct }) {
  const available = Number(product.stock) > 0;
  const fitment = product.compatibility || "Fitment not listed";
  const compatibilityLabel = product.compatibilityStatus === "verified"
    ? "Fitment verified from listing"
    : product.compatibilityStatus === "unconfirmed"
      ? "Fitment not confirmed"
      : fitment;

  return (
    <article className="pw-assistant-product">
      <div className="pw-assistant-product-image">
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} loading="lazy" /> : <PackageSearch size={22} />}
      </div>
      <div className="pw-assistant-product-body">
        <div className="pw-assistant-product-heading">
          <strong>{product.name}</strong>
          <b>{money(product.price)}</b>
        </div>
        <p className="pw-assistant-product-ident">{[product.brand, product.partNumber && `Part ${product.partNumber}`, product.category, product.mrp != null && `MRP ${money(product.mrp)}`, product.gstRate != null && `GST ${product.gstRate}%`].filter(Boolean).join(" · ") || "Part details not listed"}</p>
        <p className="pw-assistant-fitment">{compatibilityLabel}</p>
        <div className="pw-assistant-product-meta"><span>{stockLabel(product.stock)}</span><span>{product.weight ? `${product.weight} kg` : "Weight not listed"}</span><span>{product.warranty || "Warranty not listed"}</span><span>{product.sellerType === "vendor" ? "Vendor seller" : "PARTSWALA seller"} · {product.seller || "Seller not listed"}</span></div>
        <div className="pw-assistant-product-actions">
          <Link to={`/products/${product.id}`} aria-label={`View ${product.name}`} title="View product"><ExternalLink size={15} /> View</Link>
          <button type="button" onClick={() => addProduct(product)} disabled={!available} title={available ? "Add to cart" : "Out of stock"}><ShoppingCart size={15} /> Add to cart</button>
        </div>
      </div>
    </article>
  );
}

function OrderCard({ order }) {
  const itemsLabel = (order.items || []).map((item) => `${item.name}${item.quantity ? ` × ${item.quantity}` : ""}`).join(" · ");
  return (
    <article className="pw-assistant-order">
      <div><strong>Order #{String(order.orderNumber || order.id).slice(0, 12).toUpperCase()}</strong><span>{order.status?.replaceAll("_", " ") || "Status not recorded"}</span></div>
      <p>{itemsLabel || "Items not listed"}</p>
      {order.gst != null && <small>Subtotal {money(order.subtotal)} · Discount {money(order.discount)} · GST {money(order.gst)} · Shipping {money(order.shipping)} · COD fee {money(order.codFee)}</small>}
      <div className="pw-assistant-order-meta"><span>{order.paymentStatus || "Payment status not recorded"}</span><b>{order.total == null ? "Total not recorded" : money(order.total)}</b></div>
      {Number(order.refundedAmount) > 0 && <small>Refund recorded: {money(order.refundedAmount)} · {order.refundStatus}</small>}
      {order.tracking?.awb && <small>{order.tracking.carrier || "Carrier"} · {order.tracking.awb}</small>}
      {!order.vendorView && <Link to={`/orders/${order.id}`}>Open order <ExternalLink size={13} /></Link>}
    </article>
  );
}

function CompareTable({ products, addProduct }) {
  function specifications(product) {
    const specs = product.specifications || product.specs;
    if (typeof specs === "string") return specs.slice(0, 150) || "Not listed";
    if (specs && typeof specs === "object") return Object.entries(specs).slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(" · ") || "Not listed";
    return "Not listed";
  }
  const rows = [
    ["Price", (product) => money(product.price)],
    ["MRP", (product) => product.mrp == null ? "Not listed" : money(product.mrp)],
    ["Brand", (product) => product.brand || "Not listed"],
    ["Part number", (product) => product.partNumber || "Not listed"],
    ["Stock", (product) => stockLabel(product.stock)],
    ["Compatibility", (product) => product.compatibility || "Not listed"],
    ["Weight", (product) => product.weight ? `${product.weight} kg` : "Not listed"],
    ["Specifications", specifications],
    ["Seller", (product) => product.seller || "Not listed"],
    ["Warranty", (product) => product.warranty || "Not listed"],
  ];
  return (
    <div className="pw-assistant-compare-wrap">
      <table className="pw-assistant-compare"><thead><tr><th>Detail</th>{products.map((product) => <th key={product.id}><span>{product.name}</span><button type="button" onClick={() => addProduct(product)} disabled={!(Number(product.stock) > 0)}><ShoppingCart size={12} /> Add</button></th>)}</tr></thead>
        <tbody>{rows.map(([label, render]) => <tr key={label}><th>{label}</th>{products.map((product) => <td key={product.id}>{render(product)}</td>)}</tr>)}</tbody>
      </table>
      {products.map((product) => <Link className="pw-assistant-compare-link" key={product.id} to={`/products/${product.id}`}>View {product.name} <ExternalLink size={12} /></Link>)}
    </div>
  );
}

function FinanceSummary({ data }) {
  const rows = [
    ["Customer collections", data.grossCustomerCollections],
    ["Sales today", data.todaySales],
    ["Product subtotal", data.productSubtotal],
    ["Tax collected (not profit)", data.taxesCollected],
    ["Vendor sales", data.vendorSales],
    ["PARTSWALA sales", data.partswalaSales],
    ["Platform commission", data.platformCommission],
    ["Vendor payouts pending", data.pendingVendorPayouts],
    ["Refunds today", data.refundsToday],
    ["Refunds recorded", data.refunds],
    ["COD fees", data.codFee],
    ["Shipping charged", data.shippingCollected],
    ["Actual shipping cost", data.actualShippingCost],
    ["Payment gateway fees", data.paymentGatewayFees],
    ["Gateway tax", data.paymentGatewayTax],
    ["TCS", data.tcsAmount],
    ["TDS", data.tdsAmount],
  ];
  return <dl className="pw-assistant-finance">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null ? "Not recorded" : money(value)}</dd></div>)}</dl>;
}

function ResultContent({ message, addProduct, confirmRemoval, cancelRemoval }) {
  const data = message.data || {};
  return (
    <>
      {Array.isArray(data.products) && message.action === "compareProducts" && data.products.length > 1 && <CompareTable products={data.products} addProduct={addProduct} />}
      {Array.isArray(data.products) && message.action !== "compareProducts" && data.products.map((product) => <ProductCard key={product.id} product={product} addProduct={addProduct} />)}
      {data.product && <ProductCard product={data.product} addProduct={addProduct} />}
      {Array.isArray(data.orders) && data.orders.map((order) => <OrderCard key={order.id} order={{ ...order, vendorView: data.isVendor }} />)}
      {data.needsLogin && <Link className="pw-assistant-inline-link" to="/login">Sign in to view orders <ExternalLink size={13} /></Link>}
      {Array.isArray(data.items) && message.action === "getCart" && (
        data.items.length > 0 && <section className="pw-assistant-cart">
          {data.items.map((item) => <div key={item.id}><span>{item.name} × {item.quantity}</span><b>{money(item.price * item.quantity)}</b></div>)}
          <footer><span>Subtotal before checkout tax and shipping</span><strong>{money(data.subtotal)}</strong></footer>
          <Link to="/cart">Open cart <ExternalLink size={13} /></Link>
        </section>
      )}
      {data.available && message.action === "getShippingEstimate" && <div className="pw-assistant-estimate"><Truck size={16} /><span>{data.actualWeight} kg actual weight · estimate only</span><strong>{money(data.amount)}</strong></div>}
      {message.action === "getVendorSales" && Array.isArray(data) && <div className="pw-assistant-vendor-list">{data.slice(0, 8).map((vendor) => <div key={vendor.vendorId}><span>Vendor {String(vendor.vendorId).slice(0, 8)} · {vendor.orders} orders</span><b>{money(vendor.sales)}</b></div>)}</div>}
      {message.action === "getVendorSales" && !Array.isArray(data) && data.totalSales != null && <div className="pw-assistant-metrics"><span>Sales today <b>{money(data.todaySales)}</b></span><span>Total sales <b>{money(data.totalSales)}</b></span><span>Commission recorded <b>{money(data.commission)}</b></span><span>Pending payout <b>{money(data.payout?.pending)}</b></span></div>}
      {message.action === "getVendorPayout" && data.balances && <div className="pw-assistant-metrics"><span>Pending <b>{money(data.balances.pending)}</b></span><span>Payable <b>{money(data.balances.payable)}</b></span><span>Paid <b>{money(data.balances.paid)}</b></span></div>}
      {message.action === "getVendorPayout" && Array.isArray(data.settlements) && data.settlements.map((row) => <article className="pw-assistant-settlement" key={row.id}><div><strong>Order #{String(row.orderId).slice(0, 10)} · {row.productName || "Vendor sale"}</strong><span>{row.settlementStatus} · {row.statusReason}</span></div><b>{money(row.vendorPayout)}</b></article>)}
      {message.action === "getVendorPayout" && !data.balances && data.pending != null && <div className="pw-assistant-metrics"><span>Pending / held <b>{money(data.pending)}</b></span><span>Payable <b>{money(data.payable)}</b></span><span>Paid <b>{money(data.paid)}</b></span></div>}
      {message.action === "getAdminFinance" && <FinanceSummary data={data} />}
      {message.action === "removeFromCart" && data.clientAction && (
        <div className="pw-assistant-confirm"><button type="button" onClick={() => confirmRemoval(data.clientAction.productId, data.name)}><Check size={14} /> Remove item</button><button type="button" onClick={cancelRemoval}>Keep item</button></div>
      )}
      {message.action === "getLowStockProducts" && Array.isArray(data.products) && data.products.map((product) => <div className="pw-assistant-low-stock" key={product.id}><span>{product.name} · {product.partNumber}</span><b>{stockLabel(product.stock)}</b></div>)}
    </>
  );
}

export default function AssistantWidget() {
  const { currentUser, role } = useAuth();
  const { cart, addToCart, removeFromCart } = useCart();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState("");
  const [failedMessage, setFailedMessage] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [messages, setMessages] = useState([{ id: "welcome", role: "assistant", text: WELCOME }]);
  const messagesRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => onSnapshot(doc(db, "settings", "assistant"), (snapshot) => {
    setEnabled(!snapshot.exists() || snapshot.data().enabled !== false);
  }, () => setEnabled(true)), []);

  useEffect(() => {
    if (open) {
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, typing, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function appendAssistant(text, data = {}, action = "") {
    setMessages((previous) => [...previous, { id: `${Date.now()}-${Math.random()}`, role: "assistant", text, data, action }]);
  }

  function addProduct(product, quantity = 1) {
    if (!(Number(product.stock) > 0)) return;
    addToCart(product, quantity);
    appendAssistant(`${product.name} has been added to your cart.`);
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || typing) return;
    setDraft("");
    setError("");
    setFailedMessage("");
    setTyping(true);
    const previousMessages = messages;
    setMessages((previous) => [...previous, { id: `${Date.now()}-user`, role: "user", text }]);
    const recentProducts = previousMessages.flatMap((item) => item.data?.products || (item.data?.product ? [item.data.product] : [])).slice(-5);

    try {
      const result = await sendAssistantMessage(currentUser, {
        message: text,
        history: previousMessages.filter((item) => item.role === "user" || item.role === "assistant").slice(-8).map(({ role: messageRole, text: messageText }) => ({ role: messageRole, text: messageText })),
        context: {
          recentProducts: recentProducts.map(({ id, name, partNumber }) => ({ id, name, partNumber })),
          recentProductIds: recentProducts.map((item) => item.id),
          cart: cart.map(({ id, name, title, partNumber, quantity }) => ({ id, name, title, partNumber, quantity })),
        },
      });
      appendAssistant(result.text, result, result.action || "");
      if (result.clientAction?.type === "addToCart") addToCart(result.clientAction.product, result.clientAction.quantity);
    } catch (requestError) {
      setFailedMessage(text);
      setError(requestError.message || "I'm having trouble reaching PARTSWALA AI. Please try again.");
    } finally {
      setTyping(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    sendMessage(draft);
  }

  function clearConversation() {
    setMessages([{ id: `welcome-${Date.now()}`, role: "assistant", text: WELCOME }]);
    setError("");
    setFailedMessage("");
  }

  function confirmRemoval(productId, name) {
    removeFromCart(productId);
    appendAssistant(`${name} has been removed from your cart.`);
  }

  if (!enabled) return null;

  return (
    <div className="pw-assistant-root">
      {open && (
        <section className="pw-assistant-panel" aria-label="PARTSWALA AI assistant">
          <header className="pw-assistant-header">
            <span className="pw-assistant-mark"><Bot size={20} /></span>
            <div className="pw-assistant-title"><strong>PARTSWALA <em>AI</em></strong><span><i /> Parts desk · {role || "customer"}</span></div>
            <button type="button" className="pw-assistant-icon-button" onClick={clearConversation} title="Clear conversation" aria-label="Clear conversation"><Trash2 size={17} /></button>
            <button type="button" className="pw-assistant-icon-button" onClick={() => setOpen(false)} title="Close assistant" aria-label="Close assistant"><X size={19} /></button>
          </header>

          <div className="pw-assistant-thread" ref={messagesRef} aria-live="polite">
            {messages.map((message, index) => (
              <div className={`pw-assistant-message ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="pw-assistant-avatar"><Sparkles size={14} /></span>}
                <div className="pw-assistant-message-body">
                  <p className="pw-assistant-bubble">{message.text}</p>
                  {message.role === "assistant" && <ResultContent message={message} addProduct={addProduct} confirmRemoval={confirmRemoval} cancelRemoval={() => appendAssistant("Okay, I'll leave your cart unchanged.")} />}
                  {messages.length === 1 && index === 0 && message.role === "assistant" && (
                    <div className="pw-assistant-suggestions">{SUGGESTIONS.map(([label, Icon]) => <button type="button" key={label} onClick={() => sendMessage(label)}><Icon size={14} />{label}</button>)}</div>
                  )}
                </div>
              </div>
            ))}
            {typing && <div className="pw-assistant-loading"><span /><span /><span /> Checking the parts desk</div>}
          </div>

          {error && <div className="pw-assistant-error" role="alert"><CircleHelp size={15} />{error}<button type="button" onClick={() => sendMessage(failedMessage)} title="Retry" aria-label="Retry"><RotateCcw size={14} /></button></div>}
          <form className="pw-assistant-composer" onSubmit={submit}>
            <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Part, truck model, order..." aria-label="Ask PARTSWALA AI" maxLength={1000} />
            <button type="submit" disabled={!draft.trim() || typing} title="Send message" aria-label="Send message"><Send size={17} /></button>
          </form>
          <div className="pw-assistant-footer"><ClipboardList size={12} /> Live catalogue and account data <span>·</span> <span>Not sure? Ask for a fitment check.</span></div>
        </section>
      )}
      <button type="button" className={`pw-assistant-launcher ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Close PARTSWALA AI" : "Open PARTSWALA AI"} title="PARTSWALA AI">
        {open ? <ChevronDown size={22} /> : <><Bot size={24} /><span><Sparkles size={11} /></span></>}
      </button>
    </div>
  );
}