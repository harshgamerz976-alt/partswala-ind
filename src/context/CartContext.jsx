import { useState, useEffect } from "react";
import { CartContext } from "./cartContext";

export function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem("partswala_cart"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });

  useEffect(() => { localStorage.setItem("partswala_cart", JSON.stringify(cart)); }, [cart]);

  // Added 'qty' parameter with default of 1
  function addToCart(product, qty = 1) {
    setCart((prev) => {
      const exists = prev.find((item) => item.id === product.id);
      if (exists) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + qty } : item
        );
      }
      return [...prev, { ...product, quantity: qty }];
    });
  }

  function removeFromCart(id) { setCart((prev) => prev.filter((item) => item.id !== id)); }

  function updateQuantity(id, quantity) {
    if (quantity <= 0) { removeFromCart(id); return; }
    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)));
  }

  function clearCart() { setCart([]); }
  function getCartCount() { return cart.reduce((total, item) => total + item.quantity, 0); }
  function getCartTotal() { return cart.reduce((total, item) => total + item.price * item.quantity, 0); }

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, updateQuantity, getCartTotal, getCartCount, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}