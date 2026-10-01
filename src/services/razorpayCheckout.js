let razorpayScriptPromise;

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => window.Razorpay ? resolve() : reject(new Error("Razorpay checkout could not be initialized."));
      script.onerror = () => {
        razorpayScriptPromise = null;
        reject(new Error("Razorpay checkout could not be loaded. Please retry or choose Cash on Delivery."));
      };
      document.head.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}