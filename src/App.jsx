import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Components
import Header from './components/Header';
import Footer from './components/Footer';
import AdminRoute from './components/AdminRoute';
import VendorRoute from './components/VendorRoute';
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

export default function App() {
  return (
      <div className="min-h-screen bg-[#020514] text-white flex flex-col font-sans">
          {/* Global Header Navigation Bar */}
          <Header />

          {/* Main Application Page Routes */}
          <main className="flex-grow">
            <Suspense fallback={<div className="min-h-[50vh] grid place-items-center text-sm text-slate-400">Loading PARTSWALA IND...</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/products" element={<Products />} />
              
              {/* 🛠️ Product Detail Routes (both singular and plural supported) */}
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

              {/* 🛡️ Secure Admin Route Panel */}
              <Route 
                path="/admin" 
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                } 
              />
              <Route path="/admin/login" element={<Login />} />

              {/* Fallback Route for non-existent pages */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </main>
          <Footer />
          <Suspense fallback={null}><AssistantWidget /></Suspense>
      </div>
  );
}