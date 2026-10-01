import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { useAuth } from "../context/useAuth";
import ProductCard from "../components/productcard";
import Stats from "../components/Stats";
import { Link } from "react-router-dom";

function ClutchPlateStage() {
  const [exploded, setExploded] = useState(false);

  return (
    <div
      className="parts-stage"
      style={{ "--open": exploded ? 1 : 0, "--explode": exploded ? "18px" : "0px" }}
    >
      <p className="parts-stage-label">CLUTCH PLATE SYSTEM <span> / 03</span></p>
      <div className="parts-selector-orbit" aria-hidden="true" />
      <div className="parts-assembly" aria-label="Exploded clutch plate assembly">
        <div className="parts-ring parts-ring-back" />
        <div className="parts-disc"><div className="parts-disc-inner">CP</div></div>
        <div className="parts-ring parts-ring-front" />
        <span className="parts-bolt parts-bolt-one" />
        <span className="parts-bolt parts-bolt-two" />
        <span className="parts-bolt parts-bolt-three" />
        <span className="parts-bolt parts-bolt-four" />
      </div>
      <div className="parts-stage-shadow" aria-hidden="true" />
      <button
        type="button"
        className="parts-hotspot parts-hotspot-one"
        onClick={() => setExploded((value) => !value)}
        aria-pressed={exploded}
      >
        <span>01</span>Pressure plate
      </button>
      <button
        type="button"
        className="parts-hotspot parts-hotspot-two"
        onClick={() => setExploded((value) => !value)}
        aria-pressed={exploded}
      >
        <span>02</span>{exploded ? "Collapse assembly" : "Friction disc"}
      </button>
    </div>
  );
}

function HomeIntro() {
  function handleHeroPointerMove(event) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    const stage = event.currentTarget.querySelector(".parts-stage");
    stage?.style.setProperty("--tilt-x", `${-y * 14}deg`);
    stage?.style.setProperty("--tilt-y", `${x * 18}deg`);
  }

  function resetHeroPointer(event) {
    const stage = event.currentTarget.querySelector(".parts-stage");
    stage?.style.setProperty("--tilt-x", "0deg");
    stage?.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <section className="parts-hero" onPointerMove={handleHeroPointerMove} onPointerLeave={resetHeroPointer}>
      <div className="parts-hero-grid" aria-hidden="true" />
      <div className="parts-hero-copy">
        <p className="parts-eyebrow">THE PARTS DEPOT / 01</p>
        <h1>Parts that keep India moving.</h1>
        <p className="parts-hero-description">
          Genuine truck components, matched to your machine and delivered without the guesswork.
        </p>
        <div className="parts-hero-actions">
          <Link to="/products" className="parts-primary-action"><span className="parts-primary-action-text">Browse parts</span><span className="parts-primary-action-arrow">↗</span></Link>
          <span className="parts-hero-note"><span className="parts-live-dot" /> Interactive catalogue</span>
        </div>
      </div>
      <ClutchPlateStage />
    </section>
  );
}

const demoProducts = [
  {
    id: "demo-engine-parts",
    name: "Brake System",
    title: "Brake System",
    category: "Engine Parts",
    partNumber: "BP-001",
    price: 1999,
    stock: 12,
    imageUrl: "https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?q=80&w=1200&auto=format&fit=crop",
    badge: "POPULAR",
    tags: ["bestseller"],
  },
  {
    id: "demo-clutch",
    name: "Clutch Plate",
    title: "Clutch Plate",
    category: "clutch",
    partNumber: "CP-1234",
    price: 5800,
    stock: 8,
    imageUrl: "https://images.unsplash.com/photo-1553440569-bcc63803a83d?q=80&w=1200&auto=format&fit=crop",
    badge: "POPULAR",
    tags: ["bestseller"],
  },
  {
    id: "demo-brakes",
    name: "Front Disc Brake Pad Set",
    title: "Front Disc Brake Pad Set",
    category: "Brakes",
    partNumber: "BP-002",
    price: 1999,
    stock: 10,
    imageUrl: "https://images.unsplash.com/photo-1489824904134-891ab64532f1?q=80&w=1200&auto=format&fit=crop",
    badge: "POPULAR",
    tags: ["bestseller"],
  },
  {
    id: "demo-suspension",
    name: "Suspension Kit",
    title: "Suspension Kit",
    category: "Suspension",
    partNumber: "SK-120",
    price: 2500,
    stock: 5,
    imageUrl: "https://images.unsplash.com/photo-1517524206127-48bbd363f3d7?q=80&w=1200&auto=format&fit=crop",
    badge: "POPULAR",
    tags: ["popular"],
  },
];

export default function Home() {
  const { isAdmin } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const revealItems = document.querySelectorAll(".reveal-on-scroll");
    if (!revealItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -30px 0px" }
    );

    revealItems.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [products.length]);

  const categories = ["All", ...new Set(products.map((product) => product.category).filter(Boolean))];
  const filteredProducts = products.filter((product) => {
    const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
    const searchableText = `${product.name || ""} ${product.title || ""} ${product.partNumber || ""}`.toLowerCase();
    return matchesCategory && searchableText.includes(searchQuery.toLowerCase());
  });

  function chooseCategory(category) {
    setSelectedCategory(category);
    setSearchQuery("");
    document.getElementById("featured-products")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const q = query(collection(db, "products"), limit(8));
        const querySnapshot = await getDocs(q);
        const productList = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setProducts(productList.length ? productList : demoProducts);
      } catch (error) {
        console.error("Error fetching featured products:", error);
        setProducts(demoProducts);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  return (
      <div className="min-h-screen bg-[#020514] text-white">
        <div className="reveal-on-scroll">
          <HomeIntro />
        </div>

        <section className="shop-by-system reveal-on-scroll" aria-label="Shop by vehicle system">
          <div className="shop-by-system-heading">
            <div>
              <p className="featured-eyebrow">SHOP BY SYSTEM / 02</p>
              <h2>Start with the part you need.</h2>
            </div>
            <span>Live catalogue</span>
          </div>
          <div className="shop-system-list">
            {categories.filter((category) => category !== "All").slice(0, 5).map((category, index) => (
              <button key={category} onClick={() => chooseCategory(category)} className="shop-system-item">
                <span className="shop-system-number">0{index + 1}</span>
                <span>{category}</span>
                <span className="shop-system-arrow">↗</span>
              </button>
            ))}
            {categories.length === 1 && <p className="shop-system-empty">Categories will appear as parts load.</p>}
          </div>
        </section>

        {isAdmin && <Stats />}

        <section className="featured-section reveal-on-scroll" id="featured-products">
          <div className="featured-heading">
            <div>
              <p className="featured-eyebrow">CURATED FOR THE ROAD / 02</p>
              <h2>Featured <span className="text-gradient">Products</span></h2>
              <p className="featured-subtitle">Dependable components selected for demanding journeys.</p>
            </div>
            <Link to="/products" className="featured-view-all">View all parts <span>↗</span></Link>
          </div>

          <div className="parts-finder" aria-label="Find a truck part">
            <div className="parts-finder-heading">
              <div>
                <p className="parts-finder-kicker">QUICK PART FINDER</p>
                <h3>What are you looking for?</h3>
              </div>
              <span className="parts-finder-count">{filteredProducts.length} available</span>
            </div>
            <div className="parts-finder-controls">
              <div className="parts-finder-tabs" role="tablist" aria-label="Filter by part category">
                {categories.map((category) => (
                  <button
                    key={category}
                    className={selectedCategory === category ? "is-active" : ""}
                    onClick={() => setSelectedCategory(category)}
                    role="tab"
                    aria-selected={selectedCategory === category}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <label className="parts-finder-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by part name or number"
                  aria-label="Search by part name or number"
                />
              </label>
            </div>
          </div>

          {loading ? (
            <div className="featured-empty reveal-on-scroll">Loading products...</div>
          ) : filteredProducts.length > 0 ? (
            <div className="featured-grid reveal-on-scroll">
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="featured-empty">
              No matching products found. Try another category or search term.
            </div>
          )}
        </section>
      </div>
  );
}