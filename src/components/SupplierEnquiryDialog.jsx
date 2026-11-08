import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import { createSupplierEnquiry } from "../services/enquiryService";
import { canSubmitSupplierEnquiry } from "../services/enquiryEligibility";
import { getProductPricing } from "../services/productPricing";
import "./SupplierEnquiry.css";

export default function SupplierEnquiryDialog({ product, businessName, location: businessLocation, open, onClose }) {
  const dialogRef = useRef(null);
  const requestIdRef = useRef(window.crypto.randomUUID());
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, userProfile, isAdmin, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("Please confirm current availability and send me a quote for this part.");
  const [shareEmail, setShareEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return undefined;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setMessage("Please confirm current availability and send me a quote for this part.");
    setShareEmail(false);
    setSubmitting(false);
    setSent(false);
    setError("");
    requestIdRef.current = window.crypto.randomUUID();
  }, [open, product?.id]);

  if (!open || !product) return null;
  const canSend = canSubmitSupplierEnquiry({
    profile: userProfile,
    isAdmin,
    loading: authLoading,
  });
  const { sellingPrice, mrp } = getProductPricing(product);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!currentUser) {
      onClose();
      navigate("/login", { state: { from: location } });
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createSupplierEnquiry({
        productId: product.id,
        quantity: Number(quantity),
        message,
        shareEmail,
        requestId: requestIdRef.current,
      });
      setSent(true);
      addToast("Your enquiry was sent to the supplier.", "success");
    } catch (requestError) {
      setError(requestError.message || "Your enquiry could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="supplier-enquiry-dialog"
      aria-labelledby="supplier-enquiry-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="supplier-enquiry-content">
        <button type="button" className="supplier-enquiry-close" onClick={onClose} aria-label="Close enquiry form">×</button>
        {sent ? (
          <div className="supplier-enquiry-success" role="status">
            <span className="supplier-enquiry-kicker">ENQUIRY SENT</span>
            <h2 id="supplier-enquiry-title">Your request is with {businessName || "the supplier"}.</h2>
            <p>View replies and quotes in your enquiries. The supplier can access your email only if you chose to share it.</p>
            <div className="supplier-enquiry-actions">
              <Link to="/my-enquiries" onClick={onClose}>View my enquiries</Link>
              <button type="button" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <span className="supplier-enquiry-kicker">CONTACT SUPPLIER</span>
            <h2 id="supplier-enquiry-title">Request a quote</h2>
            <p className="supplier-enquiry-product">{product.name || product.title}{product.partNumber ? ` · ${product.partNumber}` : ""}</p>
            {Number.isFinite(sellingPrice) && sellingPrice > 0 && <p className="supplier-enquiry-price">
              Selling price: <strong>₹{sellingPrice.toLocaleString("en-IN")}</strong>
              {Number.isFinite(mrp) && mrp > sellingPrice && <> · MRP <del>₹{mrp.toLocaleString("en-IN")}</del></>}
            </p>}
            <p className="supplier-enquiry-seller">
              Sold by <strong>{businessName || "Business name unavailable"}</strong>
              {businessLocation && <span>{businessLocation} · Vendor-provided business area</span>}
            </p>
            {!currentUser ? (
              <div className="supplier-enquiry-signin">
                <p>Sign in to send an enquiry and view the supplier’s reply.</p>
                <button type="button" onClick={() => { onClose(); navigate("/login", { state: { from: location } }); }}>Sign in to continue</button>
              </div>
            ) : authLoading ? (
              <p role="status" className="supplier-enquiry-seller">Checking account eligibility...</p>
            ) : !canSend ? (
              <p className="supplier-enquiry-error" role="alert">An approved customer or vendor account is required to send an enquiry.</p>
            ) : (
              <form onSubmit={handleSubmit}>
                <label>
                  Requested quantity
                  <input type="number" min="1" max="1000000" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                </label>
                <label>
                  Message to supplier
                  <textarea maxLength="2000" required rows="4" value={message} onChange={(event) => setMessage(event.target.value)} />
                </label>
                {currentUser.email && <label className="supplier-enquiry-consent">
                  <input type="checkbox" checked={shareEmail} onChange={(event) => setShareEmail(event.target.checked)} />
                  <span>Share my account email ({currentUser.email}) with this supplier so they can reply directly.</span>
                </label>}
                {error && <p className="supplier-enquiry-error" role="alert">{error}</p>}
                <button className="supplier-enquiry-submit" type="submit" disabled={submitting}>
                  {submitting ? "Sending enquiry..." : "Send enquiry"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
