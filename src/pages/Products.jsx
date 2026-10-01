import { useState, useEffect } from "react";
import { getProductsPage } from "../services/productService";
import ProductCard from "../components/productcard";

export default function Products() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [compareItems, setCompareItems] = useState([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [compareMessage, setCompareMessage] = useState("");
  const [productsCursor, setProductsCursor] = useState(null);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMoreProducts() {
    if (!productsCursor || !hasMoreProducts || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getProductsPage(productsCursor);
      setProducts((previous) => [...previous, ...page.products]);
      setProductsCursor(page.cursor);
      setHasMoreProducts(page.hasMore);
    } catch (err) {
      console.error("More catalogue products could not be loaded:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadInitialProducts() {
    setLoading(true);
    try {
      const page = await getProductsPage();
      setProducts(page.products);
      setProductsCursor(page.cursor);
      setHasMoreProducts(page.hasMore);
    } catch (err) {
      console.error("Error fetching products for storefront:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialProducts();
  }, []);

  // 1. Dynamic category generation to ensure strict string matches
  const categories = ["All", ...new Set(products.map((p) => p.category).filter(Boolean))];

  // Search and category controls narrow the currently loaded catalogue pages.
  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    const matchesSearch = 
      `${p.name || ""} ${p.brand || ""} ${p.partNumber || ""}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  function resetFilters() {
    setSelectedCategory("All");
    setSearchQuery("");
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-400 text-sm font-medium">Loading heavy duty components...</p>
      </div>
    );
  }

  return (
    <div className="products-page min-h-screen bg-slate-950 text-slate-100 max-w-7xl mx-auto px-4 md:px-8 py-10">
      
      {/* Header Section */}
      <div className="products-page-header mb-8">
        <div>
          <p className="featured-eyebrow">THE COMPLETE DEPOT / 03</p>
          <h1 className="text-3xl font-black tracking-wide text-white">Truck parts catalogue</h1>
          <p className="text-slate-400 text-sm">Browse genuine commercial vehicle spares and OEM replacements.</p>
        </div>
        <div className="products-total"><strong>{filteredProducts.length}</strong><span>parts shown</span></div>
      </div>

      {/* Filter and Search controls bar */}
      <div className="products-toolbar grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80">
        <div className="md:col-span-2 flex flex-wrap gap-2 items-center">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase border transition-all ${
                selectedCategory === cat 
                  ? "bg-orange-500 text-white border-transparent shadow-lg shadow-orange-500/10" 
                  : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              {cat === "All" ? "🌐 All Spares" : cat}
            </button>
          ))}
        </div>
        
        <div className="products-search-wrap">
          <input
            type="text"
            placeholder="Search loaded parts by name, brand, or part number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:border-orange-500 focus:outline-none placeholder-slate-600"
          />
          {(searchQuery || selectedCategory !== "All") && (
            <button type="button" onClick={resetFilters} className="products-reset">Clear filters</button>
          )}
        </div>
      </div>

      {/* Grid Display Area */}
      {filteredProducts.length === 0 ? (
        <div className="text-center py-20 bg-slate-900 rounded-2xl border border-slate-800/60">
          <span className="text-4xl">📦</span>
          <h3 className="text-lg font-bold text-slate-300 mt-4">No matching truck parts found</h3>
          <p className="text-slate-500 text-sm mt-1">Try another category or reset your search.</p>
          <button type="button" onClick={resetFilters} className="products-reset products-reset-empty">Show all parts</button>
        </div>
      ) : (
        <div className="products-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} onCompare={toggleCompare} isCompared={compareItems.some((item) => item.id === product.id)} />
          ))}
        </div>
      )}

      {hasMoreProducts && <div className="flex justify-center py-8"><button type="button" onClick={loadMoreProducts} disabled={loadingMore} className="products-reset">{loadingMore ? "Loading parts..." : "Load more parts"}</button></div>}

      {compareItems.length > 0 && (
        <div className="compare-tray">
          <div><strong>Compare parts</strong><span>{compareItems.length}/3 selected</span></div>
          <div className="compare-tray-items">{compareItems.map((item) => <span key={item.id}>{item.name || item.title}<button type="button" onClick={() => toggleCompare(item)} aria-label={`Remove ${item.name || item.title}`}>×</button></span>)}</div>
          <button type="button" className="compare-open-button" disabled={compareItems.length < 2} onClick={() => setIsCompareOpen(true)}>Compare now <span>↗</span></button>
        </div>
      )}

      {compareMessage && <div className="compare-message" role="status">{compareMessage}</div>}

      {isCompareOpen && (
        <div className="compare-modal-backdrop" onClick={() => setIsCompareOpen(false)}>
          <section className="compare-modal" onClick={(event) => event.stopPropagation()}>
            <header><div><p className="featured-eyebrow">PART MATCH / 01</p><h2>Compare selected parts</h2></div><button type="button" onClick={() => setIsCompareOpen(false)} aria-label="Close comparison">×</button></header>
            <div className="compare-table">
              <div className="compare-label-column"><span>Part</span><span>Brand</span><span>Category</span><span>Part number</span><span>Selling price</span><span>MRP</span><span>Stock</span></div>
              {compareItems.map((item) => <div className="compare-product-column" key={item.id}><strong>{item.name || item.title}</strong><span>{item.brand || "Generic"}</span><span>{item.category || "Other"}</span><span>{item.partNumber || "Not listed"}</span><b>{money(item.price)}</b><span>{item.mrp ? money(item.mrp) : "Not listed"}</span><span className={Number(item.stock || 0) > 0 ? "compare-in-stock" : "compare-out-stock"}>{Number(item.stock || 0) > 0 ? `${item.stock} available` : "Out of stock"}</span><button type="button" onClick={() => toggleCompare(item)}>Remove</button></div>)}
            </div>
          </section>
        </div>
      )}

    </div>
  );
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}