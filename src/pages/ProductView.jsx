import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Share2, Star } from "lucide-react";
import { getProductById, getPublicVendorWhatsAppNumber, getRelatedProducts } from "../services/productService";
import { addReview, getProductReviews } from "../services/reviewService";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import { createSupplierEnquiry } from "../services/supplierEnquiryService";
import { getKnownProductStock, getProductTaxLabel } from "../services/productPresentation";
import WhatsAppButton from "../components/WhatsAppButton";
import ProductCard from "../components/productcard";
import StarRating from "../components/StarRating";
import { ProductDetailSkeleton } from "../components/Skeleton";
import "./ProductView.css";

const ProductInspection3D = lazy(() => import("../components/ProductInspection3D"));

export default function ProductView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { currentUser, userProfile, isAdmin } = useAuth();
  const [product, setProduct] = useState(null);
  const [vendorWhatsAppNumber, setVendorWhatsAppNumber] = useState(null);
  const [vendorContactError, setVendorContactError] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoadError, setReviewsLoadError] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedLoadError, setRelatedLoadError] = useState(false);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [enquiryQuantity, setEnquiryQuantity] = useState("1");
  const [enquiryMessage, setEnquiryMessage] = useState("");
  const [shareEmail, setShareEmail] = useState(false);
  const [submittingEnquiry, setSubmittingEnquiry] = useState(false);
  const [enquiryError, setEnquiryError] = useState("");
  const [submittedEnquiryId, setSubmittedEnquiryId] = useState("");
  const enquiryRequestGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    setProduct(null);
    getProductById(id)
      .then((nextProduct) => {
        if (!active) return;
        setProduct(nextProduct);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reloadCount]);

  useEffect(() => {
    enquiryRequestGeneration.current += 1;
    setEnquiryQuantity("1");
    setEnquiryMessage("");
    setShareEmail(false);
    setEnquiryError("");
    setSubmittedEnquiryId("");
    setSubmittingEnquiry(false);
  }, [id, currentUser?.uid]);

  useEffect(() => {
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
    setReviews([]);
    setReviewsLoadError(false);
    getProductReviews(id)
      .then((nextReviews) => {
        if (active) {
          setReviews(nextReviews);
          setReviewsLoadError(false);
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error("Product reviews could not be loaded:", error);
        setReviewsLoadError(true);
      });
    setRelatedLoading(true);
    setRelatedLoadError(false);
    getRelatedProducts(product.category, id)
      .then((nextProducts) => { if (active) setRelatedProducts(nextProducts); })
      .catch(() => { if (active) setRelatedLoadError(true); })
      .finally(() => { if (active) setRelatedLoading(false); });
    return () => { active = false; };
  }, [product, id]);

  useEffect(() => {
    let active = true;
    setVendorWhatsAppNumber(null);
    setVendorContactError(false);
    if (!product || product.id !== id || String(product.sellerType || "").toLowerCase() !== "vendor") {
      return () => { active = false; };
    }

    getPublicVendorWhatsAppNumber(id)
      .then((number) => { if (active) setVendorWhatsAppNumber(number); })
      .catch(() => { if (active) setVendorContactError(true); });
    return () => { active = false; };
  }, [product, id]);

  if (loading) return <ProductDetailSkeleton />;
  if (!product) {
    return (
      <main className="product-view-empty">
        <p>{loadError ? "CATALOGUE UNAVAILABLE" : "PART NOT FOUND"}</p>
        <h1>{loadError ? "Product details could not be loaded." : "This listing is no longer available."}</h1>
        {loadError && <button className="product-view-retry" type="button" onClick={() => setReloadCount((count) => count + 1)}>Try again</button>}
        <Link to="/products"><ArrowLeft size={16} /> Back to all parts</Link>
      </main>
    );
  }

  const stock = getKnownProductStock(product);
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

  async function handleSubmitReview(event) {
    event.preventDefault();
    if (!currentUser) return navigate("/login");
    if (!reviewRating || !reviewText.trim()) return addToast("Add a rating and a short review", "error");
    setSubmittingReview(true);
    try {
      await addReview(id, reviewRating, reviewText.trim());
      setReviewRating(0);
      setReviewText("");
      try {
        setReviews(await getProductReviews(id));
        setReviewsLoadError(false);
      } catch (error) {
        console.error("Product reviews could not be refreshed:", error);
        setReviewsLoadError(true);
      }
      addToast("Your review has been submitted", "success");
    } catch {
      addToast("Could not submit your review", "error");
    } finally {
      setSubmittingReview(false);
    }
  }

  async function handleSubmitEnquiry(event) {
    event.preventDefault();
    if (!currentUser) return navigate("/login");
    const quantity = Number(enquiryQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000 || !enquiryMessage.trim()) {
      setEnquiryError("Enter a quantity and a message for the supplier.");
      return;
    }
    const generation = ++enquiryRequestGeneration.current;
    setSubmittingEnquiry(true);
    setEnquiryError("");
    try {
      const result = await createSupplierEnquiry(currentUser, {
        productId: id,
        quantity,
        message: enquiryMessage.trim(),
        shareEmail,
      });
      if (generation !== enquiryRequestGeneration.current) return;
      setSubmittedEnquiryId(result.enquiryId);
      addToast("Your quote request has been sent", "success");
    } catch (error) {
      if (generation !== enquiryRequestGeneration.current) return;
      setEnquiryError(error.message || "Your quote request could not be sent.");
    } finally {
      if (generation === enquiryRequestGeneration.current) setSubmittingEnquiry(false);
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
          <div className="product-price-row">{discountAmount > 0 && <del>MRP ₹{mrp.toLocaleString("en-IN")}</del>}<strong>₹{price.toLocaleString("en-IN")}</strong><span>{getProductTaxLabel(product.priceIncludesGst)}</span>{discountAmount > 0 && <span className="product-savings">You save ₹{discountAmount.toLocaleString("en-IN")}</span>}</div>
          <div className={`stock-line ${outOfStock ? "is-out" : ""}`}><span className="stock-indicator" />{stock === null ? "Ask supplier to confirm availability" : outOfStock ? "Currently unavailable" : stock < 6 ? `Only ${stock} available to enquire` : "Available to enquire"}</div>
          <WhatsAppButton sellerType={product.sellerType} whatsAppNumber={vendorWhatsAppNumber} productName={product.name} partNumber={product.partNumber || ""} className="product-whatsapp-button" />
          {vendorContactError && <p className="text-sm text-slate-400" role="status">Direct supplier contact is unavailable. Use the quote request form instead.</p>}
          <div className="product-promises"><div><span aria-hidden="true">◇</span><span>Ask the supplier for availability</span></div><div><span aria-hidden="true">◇</span><span>Request a price quote</span></div><div><span aria-hidden="true">◇</span><span>Online ordering is unavailable</span></div></div>
          {product.sellerType === "vendor" && !currentUser && <Link className="mt-5 inline-flex text-sm text-cyan-300 underline" to="/login">Sign in to request a supplier quote</Link>}
          {product.sellerType === "vendor" && currentUser && userProfile?.role === "customer" && !isAdmin && product.sellerId !== currentUser.uid && (
            <form className="mt-5 grid gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4" onSubmit={handleSubmitEnquiry}>
              <h2 className="text-lg font-semibold">Request a supplier quote</h2>
              <p className="text-sm leading-6 text-slate-300">
                The relevant supplier receives your enquiry details. Your account email is shared only if you select the separate option below. See our <Link className="underline" to="/legal/privacy">Privacy Policy</Link> and <Link className="underline" to="/legal/enquiries">Enquiry &amp; Quotation Policy</Link>.
              </p>
              {submittedEnquiryId ? (
                <p className="text-sm text-emerald-300" role="status">Request sent. <Link className="underline" to="/my-enquiries">View your enquiries</Link></p>
              ) : (
                <>
                  <label className="grid gap-1 text-sm">Quantity<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" type="number" min="1" max="1000000" step="1" required value={enquiryQuantity} onChange={(event) => setEnquiryQuantity(event.target.value)} /></label>
                  <label className="grid gap-1 text-sm">Message to supplier<textarea className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" rows="3" maxLength={2000} required value={enquiryMessage} onChange={(event) => setEnquiryMessage(event.target.value)} placeholder="Ask about price, availability, or fitment." /></label>
                  <label className="flex items-start gap-2 text-sm text-slate-300"><input className="mt-1" type="checkbox" checked={shareEmail} onChange={(event) => setShareEmail(event.target.checked)} /><span>Share my account email with this supplier so they can respond outside the site.</span></label>
                  {enquiryError && <p className="text-sm text-red-300" role="alert">{enquiryError}</p>}
                  <button className="w-fit rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60" type="submit" disabled={submittingEnquiry}>{submittingEnquiry ? "Sending request..." : "Send quote request"}</button>
                </>
              )}
              <p className="text-xs text-slate-400">A quote request does not create an order, payment, or shipment.</p>
            </form>
          )}
        </section>
      </div>

      <section className="product-spec-strip" aria-label="Product details"><div><span>PART NUMBER</span><strong>{product.partNumber || "Not specified"}</strong></div><div><span>BRAND</span><strong>{product.brand || "Genuine fit"}</strong></div><div><span>CATEGORY</span><strong>{product.category || "Spare part"}</strong></div><div><span>SELLER</span><strong>{product.vendorBusinessName || (product.sellerType === "vendor" ? "Approved vendor" : "PARTSWALA IND")}</strong></div></section>

      <section className="product-reviews" id="product-reviews">
        <div className="section-heading"><div><span className="product-eyebrow">CUSTOMER FEEDBACK</span><h2>Reviews <span>({reviewsLoadError ? "unavailable" : reviews.length})</span></h2></div>{avgRating && <div className="reviews-average"><Star size={17} fill="currentColor" />{avgRating}<span>/ 5</span></div>}</div>
        <div className="reviews-layout">
          <div className="review-list">{reviewsLoadError ? <p className="reviews-empty" role="alert">Reviews are temporarily unavailable.</p> : reviews.length === 0 ? <p className="reviews-empty">No reviews yet. Your experience can help the next buyer.</p> : reviews.map((review) => <article className="review-entry" key={review.id}><div className="review-author"><span>{(review.userName || "P").slice(0, 1).toUpperCase()}</span><div><strong>{review.userName || "PARTSWALA customer"}</strong><time>{review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Recently"}</time></div><StarRating rating={review.rating} readonly size="w-4 h-4" /></div><p>{review.text || review.comment}</p></article>)}</div>
          <form className="review-form" onSubmit={handleSubmitReview}><h3>Share your experience</h3><p>Tell other buyers how this part worked for you.</p><StarRating rating={reviewRating} setRating={setReviewRating} size="w-6 h-6" /><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} rows="4" maxLength={1200} placeholder="Write your review..." /><button type="submit" disabled={submittingReview}>{submittingReview ? "Submitting..." : currentUser ? "Post review" : "Sign in to review"}<ArrowUpRight size={15} /></button></form>
        </div>
      </section>

      {recent.length > 0 && <section className="product-recommendations"><div className="section-heading"><div><span className="product-eyebrow">YOUR BROWSING</span><h2>Recently viewed</h2></div></div><div className="recent-product-grid">{recent.map((item) => <Link to={`/products/${item.id}`} key={item.id} className="recent-product">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span className="recent-product-icon">{item.icon || "⚙"}</span>}<span>{item.name}</span><strong>₹{Number(item.price || 0).toLocaleString("en-IN")}</strong></Link>)}</div></section>}
      {relatedLoading && <p className="reviews-empty" role="status">Loading related parts...</p>}
      {relatedLoadError && <p className="reviews-empty" role="alert">Related parts could not be loaded. <button type="button" onClick={() => setReloadCount((count) => count + 1)}>Try again</button></p>}
      {relatedProducts.length > 0 && <section className="product-recommendations"><div className="section-heading"><div><span className="product-eyebrow">MORE FROM {String(product.category || "THIS CATEGORY").toUpperCase()}</span><h2>Related parts</h2></div><Link to="/products">Browse all <ArrowUpRight size={15} /></Link></div><div className="related-product-grid">{relatedProducts.map((item) => <ProductCard key={item.id} product={item} />)}</div></section>}
    </main>
  );
}