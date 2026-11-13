import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductCard from "../components/productcard";
import "./Products.css";
import { filterProducts, getProductsPage } from "../services/productService";
import { createCatalogRequestVersion } from "../services/catalogRequestVersion";
import {
  normalizeCatalogFilters,
  parseCatalogFilters,
  serializeCatalogFilters,
} from "../services/productCatalog";

const PAGE_SIZE = 20;

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = searchParams.toString();
  const filters = useMemo(() => {
    return normalizeCatalogFilters(parseCatalogFilters(queryString));
  }, [queryString]);
  const filterKey = serializeCatalogFilters(filters);
  const requestFiltersKey = serializeCatalogFilters({ ...filters, sortBy: "newest" });
  const requestFilters = useMemo(() => parseCatalogFilters(requestFiltersKey), [requestFiltersKey]);
  const isCanonicalQuery = queryString === filterKey;
  const [draftFilters, setDraftFilters] = useState(filters);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [compareItems, setCompareItems] = useState([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [compareMessage, setCompareMessage] = useState("");
  const cursorRef = useRef(null);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const requestVersionRef = useRef(null);
  if (!requestVersionRef.current) requestVersionRef.current = createCatalogRequestVersion();
  const pageRequestControllerRef = useRef(null);
  const loadMoreRequestControllerRef = useRef(null);
  const filtersRef = useRef(filters);
  const compareDialogRef = useRef(null);
  const closeCompareRef = useRef(null);
  const compareTriggerRef = useRef(null);
  filtersRef.current = filters;

  useEffect(() => {
    setDraftFilters(filters);
  }, [filterKey, filters]);

  useEffect(() => {
    if (isCanonicalQuery) return;
    setSearchParams(filterKey, { replace: true });
  }, [filterKey, isCanonicalQuery, setSearchParams]);

  useEffect(() => {
    if (!isCanonicalQuery) return undefined;

    const requestVersion = requestVersionRef.current.begin();
    const controller = new AbortController();
    pageRequestControllerRef.current = controller;
    loadMoreRequestControllerRef.current?.abort();
    loadMoreRequestControllerRef.current = null;
    cursorRef.current = null;
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    setProducts([]);
    setLoading(true);
    setError("");
    setLoadMoreError("");
    setHasMoreProducts(false);
    setLoadingMore(false);

    getProductsPage(null, PAGE_SIZE, requestFilters, { signal: controller.signal })
      .then((page) => {
        if (!requestVersionRef.current.isCurrent(requestVersion)) return;
        setProducts(page.products);
        cursorRef.current = page.cursor;
        hasMoreRef.current = page.hasMore;
        setHasMoreProducts(page.hasMore);
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") return;
        console.error("Error fetching products for storefront:", fetchError);
        if (requestVersionRef.current.isCurrent(requestVersion)) setError("Products could not be loaded. Please try again.");
      })
      .finally(() => {
        if (requestVersionRef.current.isCurrent(requestVersion)) setLoading(false);
      });

    return () => {
      controller.abort();
      loadMoreRequestControllerRef.current?.abort();
      if (pageRequestControllerRef.current === controller) pageRequestControllerRef.current = null;
      requestVersionRef.current.invalidate(requestVersion);
    };
  }, [isCanonicalQuery, requestFilters, requestFiltersKey]);

  useEffect(() => {
    if (!isCompareOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeCompareRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsCompareOpen(false);
      if (event.key !== "Tab") return;
      const dialog = compareDialogRef.current;
      const focusableItems = dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusableItems?.length) return;
      const firstItem = focusableItems[0];
      const lastItem = focusableItems[focusableItems.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        firstItem.focus();
      } else if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      compareTriggerRef.current?.focus();
    };
  }, [isCompareOpen]);

  const filteredProducts = useMemo(() => filterProducts(products, filters), [products, filters]);

  function loadMoreProducts() {
    if (!cursorRef.current || !hasMoreRef.current || loadingMoreRef.current) return;
    const requestVersion = requestVersionRef.current.current();
    const cursor = cursorRef.current;
    const requestFilters = filtersRef.current;
    const controller = new AbortController();
    loadMoreRequestControllerRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError("");

    getProductsPage(cursor, PAGE_SIZE, requestFilters, { signal: controller.signal })
      .then((page) => {
        if (!requestVersionRef.current.isCurrent(requestVersion)) return;
        setProducts((previous) => {
          const existingIds = new Set(previous.map((product) => product.id));
          return [...previous, ...page.products.filter((product) => !existingIds.has(product.id))];
        });
        cursorRef.current = page.cursor;
        hasMoreRef.current = page.hasMore;
        setHasMoreProducts(page.hasMore);
      })
      .catch((fetchError) => {
        if (fetchError.name === "AbortError") return;
        console.error("More catalogue products could not be loaded:", fetchError);
        if (requestVersionRef.current.isCurrent(requestVersion)) setLoadMoreError("More products could not be loaded. Please try again.");
      })
      .finally(() => {
        if (requestVersionRef.current.isCurrent(requestVersion)) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
          if (loadMoreRequestControllerRef.current === controller) loadMoreRequestControllerRef.current = null;
        }
      });
  }

  function applyFilters(event) {
    event.preventDefault();
    setSearchParams(serializeCatalogFilters(draftFilters));
  }

  function clearSearch() {
    setSearchParams(serializeCatalogFilters({ ...draftFilters, search: "" }));
  }

  function toggleCompare(product) {
    setCompareMessage("");
    setCompareItems((previous) => {
      if (previous.some((item) => item.id === product.id)) return previous.filter((item) => item.id !== product.id);
      if (previous.length >= 3) {
        setCompareMessage("Compare up to 3 parts at a time.");
        return previous;
      }
      return [...previous, product];
    });
  }

  function openCompare() {
    compareTriggerRef.current = document.activeElement;
    setIsCompareOpen(true);
  }

  const searchActive = Boolean(filters.search);

  return (
    <div className="products-page min-h-screen bg-slate-950 text-slate-100 max-w-7xl mx-auto px-4 md:px-8 py-10">
      <div className="products-page-header mb-8">
        <div>
          <p className="featured-eyebrow">THE COMPLETE DEPOT / 03</p>
          <h1 className="text-3xl font-black tracking-wide text-white">Truck parts catalogue</h1>
          <p className="text-slate-400 text-sm">Search and browse every eligible listing in the live product catalogue.</p>
        </div>
        <div className="products-total"><strong>{filteredProducts.length}</strong><span>matching parts loaded</span></div>
      </div>
      <form className="products-toolbar mb-8 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80" onSubmit={applyFilters}>
          <label className="catalog-field md:col-span-2">
            <span>Search all parts by name, brand, part number, or compatibility</span>
            <input type="search" value={draftFilters.search} onChange={(event) => setDraftFilters((previous) => ({ ...previous, search: event.target.value }))} maxLength={120} />
          </label>
          <label className="catalog-field">
            <span>Category</span>
            <input type="search" value={draftFilters.category} onChange={(event) => setDraftFilters((previous) => ({ ...previous, category: event.target.value }))} maxLength={120} />
          </label>
          <label className="catalog-field">
            <span>Compatibility</span>
            <input type="search" value={draftFilters.compatibility} onChange={(event) => setDraftFilters((previous) => ({ ...previous, compatibility: event.target.value }))} maxLength={120} />
          </label>
          <label className="catalog-field">
            <span>Availability</span>
            <select value={draftFilters.stockStatus} onChange={(event) => setDraftFilters((previous) => ({ ...previous, stockStatus: event.target.value }))}>
              <option value="all">Any availability</option>
              <option value="in-stock">In stock</option>
              <option value="out-of-stock">Out of stock</option>
              <option value="unknown">Availability not listed</option>
            </select>
          </label>
          <label className="catalog-field">
            <span>Sort loaded matches</span>
            <select value={draftFilters.sortBy} onChange={(event) => setDraftFilters((previous) => ({ ...previous, sortBy: event.target.value }))}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="discount">Verified discount: high to low</option>
            </select>
          </label>
          <div className="catalog-filter-actions md:col-span-3">
            <button type="submit" className="products-reset">Search catalogue</button>
            {searchActive && <button type="button" onClick={clearSearch} className="products-reset products-reset-secondary">Clear search</button>}
          </div>
          <p className="catalog-filter-note md:col-span-3">
            Search checks eligible listings across the catalogue. Results load in pages; sorting and the count apply to loaded matches.
          </p>
      </form>

      {loading ? (
        <div role="status" className="text-center py-20 text-slate-400">Loading eligible product listings…</div>
      ) : error ? (
        <div className="featured-empty" role="alert">{error}</div>
      ) : filteredProducts.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 rounded-2xl border border-slate-800/60">
          <h2 className="text-lg font-bold text-slate-300">No matching parts found</h2>
          <p className="text-slate-500 text-sm mt-2">
            {hasMoreProducts ? "More catalogue results are available; continue loading to browse." : "No eligible listing matched this search."}
          </p>
          {searchActive && <button type="button" onClick={clearSearch} className="products-reset products-reset-empty">Clear search</button>}
        </div>
      ) : (
        <div className="products-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} onCompare={toggleCompare} isCompared={compareItems.some((item) => item.id === product.id)} />
          ))}
        </div>
      )}

      {loadMoreError && <p className="catalog-load-error" role="alert">{loadMoreError}</p>}
      {hasMoreProducts && <div className="flex justify-center py-8"><button type="button" onClick={loadMoreProducts} disabled={loading || loadingMore} className="products-reset">{loadingMore ? "Loading parts…" : "Load more catalogue results"}</button></div>}

      {compareItems.length > 0 && (
        <div className="compare-tray">
          <div><strong>Compare parts</strong><span>{compareItems.length}/3 selected</span></div>
          <div className="compare-tray-items">{compareItems.map((item) => <span key={item.id}>{item.name || item.title}<button type="button" onClick={() => toggleCompare(item)} aria-label={`Remove ${item.name || item.title} from comparison`}>×</button></span>)}</div>
          <button ref={compareTriggerRef} type="button" className="compare-open-button" disabled={compareItems.length < 2} onClick={openCompare}>Compare now <span>↗</span></button>
        </div>
      )}

      {compareMessage && <div className="compare-message" role="status">{compareMessage}</div>}

      {isCompareOpen && (
        <div className="compare-modal-backdrop" onClick={() => setIsCompareOpen(false)}>
          <section ref={compareDialogRef} className="compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title" onClick={(event) => event.stopPropagation()}>
            <header><div><p className="featured-eyebrow">PART MATCH / 01</p><h2 id="compare-title">Compare selected parts</h2></div><button ref={closeCompareRef} type="button" onClick={() => setIsCompareOpen(false)} aria-label="Close comparison">×</button></header>
            <div className="compare-table">
              <div className="compare-label-column"><span>Part</span><span>Brand</span><span>Category</span><span>Part number</span><span>Selling price</span><span>MRP</span><span>Stock</span></div>
              {compareItems.map((item) => <div className="compare-product-column" key={item.id}><strong>{item.name || item.title}</strong><span>{item.brand || "Not listed"}</span><span>{item.category || "Not listed"}</span><span>{item.partNumber || "Not listed"}</span><b>{money(item.price)}</b><span>{item.mrp == null ? "Not listed" : money(item.mrp)}</span><span className={item.stock > 0 ? "compare-in-stock" : item.stock === 0 ? "compare-out-stock" : ""}>{item.stock == null ? "Not listed" : item.stock > 0 ? `${item.stock} available` : "Out of stock"}</span><button type="button" onClick={() => toggleCompare(item)}>Remove</button></div>)}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? `₹${value.toLocaleString("en-IN")}` : "Not listed";
}
