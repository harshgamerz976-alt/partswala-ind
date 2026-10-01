import { useCart } from "../context/useCart";
import { useAuth } from "../context/useAuth";
import { Link } from "react-router-dom";

// Tick sound generator
function playTickSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch {}
}

export default function ProductCard({ product, onCompare, isCompared = false }) {
  const { cart, addToCart } = useCart();
  const auth = useAuth();
  const showToast = auth?.showToast;

  const isOutOfStock = product.stock === 0 || product.stockCount === 0;
  const badgeText = product.badge || (product.tags?.includes("bestseller") ? "BEST SELLER" : "POPULAR");
  const isBestSeller = badgeText === "BEST SELLER";
  const sellingPrice = Number(product.price);
  const mrp = Number(product.mrp);
  const validSellingPrice = Number.isFinite(sellingPrice) ? sellingPrice : null;
  const discountAmount = Number.isFinite(mrp) && mrp > sellingPrice ? mrp - sellingPrice : 0;

  function handlePointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--card-rotate-x", `${(y * -10).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--card-rotate-y", `${(x * 14).toFixed(2)}deg`);
  }

  function resetTilt(event) {
    event.currentTarget.style.setProperty("--card-rotate-x", "0deg");
    event.currentTarget.style.setProperty("--card-rotate-y", "0deg");
  }

  function handleAddToCart(e) {
    e.preventDefault();
    e.stopPropagation();

    if (isOutOfStock) return;

    const existingItem = cart?.find((item) => item.id === product.id);
    let message = `${product.name || product.title} added to cart!`;
    if (existingItem) {
      message = `${product.name || product.title} added to cart (x${existingItem.quantity + 1})`;
    }

    playTickSound();
    addToCart(product);

    if (showToast) {
      showToast(message, "success");
    }

    // Flying cart animation
    const isMobile = window.innerWidth < 768;
    const cartIcon = document.getElementById(isMobile ? "cart-icon-mobile" : "cart-icon");

    if (cartIcon) {
      const cartRect = cartIcon.getBoundingClientRect();
      const flyEl = document.createElement("div");
      flyEl.innerText = "🛒";
      flyEl.style.position = "fixed";
      flyEl.style.zIndex = "9999";
      flyEl.style.pointerEvents = "none";
      flyEl.style.transition = "all 0.8s cubic-bezier(0.19, 1, 0.22, 1)";
      flyEl.style.left = `${e.clientX}px`;
      flyEl.style.top = `${e.clientY}px`;
      document.body.appendChild(flyEl);

      requestAnimationFrame(() => {
        flyEl.style.left = `${cartRect.left + cartRect.width / 2}px`;
        flyEl.style.top = `${cartRect.top + cartRect.height / 2}px`;
        flyEl.style.transform = "scale(0.2) rotate(360deg)";
        flyEl.style.opacity = "0";
      });

      setTimeout(() => {
        flyEl.remove();
        window.dispatchEvent(new Event("cart-pop"));
      }, 850);
    }
  }

  return (
    <Link
      to={`/products/${product.id}`}
      className="block group relative h-full card-tilt"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
      onPointerEnter={handlePointerMove}
      style={{
        transform: "perspective(1200px) rotateX(var(--card-rotate-x, 0deg)) rotateY(var(--card-rotate-y, 0deg))",
        transition: "transform 180ms ease-out",
      }}
    >
      <div className="product-card-shell bg-[#0b1322] overflow-hidden border border-slate-800/80 flex flex-col justify-between h-full">
        
        {/* Out of Stock Overlay */}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-[#070b14]/90 z-30 flex items-center justify-center backdrop-blur-xs">
            <span className="bg-red-600 text-white font-bold text-xs px-4 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
              Out of Stock
            </span>
          </div>
        )}

        {/* 1. TOP IMAGE AREA */}
        <div className="product-card-media relative w-full h-60 bg-[#030712] flex items-center justify-center p-6 overflow-hidden border-b border-slate-800/60">
          
          {/* Top Left Badge */}
          {badgeText && (
            <div
              className={`absolute top-3 left-3 z-20 flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border backdrop-blur-md ${
                isBestSeller
                  ? "bg-orange-500/15 border-orange-500/50 text-orange-400"
                  : "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
              }`}
            >
                <span className="product-card-badge-icon">{isBestSeller ? "♨" : "☆"}</span>
              <span>{badgeText}</span>
            </div>
          )}

          {/* Radial Backlight Effect */}
          <div
            className={`absolute w-36 h-36 rounded-full blur-2xl opacity-25 pointer-events-none ${
              isBestSeller ? "bg-orange-500" : "bg-emerald-500"
            }`}
          ></div>

          {/* Image */}
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name || product.title}
              className="max-h-full max-w-full object-contain relative z-10 group-hover:scale-105 transition-transform duration-500 ease-out mix-blend-multiply dark:mix-blend-normal"
            />
          ) : (
            <span className="text-6xl relative z-10 select-none group-hover:scale-110 transition-transform duration-300">
              {product.icon || "⚙️"}
            </span>
          )}
        </div>

        {/* 2. CARD CONTENT BODY */}
        <div className="product-card-body p-5 flex flex-col flex-1 justify-between gap-5">
          <div>
            <h3 className="product-card-title text-xl font-extrabold text-white group-hover:text-orange-400 transition-colors tracking-tight">
              {product.name || product.title || "Clutch Plate"}
            </h3>
            <p className="product-card-part-number text-xs font-mono font-medium text-slate-400 mt-1">
              {product.partNumber || product.category || "CP-1234"}
            </p>
            {onCompare && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCompare(product);
                }}
                className={`product-card-compare ${isCompared ? "is-selected" : ""}`}
              >
                <span>{isCompared ? "✓" : "+"}</span> {isCompared ? "Added to compare" : "Compare part"}
              </button>
            )}

            {/* Feature Badges - 3-COLUMN GRID */}
            <div className="product-card-benefits grid grid-cols-3 gap-1 mt-5 pt-4 border-t border-slate-800/80 text-center">
              {/* Feature 1 */}
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold">
                  <span className="product-card-benefit-icon">◇</span>
                  <span className="text-white text-[10px] font-semibold">Premium</span>
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">Durable & Reliable</span>
              </div>

              {/* Feature 2 */}
              <div className="flex flex-col items-center border-x border-slate-800/80 px-1">
                <div className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold">
                  <span className="product-card-benefit-icon">⚙</span>
                  <span className="text-white text-[10px] font-semibold">Perfect Fit</span>
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">Truck Compatible</span>
              </div>

              {/* Feature 3 */}
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center gap-1 text-orange-400 text-xs font-bold">
                  <span className="product-card-benefit-icon">◇</span>
                  <span className="text-white text-[10px] font-semibold">Long Lasting</span>
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 whitespace-nowrap">High Performance</span>
              </div>
            </div>
          </div>

          {/* 3. CARD FOOTER */}
          <div className="product-card-footer pt-2 flex items-center justify-between gap-3">
            <div>
              {discountAmount > 0 && <span className="product-card-mrp block text-xs text-slate-400 line-through">MRP ₹{mrp.toLocaleString("en-IN")}</span>}
              <span className="product-card-price text-2xl font-black text-orange-500 font-mono tracking-tight block">{validSellingPrice == null ? "—" : `₹${validSellingPrice.toLocaleString("en-IN")}`}</span>
              {discountAmount > 0 && <span className="product-card-savings block text-[10px] font-semibold text-emerald-400">You save ₹{discountAmount.toLocaleString("en-IN")}</span>}
              <span className="text-[10px] text-slate-400 block font-medium">
                {product.priceIncludesGst === false ? "Before applicable GST" : "Incl. of all taxes"}
              </span>
            </div>

            <button
              onClick={handleAddToCart}
              disabled={isOutOfStock}
              className={`product-card-cart px-4 py-2.5 rounded-xl font-bold text-xs transition-all duration-200 flex items-center gap-1.5 shadow-lg active:scale-95 ${
                isOutOfStock
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white shadow-orange-500/25"
              }`}
            >
              <span className="product-card-cart-icon">▱</span>
              <span>{isOutOfStock ? "Unavailable" : "Add to Cart"}</span>
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}