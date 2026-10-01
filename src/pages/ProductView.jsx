import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Minus, PackageCheck, Plus, Share2, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react";
import { getProductById, getRelatedProducts } from "../services/productService";
import { addReview, getProductReviews } from "../services/reviewService";
import { useCart } from "../context/useCart";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import WhatsAppButton from "../components/WhatsAppButton";
import ProductCard from "../components/productcard";
import StarRating from "../components/StarRating";
import { ProductDetailSkeleton } from "../components/Skeleton";
import "./ProductView.css";

const ProductInspection3D = lazy(() => import("../components/ProductInspection3D"));

export default function ProductView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [showSticky, setShowSticky] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getProductById(id)
      .then((nextProduct) => {
        if (!active) return;
        setProduct(nextProduct);
      })
      .catch(() => {
        if (active) addToast("Could not load this product", "error");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, addToast]);

  useEffect(() => {
    setQty(1);
    if (!product) return;
    try {
      const viewed = JSON.parse(localStorage.getItem("partswala_recent") || "[]");
      const next = [product, ...viewed.filter((item) => item.id !== id)].slice(0, 5);
      localStorage.setItem("partswala_recent", JSON.stringify(next));
      setRecent(next.filter((item) => item.id !== id).slice(0, 4));
    } catch {
      setRecent([]);
    }
    let active = true;
    getProductReviews(id).then((nextReviews) => { if (active) setReviews(nextReviews); });
    getRelatedProducts(product.category, id).then((nextProducts) => { if (active) setRelatedProducts(nextProducts); });
    return () => { active = false; };
  }, [product, id]);

  useEffect(() => {
    const onScroll = () => setShowSticky(window.scrollY > 460);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (loading) return <ProductDetailSkeleton />;
  if (!product) {
    return <main className="product-view-empty"><p>PART NOT FOUND</p><h1>This listing is no longer available.</h1><Link to="/products"><ArrowLeft size={16} /> Back to all parts</Link></main>;
  }

  const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 99;
  const outOfStock = stock === 0;
  const avgRating = reviews.length ? (reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviews.length).toFixed(1) : null;
  const price = Number(product.price) || 0;
  const mrp = Number(product.mrp);
  const discountAmount = Number.isFinite(mrp) && mrp > price ? mrp - price : 0;

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: `Check out ${product.name} on PARTSWALA IND`, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        addToast("Product link copied", "success");
      }
    } catch (error) {
      if (error.name !== "AbortError") addToast("Could not share this product", "error");
    }
  }

  function handleAdd() {
    if (outOfStock) return;
    addToCart(product, qty);
    addToast(`${product.name} · ${qty} added to cart`, "success");
  }

  async function handleSubmitReview(event) {
    event.preventDefault();
    if (!currentUser) return navigate("/login");
    if (!reviewRating || !reviewText.trim()) return addToast("Add a rating and a short review", "error");
    setSubmittingReview(true);
    try {
      await addReview(id, reviewRating, reviewText.trim());
      setReviewRating(0);
      setReviewText("");
      setReviews(await getProductReviews(id));
      addToast("Your review has been submitted", "success");
    } catch {
      addToast("Could not submit your review", "error");
    } finally {
      setSubmittingReview(false);
    }
  }

  return (
    <main className="product-view">
      <nav className="product-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/products">Parts</Link><span>/</span><span>{product.name}</span></nav>
      <div className="product-view-grid">
        <div className="product-view-visual"><Suspense fallback={<div className="inspection-loading">Loading product viewer...</div>}><ProductInspection3D imageUrl={product.imageUrl} name={product.name} icon={product.icon} /></Suspense></div>
        <section className="product-summary">
          <div className="product-summary-topline"><span className="product-eyebrow">{product.category || "AUTOMOTIVE PART"}</span><button className="product-icon-button" type="button" onClick={handleShare} aria-label="Share product"><Share2 size={18} /></button></div>
          <div className="product-tags">{product.brand && <span>{product.brand}</span>}{product.partNumber && <span className="part-number">SKU / {product.partNumber}</span>}</div>
          <h1>{product.name}</h1>
          {product.description && <p className="product-description">{product.description}</p>}
          <div className="product-review-line">{avgRating ? <><Star size={15} fill="currentColor" /><strong>{avgRating}</strong><a href="#product-reviews">{reviews.length} {reviews.length === 1 ? "review" : "reviews"}</a></> : <span>Be the first to review this part</span>}</div>
          <div className="product-price-row">{discountAmount > 0 && <del>MRP ₹{mrp.toLocaleString("en-IN")}</del>}<strong>₹{price.toLocaleString("en-IN")}</strong><span>{product.priceIncludesGst === false ? "Before applicable GST" : "Inclusive of applicable taxes"}</span>{discountAmount > 0 && <span className="product-savings">You save ₹{discountAmount.toLocaleString("en-IN")}</span>}</div>
          <div className={`stock-line ${outOfStock ? "is-out" : ""}`}><span className="stock-indicator" />{outOfStock ? "Currently unavailable" : stock < 6 ? `Only ${stock} left in stock` : "In stock and ready to ship"}</div>
          <div className="product-quantity-row"><label htmlFor="product-quantity">Quantity</label><div className="quantity-control"><button type="button" onClick={() => setQty((value) => Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={qty <= 1}><Minus size={15} /></button><input id="product-quantity" type="number" min="1" max={stock} value={qty} onChange={(event) => setQty(Math.max(1, Math.min(stock || 1, Number(event.target.value) || 1)))} /><button type="button" onClick={() => setQty((value) => Math.min(stock, value + 1))} aria-label="Increase quantity" disabled={qty >= stock}><Plus size={15} /></button></div><span className="quantity-available">{stock} available</span></div>
          <button className="product-add-button" type="button" onClick={handleAdd} disabled={outOfStock}><ShoppingBag size={18} />{outOfStock ? "Unavailable" : `Add to cart · ₹${(price * qty).toLocaleString("en-IN")}`}</button>
          <WhatsAppButton productName={product.name} partNumber={product.partNumber || ""} className="product-whatsapp-button" />
          <div className="product-promises"><div><Truck size={17} /><span>Delivery options at checkout</span></div><div><ShieldCheck size={17} /><span>Secure payment</span></div><div><PackageCheck size={17} /><span>Quality checked parts</span></div></div>
        </section>
      </div>

      <section className="product-spec-strip" aria-label="Product details"><div><span>PART NUMBER</span><strong>{product.partNumber || "Not specified"}</strong></div><div><span>BRAND</span><strong>{product.brand || "Genuine fit"}</strong></div><div><span>CATEGORY</span><strong>{product.category || "Spare part"}</strong></div><div><span>AVAILABILITY</span><strong>{outOfStock ? "Out of stock" : "Ready to ship"}</strong></div></section>

      <section className="product-reviews" id="product-reviews">
        <div className="section-heading"><div><span className="product-eyebrow">CUSTOMER FEEDBACK</span><h2>Reviews <span>({reviews.length})</span></h2></div>{avgRating && <div className="reviews-average"><Star size={17} fill="currentColor" />{avgRating}<span>/ 5</span></div>}</div>
        <div className="reviews-layout">
          <div className="review-list">{reviews.length === 0 ? <p className="reviews-empty">No reviews yet. Your experience can help the next buyer.</p> : reviews.map((review) => <article className="review-entry" key={review.id}><div className="review-author"><span>{(review.userName || "P").slice(0, 1).toUpperCase()}</span><div><strong>{review.userName || "PARTSWALA customer"}</strong><time>{review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Recently"}</time></div><StarRating rating={review.rating} readonly size="w-4 h-4" /></div><p>{review.text || review.comment}</p></article>)}</div>
          <form className="review-form" onSubmit={handleSubmitReview}><h3>Share your experience</h3><p>Tell other buyers how this part worked for you.</p><StarRating rating={reviewRating} setRating={setReviewRating} size="w-6 h-6" /><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} rows="4" maxLength={1200} placeholder="Write your review..." /><button type="submit" disabled={submittingReview}>{submittingReview ? "Submitting..." : currentUser ? "Post review" : "Sign in to review"}<ArrowUpRight size={15} /></button></form>
        </div>
      </section>

      {recent.length > 0 && <section className="product-recommendations"><div className="section-heading"><div><span className="product-eyebrow">YOUR BROWSING</span><h2>Recently viewed</h2></div></div><div className="recent-product-grid">{recent.map((item) => <Link to={`/products/${item.id}`} key={item.id} className="recent-product">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span className="recent-product-icon">{item.icon || "⚙"}</span>}<span>{item.name}</span><strong>₹{Number(item.price || 0).toLocaleString("en-IN")}</strong></Link>)}</div></section>}
      {relatedProducts.length > 0 && <section className="product-recommendations"><div className="section-heading"><div><span className="product-eyebrow">MORE FROM {String(product.category || "THIS CATEGORY").toUpperCase()}</span><h2>Related parts</h2></div><Link to="/products">Browse all <ArrowUpRight size={15} /></Link></div><div className="related-product-grid">{relatedProducts.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
      {showSticky && !outOfStock && <div className="product-mobile-buy"><span><small>{product.name}</small><strong>₹{(price * qty).toLocaleString("en-IN")}</strong></span><button type="button" onClick={handleAdd}><ShoppingBag size={17} /> Add to cart</button></div>}
    </main>
  );
}