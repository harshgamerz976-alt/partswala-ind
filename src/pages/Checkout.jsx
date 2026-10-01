import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CreditCard, MapPin, Package, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import { useCart } from "../context/useCart";
import CitySearch from "../components/CitySearch";
import { cancelPendingOrder, createPhonePeCheckout, createRazorpayOrder, getCheckoutQuote, placeOrder, syncShiprocketOrder, verifyRazorpayPayment } from "../services/orderService";
import { loadRazorpayCheckout } from "../services/razorpayCheckout";
import { formatIndianPhoneForDisplay, formatIndianPhoneForFirebase, normalizeIndianPhoneNumber } from "../../shared/phoneNumber.js";
import { deliveryPhoneVerificationState } from "../services/phoneVerificationState.js";

function formatPrice(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizePhone(value) {
  return formatIndianPhoneForDisplay(value);
}

export default function Checkout() {
  const { currentUser, userProfile, loading: authLoading, sendPhoneOtp, verifyPhoneOtp, refreshUserProfile } = useAuth();
  const currentUserId = currentUser?.uid || "";
  const { addToast } = useToast();
  const { cart, clearCart } = useCart();
  const navigate = useNavigate();
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [pricing, setPricing] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState("");
  const submissionInProgress = useRef(false);
  const checkoutIdempotencyKey = useRef(crypto.randomUUID());
  const [addressForm, setAddressForm] = useState({
    fullName: "",
    phone: "",
    streetAddress: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
  });

  useEffect(() => {
    if (!authLoading && !currentUser) navigate("/login", { replace: true, state: { from: "/checkout" } });
  }, [authLoading, currentUser, navigate]);

  useEffect(() => {
    if (cart.length === 0) navigate("/cart", { replace: true });
  }, [cart.length, navigate]);

  useEffect(() => {
    if (currentUserId) refreshUserProfile().catch((error) => console.warn("Could not refresh checkout phone verification state.", error.message));
  }, [currentUserId, refreshUserProfile]);

  useEffect(() => {
    const address = userProfile?.addresses?.[0];
    if (!userProfile) return;
    setAddressForm((previous) => ({
      ...previous,
      fullName: previous.fullName || userProfile.fullName || userProfile.displayName || currentUser?.displayName || "",
      phone: previous.phone || normalizePhone(userProfile.phone || ""),
      streetAddress: previous.streetAddress || address?.street || "",
      addressLine2: previous.addressLine2 || address?.line2 || "",
      city: previous.city || address?.city || "",
      state: previous.state || address?.state || "",
      zipCode: previous.zipCode || address?.zip || "",
    }));
  }, [userProfile, currentUser]);

  useEffect(() => {
    const deliveryPincode = addressForm.zipCode.trim();
    if (!currentUser || cart.length === 0 || !addressForm.state.trim() || !/^\d{6}$/.test(deliveryPincode)) {
      setPricing(null);
      setPricingError("");
      setPricingLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPricing(null);
    setPricingLoading(true);
    const timer = window.setTimeout(() => {
      getCheckoutQuote(cart, { customer: { phone: addressForm.phone, state: addressForm.state.trim(), zipCode: deliveryPincode }, paymentMethod, couponCode })
        .then((result) => {
          if (!cancelled) {
            setPricing(result.pricing);
            setPricingError("");
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setPricing(null);
            setPricingError(error.message || "Checkout pricing could not be calculated.");
          }
        })
        .finally(() => {
          if (!cancelled) setPricingLoading(false);
        });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [currentUser, cart, addressForm.phone, addressForm.state, addressForm.zipCode, paymentMethod, couponCode, userProfile?.phoneVerified, userProfile?.verifiedPhone]);

  function handleInputChange(event) {
    const value = event.target.value;
    setAddressForm((previous) => ({ ...previous, [event.target.name]: value }));
    if (event.target.name === "phone") {
      setOtpSent(false);
      setOtp("");
    }
    setErrorMessage("");
  }

  const deliveryPhoneState = deliveryPhoneVerificationState(userProfile, addressForm.phone);
  const phoneIsVerified = deliveryPhoneState === "verified";

  async function verifyPhoneBeforeOrder() {
    if (phoneIsVerified) return true;
    const phone = formatIndianPhoneForFirebase(addressForm.phone);
    if (!phone) {
      setErrorMessage("Enter a valid 10-digit Indian mobile number.");
      return false;
    }
    if (!otpSent) {
      setOtpLoading(true);
      try {
        await sendPhoneOtp(phone);
        setOtpSent(true);
        setErrorMessage("We sent a verification code to your phone. Enter it below to continue.");
      } catch (error) {
        setErrorMessage(error.message || "Could not send a phone verification code.");
      } finally {
        setOtpLoading(false);
      }
      return false;
    }
    if (otp.length < 6) {
      setErrorMessage("Enter the 6-digit verification code to continue.");
      return false;
    }
    setOtpLoading(true);
    try {
      await verifyPhoneOtp(otp, phone);
      setOtpSent(false);
      setOtp("");
      return true;
    } catch {
      setErrorMessage("That code is invalid or expired. Please try again.");
      return false;
    } finally {
      setOtpLoading(false);
    }
  }

  function validateAddress() {
    const requiredFields = ["fullName", "phone", "streetAddress", "city", "state", "zipCode"];
    const missingField = requiredFields.find((field) => !addressForm[field].trim());
    if (missingField) {
      setErrorMessage("Please complete every delivery field before continuing.");
      return false;
    }
    if (!normalizeIndianPhoneNumber(addressForm.phone)) {
      setErrorMessage("Enter a valid 10-digit Indian mobile number.");
      return false;
    }
    if (!/^\d{6}$/.test(addressForm.zipCode.trim())) {
      setErrorMessage("Enter a valid 6-digit PIN code.");
      return false;
    }
    return true;
  }

  function applyCoupon() {
    setCouponCode(couponInput.trim().toUpperCase());
  }

  function orderCheckoutDetails() {
    return { customer: { ...addressForm, phone: formatIndianPhoneForFirebase(addressForm.phone) }, paymentMethod, couponCode, idempotencyKey: checkoutIdempotencyKey.current };
  }

  async function releaseUnpaidOrder(orderId) {
    if (!orderId) return;
    try {
      await cancelPendingOrder(orderId);
      checkoutIdempotencyKey.current = crypto.randomUUID();
    } catch (error) {
      console.warn("Could not release inventory for an unpaid order:", error.message);
    }
  }

  async function finalizeOrder(orderId) {
    let shiprocketError = null;
    try {
      await syncShiprocketOrder(orderId);
    } catch (error) {
      shiprocketError = error;
      console.error("[SHIPROCKET FRONTEND] syncShiprocketOrder failed after order creation:", error);
    }
    clearCart();
    if (shiprocketError) addToast(`Order placed. Shipping setup failed: ${shiprocketError.message || "Check the backend logs."}`, "warning");
    else addToast("Order placed successfully!", "success");
    navigate(`/orders/${orderId}`);
  }

  async function processOrder() {
    try {
      const created = await placeOrder(cart, orderCheckoutDetails());
      await finalizeOrder(created.orderId);
    } catch (error) {
      console.error("Checkout failed:", error);
      setErrorMessage(error.message || "We could not place the order. Please try again.");
      addToast("Failed to complete order processing", "error");
    } finally {
      setLoading(false);
      submissionInProgress.current = false;
    }
  }

  async function startPhonePePayment() {
    let created;
    try {
      created = await placeOrder(cart, orderCheckoutDetails());
      const result = await createPhonePeCheckout(created.orderId);
      if (!result.redirectUrl) throw new Error("PhonePe checkout could not be started.");
      window.location.assign(result.redirectUrl);
    } catch (error) {
      await releaseUnpaidOrder(created?.orderId);
      submissionInProgress.current = false;
      setLoading(false);
      setErrorMessage(error.message || "PhonePe payment could not be started.");
    }
  }

  async function handleCheckoutSubmit(event) {
    event.preventDefault();
    if (submissionInProgress.current || loading || cart.length === 0 || !validateAddress()) return;
    submissionInProgress.current = true;
    if (!(await verifyPhoneBeforeOrder())) {
      submissionInProgress.current = false;
      return;
    }
    setLoading(true);
    setErrorMessage("");

    if (paymentMethod === "COD") {
      await processOrder();
      return;
    }

    if (paymentMethod === "PhonePe") {
      await startPhonePePayment();
      return;
    }

    let createdOrder;
    let razorpayOrder;
    try {
      await loadRazorpayCheckout();
      createdOrder = await placeOrder(cart, orderCheckoutDetails());
      razorpayOrder = await createRazorpayOrder(createdOrder.orderId);
    } catch (error) {
      await releaseUnpaidOrder(createdOrder?.orderId);
      submissionInProgress.current = false;
      setLoading(false);
      setErrorMessage(error.message || "Online payment is unavailable right now.");
      return;
    }
    const razorpayKey = razorpayOrder.key_id || import.meta.env.VITE_RAZORPAY_KEY_ID;
    if (!window.Razorpay || !razorpayKey) {
      await releaseUnpaidOrder(createdOrder.orderId);
      submissionInProgress.current = false;
      setLoading(false);
      setErrorMessage("Online payment is unavailable right now. Please choose Cash on Delivery.");
      return;
    }

    const razorpay = new window.Razorpay({
      key: razorpayKey,
      amount: razorpayOrder.amount,
      currency: "INR",
      order_id: razorpayOrder.id,
      name: "PARTSWALA IND",
      description: "Truck parts order",
      prefill: { name: addressForm.fullName, contact: addressForm.phone },
      theme: { color: "#f97316" },
      modal: { ondismiss: () => { void releaseUnpaidOrder(createdOrder.orderId); submissionInProgress.current = false; setLoading(false); } },
      handler: async (response) => {
        try {
          const verification = await verifyRazorpayPayment(createdOrder.orderId, response);
          if (!verification.valid) throw new Error("Razorpay payment verification failed.");
          await finalizeOrder(createdOrder.orderId);
        } catch (error) {
          await releaseUnpaidOrder(createdOrder.orderId);
          submissionInProgress.current = false;
          setLoading(false);
          setErrorMessage(error.message || "Payment could not be verified.");
        }
      },
    });

    razorpay.on("payment.failed", () => {
      void releaseUnpaidOrder(createdOrder.orderId);
      submissionInProgress.current = false;
      setLoading(false);
      setErrorMessage("Payment failed. You can retry or choose Cash on Delivery.");
    });
    razorpay.open();
  }

  if (cart.length === 0) return null;

  const hasValidDeliveryPincode = /^\d{6}$/.test(addressForm.zipCode.trim());
  const shippingDisplay = pricingLoading
    ? "Calculating..."
    : pricingError
      ? "Unable to calculate"
      : !hasValidDeliveryPincode
        ? "Enter pincode"
        : pricing
          ? pricing.shippingIsFree ? "Free" : pricing.shippingCharge > 0 ? formatPrice(pricing.shippingCharge) : "Unable to calculate"
          : addressForm.state.trim() ? "Calculating..." : "Enter state";

  return (
    <main className="checkout-page">
      <div className="checkout-header">
        <Link to="/cart" className="checkout-back"><ArrowLeft size={15} /> Back to cart</Link>
        <p className="checkout-kicker">SECURE CHECKOUT / 02</p>
        <h1>Finish your order.</h1>
        <p>Confirm delivery details and choose how you want to pay.</p>
      </div>

      <form onSubmit={handleCheckoutSubmit} className="checkout-layout">
        <div className="checkout-main">
          <section className="checkout-panel">
            <div className="checkout-panel-heading"><span><MapPin size={17} /></span><div><p>STEP 01</p><h2>Delivery details</h2></div></div>
            <div className="checkout-fields">
              <input required name="fullName" placeholder="Full name" value={addressForm.fullName} onChange={handleInputChange} />
              <input required name="phone" type="tel" placeholder="+91 9876543210" value={addressForm.phone} onChange={handleInputChange} />
              <div id="phone-recaptcha" className="phone-recaptcha" />
              <div className="checkout-phone-verification">{phoneIsVerified ? <span className="profile-phone-verified"><Check size={14} /> Phone already verified</span> : deliveryPhoneState === "mismatch" ? <span>Your delivery number differs from the verified mobile number. Update it in Profile or verify this number at checkout.</span> : otpSent ? <div className="profile-otp-entry"><span>Enter the OTP sent to your phone</span><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit OTP" inputMode="numeric" /><button type="button" onClick={() => verifyPhoneBeforeOrder()} disabled={otpLoading || otp.length < 6}>{otpLoading ? "Checking..." : "Verify OTP"}</button></div> : <span>Phone verification is required before placing this order.</span>}</div>
              <input required name="streetAddress" placeholder="Street address" value={addressForm.streetAddress} onChange={handleInputChange} />
              <input name="addressLine2" placeholder="Address line 2 (optional)" value={addressForm.addressLine2} onChange={handleInputChange} />
              <div className="checkout-field-row">
                <CitySearch value={addressForm.city} onChange={(city) => setAddressForm((previous) => ({ ...previous, city }))} />
                <input required name="state" placeholder="State" value={addressForm.state} onChange={handleInputChange} />
              </div>
              <input required name="zipCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6-digit delivery pincode" value={addressForm.zipCode} onChange={handleInputChange} />
            </div>
          </section>

          <section className="checkout-panel">
            <div className="checkout-panel-heading"><span><CreditCard size={17} /></span><div><p>STEP 02</p><h2>Payment method</h2></div></div>
            <div className="checkout-payment-options">
              <label className={paymentMethod === "COD" ? "is-selected" : ""}>
                <input type="radio" name="payment" value="COD" checked={paymentMethod === "COD"} onChange={() => setPaymentMethod("COD")} />
                <span><strong>Cash on Delivery</strong><small>Pay when your parts arrive</small></span><Check size={16} />
              </label>
              <label className={paymentMethod === "Online" ? "is-selected" : ""}>
                <input type="radio" name="payment" value="Online" checked={paymentMethod === "Online"} onChange={() => setPaymentMethod("Online")} />
                <span><strong>Online payment</strong><small>Secure Razorpay checkout</small></span><Check size={16} />
              </label>
              <label className={paymentMethod === "PhonePe" ? "is-selected" : ""}>
                <input type="radio" name="payment" value="PhonePe" checked={paymentMethod === "PhonePe"} onChange={() => setPaymentMethod("PhonePe")} />
                <span><strong>PhonePe</strong><small>Pay securely with PhonePe</small></span><Check size={16} />
              </label>
            </div>
          </section>

          {errorMessage && <p className="checkout-error" role="alert">{errorMessage}</p>}
        </div>

        <aside className="checkout-summary">
          <div className="checkout-summary-heading"><span><Package size={17} /></span><div><p>YOUR ORDER</p><h2>{cart.reduce((count, item) => count + item.quantity, 0)} items</h2></div></div>
          <div className="checkout-order-items">
            {cart.map((item) => (
              <div key={item.id} className="checkout-order-item">
                <div className="checkout-order-image">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>{item.icon || "⚙"}</span>}</div>
                <div><strong>{item.name || item.title}</strong><span>{pricing ? `${item.quantity} × ${formatPrice(pricing.items.find((line) => line.productId === item.id)?.price)}` : "Server price pending"}</span>{pricing && pricing.items.find((line) => line.productId === item.id)?.mrp > pricing.items.find((line) => line.productId === item.id)?.price && <small>MRP {formatPrice(pricing.items.find((line) => line.productId === item.id).mrp)} · Save {formatPrice(pricing.items.find((line) => line.productId === item.id).discountAmount)}</small>}</div>
                <b>{pricing ? formatPrice(pricing.items.find((line) => line.productId === item.id)?.grossAmount) : "—"}</b>
              </div>
            ))}
          </div>
          <div className="checkout-coupon"><label htmlFor="checkout-coupon">Coupon code</label><div><input id="checkout-coupon" value={couponInput} onChange={(event) => setCouponInput(event.target.value)} placeholder="Enter coupon code" /><button type="button" onClick={applyCoupon}>Apply</button>{couponCode && <button type="button" onClick={() => { setCouponInput(""); setCouponCode(""); }}>Remove</button>}</div></div>
          {pricingLoading && <p className="checkout-pricing-message">Calculating current prices and taxes...</p>}
          {pricingError && <p className="checkout-error" role="alert">{pricingError}</p>}
          {pricing && <div className="checkout-total-lines">
            {pricing.mrpTotal > pricing.subtotal && <div><span>MRP total</span><strong>{formatPrice(pricing.mrpTotal)}</strong></div>}
            {pricing.productDiscount > 0 && <div><span>Discount from MRP</span><strong>-{formatPrice(pricing.productDiscount)}</strong></div>}
            <div><span>Selling price</span><strong>{formatPrice(pricing.subtotal)}</strong></div>
            {pricing.couponDiscount > 0 && <div><span>Coupon discount</span><strong>-{formatPrice(pricing.couponDiscount)}</strong></div>}
            <div><span>Taxable product value</span><strong>{formatPrice(pricing.taxableProductValue)}</strong></div>
            <div><span>Estimated Shipping</span><strong>{shippingDisplay}</strong></div>
            {paymentMethod === "COD" && <div><span>COD Fee</span><strong>{formatPrice(pricing.codFee)}</strong></div>}
            {pricing.taxMode === "intra_state" && <><div><span>CGST{pricing.items.every((line) => line.priceIncludesGst) ? " (included/applicable)" : ""}</span><strong>{formatPrice(pricing.cgst)}</strong></div><div><span>SGST{pricing.items.every((line) => line.priceIncludesGst) ? " (included/applicable)" : ""}</span><strong>{formatPrice(pricing.sgst)}</strong></div></>}
            {pricing.taxMode === "inter_state" && <div><span>IGST{pricing.items.every((line) => line.priceIncludesGst) ? " (included/applicable)" : ""}</span><strong>{formatPrice(pricing.igst)}</strong></div>}
            <div className="checkout-grand-total"><span>Total payable</span><strong>{formatPrice(pricing.grandTotal)}</strong></div>
          </div>}
          {!pricing && <div className="checkout-total-lines"><div><span>Estimated Shipping</span><strong>{shippingDisplay}</strong></div></div>}
          {!pricing && !pricingError && !pricingLoading && <p className="checkout-pricing-message">Enter your delivery state and pincode to calculate GST and shipping.</p>}
          {pricing?.shippingIsEstimate && <p className="checkout-pricing-message">{pricing.shippingQuote?.provider === "shiprocket" ? "Courier quote from Shiprocket; final shipment charges may vary." : "Shipping estimate; final courier charges may vary by route."}</p>}
          <button type="submit" disabled={loading || pricingLoading || !pricing} className="checkout-submit"><ShieldCheck size={17} />{loading ? "Processing..." : paymentMethod === "COD" ? "Place order" : "Pay securely"}<ArrowLeft size={16} className="checkout-submit-arrow" /></button>
          <p className="checkout-note">Your information is used only to deliver this order.</p>
        </aside>
      </form>
    </main>
  );
}
