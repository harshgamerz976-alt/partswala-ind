export function AboutUs() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">About Us</h1>
      <p className="text-sm text-slate-400 leading-relaxed">
        We are India’s premier auto spare parts marketplace, committed to delivering high-quality, verified OEM components straight to your doorstep.
      </p>
    </div>
  );
}

export function ContactSupport() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Contact Support</h1>
      <p className="text-sm text-slate-400">Email: support@spareparts.in | Phone: +91 98765 43210</p>
    </div>
  );
}

export function FAQ() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Frequently Asked Questions</h1>
      <div className="space-y-3 text-xs text-slate-300">
        <p className="font-semibold text-white">Q: How do I know if a part fits my vehicle?</p>
        <p className="text-slate-400">A: Cross-check your vehicle's Part Number or SKU with our product listing descriptions.</p>
      </div>
    </div>
  );
}