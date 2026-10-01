import { useState } from "react";
import { loadRazorpayCheckout } from "../services/razorpayCheckout";

export default function RazorpayPayment({ amount, onSuccess, onError }) {
  const [loading, setLoading] = useState(false);

  async function handlePayment() {
    setLoading(true);
    try {
      await loadRazorpayCheckout();
      const endpoint = import.meta.env.VITE_RAZORPAY_ORDER_ENDPOINT;
      if (!endpoint) throw new Error("Razorpay order endpoint is not configured.");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: amount * 100, currency: "INR", receipt: "rcpt_" + Date.now() }),
      });
      const order = await res.json();
      if (order.error) { onError("Payment init failed."); setLoading(false); return; }
      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency,
        name: "PARTSWALA IND",
        description: "Truck Parts Order",
        order_id: order.id,
        handler: function (response) { onSuccess(response); },
        theme: { color: "#f97316" },
      };
      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function () { onError("Payment failed. Try COD."); });
      rzp.open();
    } catch { onError("Could not connect to gateway."); }
    setLoading(false);
  }

  return (
    <button
      type="button"
      onClick={handlePayment}
      disabled={loading}
      className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
    >
      {loading ? (
        <>
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          Processing...
        </>
      ) : (
        <>💳 Pay ₹{amount.toLocaleString()} Online</>
      )}
    </button>
  );
}