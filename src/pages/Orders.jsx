import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp, Package, Search, Truck, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { cancelOrderItems, subscribeToUserOrders } from "../services/orderService";
import { TableSkeleton } from "../components/Skeleton";

const STATUS_STYLES = {
  pending: "order-status-pending",
  processing: "order-status-pending",
  confirmed: "order-status-confirmed",
  shipped: "order-status-shipped",
  out_for_delivery: "order-status-out-for-delivery",
  delivered: "order-status-delivered",
  cancelled: "order-status-cancelled",
};

function getStatus(order) {
  return String(order.status || order.orderStatus || "pending").toLowerCase();
}

function getTotal(order) {
  return Number(order.totalAmount ?? order.total ?? 0);
}

function getItemCount(order) {
  return (order.items || []).reduce((count, item) => count + Number(item.quantity || 1), 0);
}

function getAddress(order) {
  if (order.address) return order.address;
  const customer = order.customer;
  if (!customer) return "Delivery address unavailable";
  return [customer.streetAddress, customer.city, customer.state, customer.zipCode].filter(Boolean).join(", ");
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Orders() {
  const { currentUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [cancellingItem, setCancellingItem] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      navigate("/login", { replace: true });
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToUserOrders((data) => {
      setOrders(data || []);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching orders:", error);
      setErrorMessage("Orders could not be loaded. Please try again.");
      setLoading(false);
    });
    return unsubscribe;
  }, [currentUser, authLoading, navigate]);

  const counts = useMemo(() => ({
    all: orders.length,
    active: orders.filter((order) => !["delivered", "cancelled"].includes(getStatus(order))).length,
    delivered: orders.filter((order) => getStatus(order) === "delivered").length,
  }), [orders]);

  const filteredOrders = orders.filter((order) => {
    const status = getStatus(order);
    const matchesFilter = activeFilter === "all" || (activeFilter === "active" ? !["delivered", "cancelled"].includes(status) : status === activeFilter);
    const reference = `${order.id} ${order.items?.map((item) => item.name).join(" ") || ""}`.toLowerCase();
    return matchesFilter && reference.includes(searchQuery.toLowerCase());
  });

  async function cancelItem(order, item) {
    const remaining = Number(item.remainingQuantity ?? Number(item.orderedQuantity ?? item.quantity) - Number(item.cancelledQuantity || 0));
    const quantity = Number(window.prompt(`Cancel quantity (1-${remaining}) for ${item.name || item.productName || "this item"}:`, "1"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > remaining) return;
    setCancellingItem(`${order.id}:${item.productId}`);
    try {
      await cancelOrderItems(order.id, [{ productId: item.productId, quantity }]);
    } catch (error) {
      setErrorMessage(error.message || "This item could not be cancelled.");
    } finally {
      setCancellingItem("");
    }
  }

  if (loading || authLoading) {
    return <div className="orders-page orders-loading"><div className="orders-heading-skeleton skeleton-shimmer" /><TableSkeleton rows={4} /></div>;
  }

  if (errorMessage) {
    return <div className="orders-page orders-empty"><Package size={52} /><h1>Orders unavailable</h1><p>{errorMessage}</p><button onClick={() => window.location.reload()}>Try again</button></div>;
  }

  return (
    <main className="orders-page">
      <header className="orders-header">
        <div>
          <p className="orders-kicker">YOUR PARTS / 04</p>
          <h1>Order history.</h1>
          <p>Track every component from payment to delivery.</p>
        </div>
        <Link to="/products" className="orders-shop-link">Shop parts <span>↗</span></Link>
      </header>

      <section className="orders-stats" aria-label="Order summary">
        <div><span>Total orders</span><strong>{counts.all}</strong></div>
        <div><span>In progress</span><strong>{counts.active}</strong></div>
        <div><span>Delivered</span><strong>{counts.delivered}</strong></div>
      </section>

      {orders.length > 0 && (
        <div className="orders-toolbar">
          <div className="orders-filters" role="tablist" aria-label="Filter orders">
            {[{ key: "all", label: "All orders", count: counts.all }, { key: "active", label: "In progress", count: counts.active }, { key: "delivered", label: "Delivered", count: counts.delivered }].map((filter) => (
              <button key={filter.key} className={activeFilter === filter.key ? "is-active" : ""} onClick={() => setActiveFilter(filter.key)} role="tab" aria-selected={activeFilter === filter.key}>
                {filter.label} <span>{filter.count}</span>
              </button>
            ))}
          </div>
          <label className="orders-search"><Search size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search orders" aria-label="Search orders" /></label>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="orders-empty"><Package size={52} /><h2>No orders yet.</h2><p>Your completed purchases will appear here.</p><Link to="/products">Browse parts <span>↗</span></Link></div>
      ) : filteredOrders.length === 0 ? (
        <div className="orders-empty orders-empty-small"><Search size={38} /><h2>No matching orders.</h2><p>Try another search or filter.</p></div>
      ) : (
        <section className="orders-list" aria-label="Your orders">
          {filteredOrders.map((order) => {
            const status = getStatus(order);
            const isExpanded = expandedOrder === order.id;
            return (
              <article key={order.id} className="order-card">
                <div className="order-card-top">
                  <div className="order-reference"><span>ORDER REFERENCE</span><strong>#{order.id.slice(0, 10).toUpperCase()}</strong></div>
                  <div className={`order-status ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}><span />{status}</div>
                  <div className="order-date"><CalendarDays size={14} />{formatDate(order.createdAt)}</div>
                </div>
                <div className="order-card-main">
                  <div className="order-product-preview">
                    {order.items?.slice(0, 3).map((item, index) => <div className="order-product-thumb" key={`${item.productId || item.id || item.name}-${index}`}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>⚙</span>}</div>)}
                    {getItemCount(order) > 3 && <span className="order-more-items">+{getItemCount(order) - 3}</span>}
                  </div>
                  <div className="order-card-summary"><strong>{getItemCount(order)} {getItemCount(order) === 1 ? "item" : "items"}</strong><span>{order.items?.[0]?.name || "Truck component order"}</span><small>{getAddress(order)}</small></div>
                  <div className="order-card-total"><span>Total paid</span><strong>₹{getTotal(order).toLocaleString("en-IN")}</strong></div>
                </div>
                <div className="order-card-actions">
                  <button onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>{isExpanded ? "Hide details" : "View details"}{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
                  {status !== "cancelled" && <Link to={`/orders/${order.id}`}><Truck size={15} /> Track order</Link>}
                </div>
                {isExpanded && <div className="order-details"><div className="order-details-items">{order.items?.map((item, index) => {
                  const remaining = Number(item.remainingQuantity ?? Number(item.orderedQuantity ?? item.quantity) - Number(item.cancelledQuantity || 0));
                  const canCancel = remaining > 0 && !item.returnStatus && Number(item.refundAmount || 0) === 0 && ["pending", "confirmed", "processing", "partially_cancelled"].includes(status) && order.shippingStatus === "pending" && !order.tracking?.awb && !order.tracking?.shipmentId;
                  return <div key={`${item.name}-${index}`}><span>{item.name || item.title} × {remaining} {item.itemStatus && `· ${item.itemStatus}`}</span><strong>₹{(Number(item.unitPrice || item.price || 0) * remaining).toLocaleString("en-IN")}</strong>{canCancel && <button type="button" aria-label={`Cancel ${item.name || item.productName}`} title="Cancel item quantity" disabled={cancellingItem === `${order.id}:${item.productId}`} onClick={() => void cancelItem(order, item)}><X size={14} /></button>}</div>;
                })}</div><p><span>Delivery address</span>{getAddress(order)}</p><p><span>Payment</span>{order.paymentMethod || "Cash on Delivery"}</p></div>}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
