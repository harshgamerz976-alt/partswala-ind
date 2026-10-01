import { Link } from "react-router-dom";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useCart } from "../context/useCart";

function formatPrice(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function Cart() {
  const { cart, updateQuantity, removeFromCart, clearCart } = useCart();

  if (cart.length === 0) {
    return (
      <div className="cart-page cart-empty-page">
        <ShoppingBag className="cart-empty-icon" />
        <p className="cart-kicker">YOUR CART / 01</p>
        <h1>Your cart is ready for parts.</h1>
        <p className="cart-muted">Add a component from the catalogue and it will appear here instantly.</p>
        <Link to="/products" className="cart-primary-action">Browse all parts <ArrowRight size={16} /></Link>
      </div>
    );
  }

  return (
    <main className="cart-page">
      <div className="cart-page-header">
        <div>
          <p className="cart-kicker">YOUR CART / 01</p>
          <h1>Parts ready to move.</h1>
          <p className="cart-muted">{cart.reduce((count, item) => count + item.quantity, 0)} items selected for checkout.</p>
        </div>
        <button type="button" onClick={clearCart} className="cart-clear-button">Clear cart</button>
      </div>

      <div className="cart-shipping-panel">
        <div className="cart-shipping-copy">
          <strong>Final pricing is calculated at checkout</strong>
          <span>Current product prices, eligible discounts, GST, delivery and payment fees</span>
        </div>
      </div>

      <div className="cart-layout">
        <section className="cart-items" aria-label="Cart items">
          {cart.map((item) => (
            <article key={item.id} className="cart-item">
              <div className="cart-item-image">
                {item.imageUrl ? <img src={item.imageUrl} alt={item.name || item.title} /> : <span>{item.icon || "⚙"}</span>}
              </div>
              <div className="cart-item-details">
                <p>{item.category || "Truck component"}</p>
                <h2>{item.name || item.title || "Unnamed part"}</h2>
                <span>{item.partNumber || "OEM component"}</span>
                <strong>{formatPrice(item.price)}</strong>
              </div>
              <div className="cart-item-actions">
                <div className="cart-quantity" aria-label={`Quantity for ${item.name || item.title}`}>
                  <button type="button" onClick={() => updateQuantity(item.id, item.quantity - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateQuantity(item.id, item.quantity + 1)} aria-label="Increase quantity"><Plus size={14} /></button>
                </div>
                <strong>{formatPrice(Number(item.price || 0) * item.quantity)}</strong>
                <button type="button" onClick={() => removeFromCart(item.id)} className="cart-remove" aria-label={`Remove ${item.name || item.title}`}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          <Link to="/products" className="cart-continue">Continue shopping <ArrowRight size={15} /></Link>
        </section>

        <aside className="cart-summary">
          <p className="cart-kicker">ORDER SUMMARY</p>
          <h2>Review your parts.</h2>
          <p className="cart-summary-note">Taxes, shipping, coupon eligibility and COD fees are calculated from current store settings at checkout.</p>
          <Link to="/checkout" className="cart-checkout-button">Proceed to checkout <ArrowRight size={17} /></Link>
          <p className="cart-summary-note">Secure checkout · COD and online payment available</p>
        </aside>
      </div>
    </main>
  );
}
