import { useState } from "react";
import Razorpay from "react-razorpay";

export default function RazorpayButton({ amount, onSuccess, children, className = "" }) {
  const [loading, setLoading] = useState(false);

  async function handlePayment() {
    setLoading(true);

    try {
      const endpoint = import.meta.env.VITE_RAZORPAY_ORDER_ENDPOINT;
      if (!endpoint) throw new Error("Razorpay order endpoint is not configured.");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amount * 100, // Razorpay takes paise
          currency: "INR",
          receipt: "rcpt_" + Date.now(),
        }),
      });

      const order = await res.json();

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency,
        name: "PARTSWALA IND",
        description: "Truck Parts Order",
        order_id: order.id,
        handler: function (response) {
          onSuccess(response);
        },
        prefill: {
          name: "",
          email: "",
          contact: "",
        },
        theme: {
          color: "#f97316",
        },
      };

      const rzp = new Razorpay(options);
      rzp.open();
    } catch {
      alert("Payment failed to initialize. Try again.");
    }

    setLoading(false);
  }

  return (
    <button onClick={handlePayment} disabled={loading} className={className}>
      {loading ? "Processing..." : children}
    </button>
  );
}