import { Link } from "react-router-dom";

export default function CommerceUnavailable() {
  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-400">Supplier enquiries are open</p>
      <h1 className="mt-4 text-3xl font-black text-white">Online ordering is unavailable.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
        Checkout, payments, and shipping are disabled. Browse a part and contact its supplier for availability and a quote.
      </p>
      <Link to="/products" className="mt-6 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white hover:bg-orange-400">
        Browse parts
      </Link>
    </main>
  );
}
