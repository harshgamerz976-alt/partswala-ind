import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { getMySupplierEnquiry, getMySupplierEnquiries, getVendorSupplierEnquiry, getVendorSupplierEnquiries, saveSupplierQuote } from "../services/enquiryService";
import { markNotificationRead } from "../services/notificationService";

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function SupplierEnquiries({ vendorMode = false }) {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const quoteRequestIdsRef = useRef(new Map());
  const handledNotificationIdsRef = useRef(new Set());
  const currentUserId = currentUser?.uid || "";
  const requestGenerationRef = useRef(0);
  const [enquiries, setEnquiries] = useState([]);
  const [dataUserId, setDataUserId] = useState("");
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [quoteDrafts, setQuoteDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [success, setSuccess] = useState("");
  const visibleEnquiries = dataUserId === currentUserId ? enquiries : [];

  const load = useCallback(async (nextCursor = "", generation = requestGenerationRef.current) => {
    if (generation !== requestGenerationRef.current) return;
    setError("");
    if (nextCursor) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = vendorMode
        ? await getVendorSupplierEnquiries(nextCursor)
        : await getMySupplierEnquiries(nextCursor);
      const requestedId = searchParams.get("enquiryId");
      const requestedEnquiry = requestedId && !nextCursor
        ? await (vendorMode ? getVendorSupplierEnquiry(requestedId) : getMySupplierEnquiry(requestedId)).catch(() => null)
        : null;
      if (generation !== requestGenerationRef.current) return;
      const listed = result.enquiries || [];
      const enquiriesWithTarget = requestedEnquiry && !listed.some(({ id }) => id === requestedEnquiry.id)
        ? [requestedEnquiry, ...listed]
        : listed;
      setEnquiries((previous) => nextCursor ? [...previous, ...enquiriesWithTarget] : enquiriesWithTarget);
      setDataUserId(currentUserId);
      setCursor(result.cursor || null);
      setHasMore(Boolean(result.hasMore));
    } catch (requestError) {
      if (generation === requestGenerationRef.current) setError(requestError.message || "Supplier enquiries could not be loaded.");
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [currentUserId, searchParams, vendorMode]);

  useEffect(() => {
    if (!currentUserId) {
      handledNotificationIdsRef.current.clear();
      return;
    }
    const notificationId = searchParams.get("notificationId");
    if (!notificationId || handledNotificationIdsRef.current.has(notificationId)) return;
    handledNotificationIdsRef.current.add(notificationId);
    markNotificationRead(notificationId).catch((requestError) => {
      console.warn("The opened notification could not be marked as read.", requestError?.message || requestError);
    });
  }, [currentUserId, searchParams]);

  useEffect(() => {
    const enquiryId = searchParams.get("enquiryId");
    if (!enquiryId || loading || dataUserId !== currentUserId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`supplier-enquiry-${enquiryId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentUserId, dataUserId, loading, searchParams, visibleEnquiries.length]);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    if (!currentUserId) {
      setEnquiries([]);
      setDataUserId("");
      setLoading(false);
      setError("");
      setQuoteDrafts({});
      quoteRequestIdsRef.current.clear();
      return () => {
        if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
      };
    }
    setEnquiries([]);
    setDataUserId("");
    setCursor(null);
    setHasMore(false);
    setLoading(true);
    setQuoteDrafts({});
    quoteRequestIdsRef.current.clear();
    setSuccess("");
    load("", generation);
    return () => {
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
    };
  }, [currentUserId, load]);

  async function submitQuote(event, enquiry) {
    event.preventDefault();
    const generation = requestGenerationRef.current;
    setSavingId(enquiry.id);
    setError("");
    setSuccess("");
    try {
      const draft = quoteDrafts[enquiry.id] || {};
      if (!quoteRequestIdsRef.current.has(enquiry.id)) {
        quoteRequestIdsRef.current.set(enquiry.id, window.crypto.randomUUID());
      }
      await saveSupplierQuote(enquiry.id, {
        amount: draft.amount,
        message: draft.message,
        requestId: quoteRequestIdsRef.current.get(enquiry.id),
      });
      quoteRequestIdsRef.current.delete(enquiry.id);
      if (generation !== requestGenerationRef.current) return;
      setEnquiries((previous) => previous.map((item) => item.id === enquiry.id
        ? { ...item, status: "quoted", quoteAmount: Number(draft.amount), quoteMessage: draft.message }
        : item));
      setSuccess("Quote saved. The buyer can view it in My Enquiries.");
    } catch (requestError) {
      if (generation === requestGenerationRef.current) setError(requestError.message || "Your quote could not be saved.");
    } finally {
      if (generation === requestGenerationRef.current) setSavingId("");
    }
  }

  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-400">{vendorMode ? "Vendor workspace" : "Buyer workspace"}</p>
          <h1 className="mt-2 text-3xl font-bold">{vendorMode ? "Supplier enquiries" : "My enquiries"}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{vendorMode ? "Review quote requests for your published products and reply with your price and terms." : "Track supplier replies and quotes for the parts you enquired about."}</p>
        </div>
        <Link to={vendorMode ? "/vendor" : "/products"} className="text-sm text-orange-300 hover:text-orange-200">{vendorMode ? "Vendor dashboard" : "Browse products"}</Link>
      </div>
      {!currentUser ? <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center"><p className="text-slate-300">Sign in to view enquiries.</p><Link to="/login" state={{ from: location }} className="mt-4 inline-flex rounded-md bg-orange-500 px-4 py-2 text-sm font-bold text-black">Sign in</Link></section>
        : loading ? <p role="status" className="text-sm text-slate-400">Loading enquiries...</p>
          : error && visibleEnquiries.length === 0 ? <section className="rounded-xl border border-red-900/60 bg-red-950/20 p-5"><p role="alert" className="text-sm text-red-300">{error}</p><button type="button" onClick={() => load("")} className="mt-3 text-sm text-orange-300">Try again</button></section>
            : <>
              {error && <p role="alert" className="mb-4 rounded-md border border-red-900/60 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
              {success && <p role="status" className="mb-4 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3 text-sm text-emerald-300">{success}</p>}
              {visibleEnquiries.length === 0 ? <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center"><h2 className="text-lg font-semibold">No enquiries yet</h2><p className="mt-2 text-sm text-slate-400">{vendorMode ? "New requests for your products will appear here." : "When you contact a supplier, the request and any quote will appear here."}</p></section>
                : <div className="grid gap-4">{visibleEnquiries.map((enquiry) => (
                  <article id={`supplier-enquiry-${enquiry.id}`} key={enquiry.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wider text-orange-400">{vendorMode ? "Quote request" : enquiry.vendorBusinessName || "Supplier"}</p>
                        <h2 className="mt-1 break-words text-lg font-semibold">{enquiry.productName || "Product listing"}</h2>
                        {enquiry.partNumber && <p className="mt-1 font-mono text-xs text-slate-400">Part number: {enquiry.partNumber}</p>}
                        {enquiry.sellingPrice > 0 && <p className="mt-1 text-sm text-slate-300">Selling price at enquiry: <strong className="text-white">₹{Number(enquiry.sellingPrice).toLocaleString("en-IN")}</strong></p>}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${enquiry.status === "quoted" ? "bg-emerald-900/50 text-emerald-300" : "bg-amber-900/40 text-amber-200"}`}>{enquiry.status === "quoted" ? "Quote received" : "Awaiting quote"}</span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-slate-500">Requested quantity</dt><dd className="mt-1 text-slate-200">{enquiry.quantity}</dd></div>
                      <div><dt className="text-xs text-slate-500">Received</dt><dd className="mt-1 text-slate-200">{dateLabel(enquiry.createdAt)}</dd></div>
                      {vendorMode && <div><dt className="text-xs text-slate-500">Buyer reply email</dt><dd className="mt-1 break-all text-slate-200">{enquiry.buyerEmail || "Not shared by buyer"}</dd></div>}
                    </dl>
                    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs font-semibold text-slate-400">{vendorMode ? "Buyer message" : "Your message"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{enquiry.buyerMessage}</p></div>
                    {!vendorMode && enquiry.status === "quoted" && <div className="mt-4 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Supplier total quote for {enquiry.quantity} requested units · INR</p><p className="mt-1 text-2xl font-bold text-white">₹{Number(enquiry.quoteAmount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-200">{enquiry.quoteMessage}</p></div>}
                    {vendorMode && <form className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4" onSubmit={(event) => submitQuote(event, enquiry)}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{enquiry.status === "quoted" ? "Update quote" : "Send quote"} · INR</p>
                      <label className="grid gap-1 text-xs text-slate-400">Total quote amount for this requested quantity (INR)<input required min="0.01" max="1000000000000" step="0.01" type="number" value={quoteDrafts[enquiry.id]?.amount ?? (enquiry.quoteAmount ?? "")} onChange={(event) => setQuoteDrafts((previous) => ({ ...previous, [enquiry.id]: { ...previous[enquiry.id], amount: event.target.value } }))} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /></label>
                      <label className="grid gap-1 text-xs text-slate-400">Quote details<input required maxLength="2000" value={quoteDrafts[enquiry.id]?.message ?? enquiry.quoteMessage ?? ""} onChange={(event) => setQuoteDrafts((previous) => ({ ...previous, [enquiry.id]: { ...previous[enquiry.id], message: event.target.value } }))} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" placeholder="Availability, validity, or other quote terms" /></label>
                      <button type="submit" disabled={savingId === enquiry.id} className="w-fit rounded-md bg-orange-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-60">{savingId === enquiry.id ? "Saving quote..." : enquiry.status === "quoted" ? "Update quote" : "Send quote"}</button>
                    </form>}
                  </article>
                ))}</div>}
              {hasMore && <button type="button" disabled={loadingMore} onClick={() => load(cursor)} className="mt-6 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 disabled:opacity-60">{loadingMore ? "Loading..." : "Load more enquiries"}</button>}
            </>}
    </main>
  );
}
