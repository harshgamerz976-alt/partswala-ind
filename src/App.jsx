import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './context/useAuth';
import { getPublicSiteSettings } from './services/orderService';
import { shouldShowComingSoon } from '../shared/preLaunch.js';

// Components
import Header from './components/Header';
import Footer from './components/Footer';
import AdminRoute from './components/AdminRoute';
import VendorRoute from './components/VendorRoute';
import ComingSoonPage from './pages/ComingSoon';

const AssistantWidget = lazy(() => import('./ai/components/AssistantWidget'));
const Home = lazy(() => import('./pages/Home'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Profile = lazy(() => import('./pages/Profile'));
const Cart = lazy(() => import('./pages/Cart'));
const Login = lazy(() => import('./pages/Login'));
const AdminDashboard = lazy(() => import('./pages/Admin'));
const Register = lazy(() => import('./pages/Register'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderTracking = lazy(() => import('./pages/OrderTracking'));
const Checkout = lazy(() => import('./pages/Checkout'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const VendorLogin = lazy(() => import('./pages/VendorLogin'));
const SellParts = lazy(() => import('./pages/SellParts'));
const BulkUpload = lazy(() => import('./pages/BulkUpload'));

export default function App() {
  const { currentUser, isAdmin, loading: authLoading } = useAuth();
  const location = useLocation();
  const [publicSiteSettings, setPublicSiteSettings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPublicSiteSettings().then((settings) => {
      if (!cancelled) setPublicSiteSettings(settings);
    }).catch((error) => {
      console.error('Could not verify public site settings; showing Coming Soon to non-admin visitors.', error);
      if (!cancelled) setPublicSiteSettings({ preLaunchEnabled: null, comingSoonVideoUrl: '' });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentUser || !publicSiteSettings || shouldShowComingSoon(publicSiteSettings.preLaunchEnabled, isAdmin, import.meta.env.DEV)) return undefined;
    const trackRef = doc(db, 'presence', currentUser.uid);
    const writeHeartbeat = async () => {
      try {
        await setDoc(trackRef, {
          lastSeen: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn('Presence heartbeat skipped:', error?.message || error);
      }
    };

    const cleanupPresence = () => {
      void deleteDoc(trackRef).catch(() => {});
    };

    void writeHeartbeat();
    const intervalId = window.setInterval(() => {
      void writeHeartbeat();
    }, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void writeHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', cleanupPresence);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', cleanupPresence);
      cleanupPresence();
    };
  }, [currentUser, isAdmin, publicSiteSettings]);

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center bg-[#020514] text-sm text-slate-400">Checking PARTSWALA IND availability...</div>;
  }

  if (location.pathname === '/admin/login' && !isAdmin) {
    return <Suspense fallback={<div className="min-h-screen grid place-items-center bg-[#020514] text-sm text-slate-400">Loading admin sign-in...</div>}><Login /></Suspense>;
  }

  if (!publicSiteSettings) {
    return <div className="min-h-screen grid place-items-center bg-[#020514] text-sm text-slate-400">Checking PARTSWALA IND availability...</div>;
  }

  if (shouldShowComingSoon(publicSiteSettings.preLaunchEnabled, isAdmin, import.meta.env.DEV)) {
    return <ComingSoonPage videoUrl={publicSiteSettings.comingSoonVideoUrl} />;
  }

  return (
    <div className="min-h-screen bg-[#020514] text-white flex flex-col font-sans">
      <Header />

      <main className="flex-grow">
        <Suspense fallback={<div className="min-h-[50vh] grid place-items-center text-sm text-slate-400">Loading PARTSWALA IND...</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:id" element={<ProductDetail />} />
            <Route path="/product/:id" element={<ProductDetail />} />

            <Route path="/profile" element={<Profile />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/register" element={<Register />} />
            <Route path="/signup" element={<Register />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderTracking />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sell" element={<Navigate to="/vendor/login" replace />} />
            <Route path="/vendor/login" element={<VendorLogin />} />
            <Route path="/vendor" element={<VendorRoute><SellParts /></VendorRoute>} />
            <Route path="/vendor/dashboard" element={<VendorRoute><SellParts /></VendorRoute>} />
            <Route path="/vendor/import" element={<VendorRoute><BulkUpload /></VendorRoute>} />

            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route path="/admin/login" element={<Login />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <Suspense fallback={null}><AssistantWidget /></Suspense>
    </div>
  );
}