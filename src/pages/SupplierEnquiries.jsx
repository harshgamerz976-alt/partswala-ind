import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { getSupplierEnquiries, sendSupplierQuote } from "../services/supplierEnquiryService";

function formatPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "Quote pending";
}

export default function SupplierEnquiries({ audience }) {
  const { currentUser, userProfile, isAdmin, isVendor, vendorAccessLoading, loading: authLoading } = useAuth();
  const [enquiries, setEnquiries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [quoteDrafts, setQuoteDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [sentIds, setSentIds] = useState([]);
  const requestGeneration = useRef(0);

  const authorized = audience === "vendor"
    ? isVendor
    : audience === "customer" && !isAdmin && userProfile?.role === "customer";

  const loadFirstPage = useCallback(async () => {
    if (!currentUser || !authorized) return;
    const generation = requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const result = await getSupplierEnquiries(currentUser, audience);
      if (generation !== requestGeneration.current) return;
      setEnquiries(result.enquiries);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (requestError) {
      if (generation !== requestGeneration.current) return;
      setError(requestError.message || "Supplier enquiries could not be loaded.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [audience, authorized, currentUser]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setEnquiries([]);
    setCursor(null);
    setHasMore(false);
    setQuoteDrafts({});
    setSentIds([]);
    setLoadingMore(false);
    setSavingId("");
    setError("");
    if (authLoading || (audience === "vendor" && vendorAccessLoading)) return;
    if (!currentUser || !authorized) {
      setLoading(false);
    } else {
      void loadFirstPage();
    }
    return () => {
      if (requestGeneration.current === generation) requestGeneration.current += 1;
    };
  }, [audience, authLoading, authorized, currentUser, loadFirstPage, vendorAccessLoading]);

  async function loadMore() {
    if (!cursor || !currentUser || loadingMore) return;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setError("");
    try {
      const result = await getSupplierEnquiries(currentUser, audience, cursor);
      if (generation !== requestGeneration.current) return;
      setEnquiries((previous) => [...previous, ...result.enquiries]);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (requestError) {
      if (generation !== requestGeneration.current) return;
      setError(requestError.message || "More supplier enquiries could not be loaded.");
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  }

  function updateQuote(enquiryId, field, value) {
    setQuoteDrafts((previous) => ({
      ...previous,
      [enquiryId]: { ...(previous[enquiryId] || {}), [field]: value },
    }));
  }

  async function submitQuote(event, enquiry) {
    event.preventDefault();
    const draft = quoteDrafts[enquiry.id] || {};
    const amount = Number(draft.amount);
    const message = String(draft.message || "").trim();
    if (!Number.isFinite(amount) || amount <= 0 || !message) {
      setError("Enter a positive quote amount and quote details.");
      return;
    }
    const generation = requestGeneration.current;
    setSavingId(enquiry.id);
    setError("");
    try {
      await sendSupplierQuote(currentUser, enquiry.id, { amount, message });
      if (generation !== requestGeneration.current) return;
      setSentIds((previous) => [...new Set([...previous, enquiry.id])]);
      await loadFirstPage();
    } catch (requestError) {
      if (generation !== requestGeneration.current) return;
      setError(requestError.message || "Your quote could not be sent.");
    } finally {
      if (generation === requestGeneration.current) setSavingId("");
    }
  }

  if (authLoading || (audience === "vendor" && vendorAccessLoading)) {
    return <main className="mx-auto max-w-4xl px-5 py-20 text-slate-300">Verifying account access...</main>;
  }
  if (!currentUser) {
    return <main className="mx-auto max-w-4xl px-5 py-20 text-slate-200"><h1 className="text-2xl font-semibold">Sign in to view enquiries</h1><Link className="mt-4 inline-block text-cyan-300 underline" to={audience === "vendor" ? "/vendor/login" : "/login"}>Sign in</Link></main>;
  }
  if (!authorized) {
    return <main className="mx-auto max-w-4xl px-5 py-20 text-slate-200"><h1 className="text-2xl font-semibold">Enquiry access is unavailable</h1><Link className="mt-4 inline-block text-cyan-300 underline" to="/">Return to the homepage</Link></main>;
  }

  return (
    <main className="mx-auto min-h-[70vh] max-w-4xl px-5 py-12 text-white">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{audience === "vendor" ? "Vendor workspace" : "Your account"}</p>
        <h1 className="mt-2 text-3xl font-semibold">{audience === "vendor" ? "Supplier enquiries" : "My enquiries"}</h1>
        <p className="mt-2 text-sm text-slate-400">{audience === "vendor" ? "Review customer requests and send a supplier quote." : "Review supplier responses to your quote requests."} No order or payment is created from a quote.</p>
      </header>

      {error && <p className="mb-5 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200" role="alert">{error}</p>}
      {loading ? <p role="status" className="text-slate-300">Loading enquiries...</p> : enquiries.length === 0 ? (
        <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-6">
          <p className="text-slate-300">No enquiries yet.</p>
          {audience === "customer" && <Link className="mt-4 inline-block text-cyan-300 underline" to="/products">Browse parts</Link>}
        </section>
      ) : (
        <div className="space-y-4">
          {enquiries.map((enquiry) => (
            <article key={enquiry.id} className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{enquiry.productName || "Part enquiry"}</h2>
                  {enquiry.partNumber && <p className="text-xs text-slate-400">Part number: {enquiry.partNumber}</p>}
                </div>
                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs capitalize text-cyan-200">{enquiry.status}</span>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-400">Requested quantity</dt><dd>{enquiry.quantity}</dd></div>
                {audience === "customer" && <div><dt className="text-slate-400">Supplier</dt><dd>{enquiry.vendorBusinessName || "Approved supplier"}</dd></div>}
                {audience === "vendor" && enquiry.buyerEmail && <div><dt className="text-slate-400">Customer email (shared by customer)</dt><dd>{enquiry.buyerEmail}</dd></div>}
                <div><dt className="text-slate-400">Quote</dt><dd>{formatPrice(enquiry.quoteAmount)}</dd></div>
              </dl>
              <div className="mt-4 rounded-lg bg-slate-950/60 p-3 text-sm"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{audience === "vendor" ? "Customer request" : "Your request"}</p><p className="whitespace-pre-wrap">{enquiry.buyerMessage}</p></div>
              {audience === "customer" && enquiry.quoteMessage && <div className="mt-3 rounded-lg bg-slate-950/60 p-3 text-sm"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Supplier response</p><p className="whitespace-pre-wrap">{enquiry.quoteMessage}</p></div>}
              {audience === "vendor" && ["new", "quoted"].includes(enquiry.status) && (
                <form className="mt-4 grid gap-3 border-t border-slate-700 pt-4" onSubmit={(event) => submitQuote(event, enquiry)}>
                  <label className="grid gap-1 text-sm">Quote amount (INR)<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" type="number" min="0.01" step="0.01" required value={quoteDrafts[enquiry.id]?.amount ?? enquiry.quoteAmount ?? ""} onChange={(event) => updateQuote(enquiry.id, "amount", event.target.value)} /></label>
                  <label className="grid gap-1 text-sm">Quote details<textarea className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" rows="3" maxLength={2000} required value={quoteDrafts[enquiry.id]?.message ?? enquiry.quoteMessage ?? ""} onChange={(event) => updateQuote(enquiry.id, "message", event.target.value)} /></label>
                  <button className="w-fit rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60" type="submit" disabled={savingId === enquiry.id}>{savingId === enquiry.id ? "Sending quote..." : sentIds.includes(enquiry.id) ? "Send updated quote" : "Send quote"}</button>
                </form>
              )}
              {audience === "customer" && <Link className="mt-4 inline-block text-sm text-cyan-300 underline" to={`/products/${encodeURIComponent(enquiry.productId)}`}>View part details</Link>}
            </article>
          ))}
        </div>
      )}
      {!loading && hasMore && <button className="mt-6 rounded-lg border border-slate-600 px-4 py-2 text-sm disabled:opacity-60" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading..." : "Load more"}</button>}
    </main>
  );
}
