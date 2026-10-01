import { useEffect, useState } from "react";
import { Camera, Check, ChevronRight, KeyRound, Loader2, LogOut, MapPin, Package, Plus, Save, Settings, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { getUserOrders } from "../services/orderService";
import { uploadImageToCloudinary } from "../services/cloudinaryService";
import { formatIndianPhoneForDisplay, normalizeIndianPhoneNumber } from "../../shared/phoneNumber.js";

const TABS = [
  { key: "overview", label: "Overview", icon: UserRound },
  { key: "orders", label: "Orders", icon: Package },
  { key: "addresses", label: "Addresses", icon: MapPin },
  { key: "settings", label: "Preferences", icon: Settings },
  { key: "security", label: "Security", icon: KeyRound },
];

function formatPrice(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function orderStatus(order) {
  return String(order.status || order.orderStatus || "pending").toLowerCase();
}

function normalizePhone(value) {
  return formatIndianPhoneForDisplay(value);
}

function phoneDigits(value) {
  return normalizeIndianPhoneNumber(value);
}

export default function Profile() {
  const { user, userProfile, updateUserProfileData, changeUserPassword, deleteAccount, logout, showToast, sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [bio, setBio] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [newAddress, setNewAddress] = useState({ label: "Home", street: "", city: "", state: "", zip: "" });
  const [settings, setSettings] = useState({ emailNotifications: true, orderUpdates: true, promotionalOffers: false });
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);

  useEffect(() => {
    setFullName(userProfile?.fullName || userProfile?.displayName || user?.displayName || "");
    setPhone(normalizePhone(userProfile?.phone || ""));
    setGstNumber(userProfile?.gstNumber || "");
    setBio(userProfile?.bio || "");
    setPhotoURL(userProfile?.photoURL || user?.photoURL || "");
    setAddresses(userProfile?.addresses || []);
    setSettings((previous) => ({ ...previous, ...(userProfile?.settings || {}) }));
  }, [userProfile, user]);

  useEffect(() => {
    if (activeTab !== "orders" || orders.length > 0) return;
    setOrdersLoading(true);
    getUserOrders().then(setOrders).catch(() => setOrders([])).finally(() => setOrdersLoading(false));
  }, [activeTab, orders.length]);

  function setFeedback(text, type = "success") {
    setMessage(text);
    setMessageType(type);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const normalizedPhone = normalizePhone(phone);
    if (phoneDigits(normalizedPhone).length !== 10) {
      setFeedback("Enter a valid 10-digit Indian mobile number.", "error");
      return;
    }
    setSaving(true);
    try {
      // phoneVerified is owned by the backend (set after Firebase Phone Auth confirmation).
      await updateUserProfileData({ fullName, displayName: fullName, phone: normalizedPhone, gstNumber, bio, photoURL });
      setPhone(normalizedPhone);
      setOtpSent(false);
      setFeedback("Profile details saved.");
      showToast?.("Profile updated", "success");
    } catch (error) {
      setFeedback(error.message || "Could not save profile details.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function requestPhoneOtp() {
    const normalizedPhone = normalizePhone(phone);
    if (phoneDigits(normalizedPhone).length !== 10) {
      setFeedback("Enter a valid 10-digit Indian mobile number first.", "error");
      return;
    }
    setOtpLoading(true);
    try {
      await sendPhoneOtp(normalizedPhone.replace(/\s/g, ""));
      setOtpSent(true);
      setFeedback("Verification code sent to your phone.");
    } catch (error) {
      setFeedback(error.message || "Could not send the verification code.", "error");
    } finally {
      setOtpLoading(false);
    }
  }

  async function confirmPhoneOtp() {
    setOtpLoading(true);
    try {
      await verifyPhoneOtp(otp.trim(), normalizePhone(phone));
      setOtp("");
      setOtpSent(false);
      setFeedback("Phone number verified.");
    } catch (error) {
      setFeedback(error.message || "That code is invalid or expired. Please try again.", "error");
    } finally {
      setOtpLoading(false);
    }
  }

  async function uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const url = await uploadImageToCloudinary(file, "profile");
      setPhotoURL(url);
      await updateUserProfileData({ photoURL: url });
      setFeedback("Profile photo updated.");
    } catch (error) {
      setFeedback(error.message || "Could not upload that photo.", "error");
    } finally {
      setUploading(false);
    }
  }

  async function addAddress(event) {
    event.preventDefault();
    if (!newAddress.street || !newAddress.city || !newAddress.zip) {
      setFeedback("Street, city, and PIN code are required.", "error");
      return;
    }
    const updated = [...addresses, { ...newAddress, id: Date.now().toString() }];
    try {
      await updateUserProfileData({ addresses: updated });
      setAddresses(updated);
      setNewAddress({ label: "Home", street: "", city: "", state: "", zip: "" });
      setShowAddressForm(false);
      setFeedback("Address saved.");
    } catch {
      setFeedback("Could not save the address.", "error");
    }
  }

  async function removeAddress(id) {
    const updated = addresses.filter((address) => address.id !== id);
    await updateUserProfileData({ addresses: updated });
    setAddresses(updated);
    setFeedback("Address removed.");
  }

  async function toggleSetting(key) {
    const updatedSettings = { ...settings, [key]: !settings[key] };
    setSettings(updatedSettings);
    await updateUserProfileData({ settings: updatedSettings });
    showToast?.("Preference updated", "success");
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (newPassword.length < 6) {
      setFeedback("Password must be at least 6 characters.", "error");
      return;
    }
    setPasswordLoading(true);
    try {
      await changeUserPassword(newPassword);
      setNewPassword("");
      setFeedback("Password updated successfully.");
    } catch {
      setFeedback("For security, sign in again before changing your password.", "error");
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  async function handleDeleteAccount() {
    if (!window.confirm("Delete your account permanently? This cannot be undone.")) return;
    try {
      await deleteAccount();
      navigate("/");
    } catch {
      setFeedback("Please sign in again before deleting your account.", "error");
    }
  }

  const initials = (fullName || user?.email || "U").charAt(0).toUpperCase();
  return (
    <main className="profile-page">
      <header className="profile-header">
        <div><p className="profile-kicker">ACCOUNT CENTRE / 05</p><h1>Your depot.</h1><p>Keep your details, deliveries, and account preferences in one place.</p></div>
        <button type="button" onClick={handleLogout} className="profile-logout"><LogOut size={15} /> Log out</button>
      </header>

      <div className="profile-layout">
        <aside className="profile-sidebar">
          <div className="profile-identity">
            <div className="profile-avatar">{photoURL ? <img src={photoURL} alt="Profile" /> : initials}<label><Camera size={14} /><input type="file" accept="image/*" onChange={uploadAvatar} disabled={uploading} /></label></div>
            <strong>{fullName || "Your name"}</strong><span>{user?.email}</span>
          </div>
          <nav className="profile-tabs" aria-label="Account sections">{TABS.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => { setActiveTab(key); setMessage(""); }} className={activeTab === key ? "is-active" : ""}><Icon size={16} />{label}<ChevronRight size={14} /></button>)}</nav>
          <div className="profile-sidebar-footer"><ShieldAlert size={14} /> Account secured by PARTSWALA</div>
        </aside>

        <section className="profile-content">
          {message && <div className={`profile-feedback ${messageType === "error" ? "is-error" : ""}`}>{message}</div>}
          {activeTab === "overview" && <>
            <div className="profile-content-heading"><div><p className="profile-kicker">PROFILE OVERVIEW</p><h2>Personal details</h2></div><span className="profile-live"><i /> Account active</span></div>
            <form onSubmit={saveProfile} className="profile-form-panel">
              <div className="profile-form-grid"><label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label><label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 9876543210" inputMode="tel" /></label><label>GST number <em>optional</em><input value={gstNumber} onChange={(event) => setGstNumber(event.target.value)} placeholder="GSTIN" /></label><label>Email address<input value={user?.email || ""} disabled /></label></div>
              <div id="phone-recaptcha" className="phone-recaptcha" />
              <div className="profile-phone-verification">{userProfile?.phoneVerified && normalizePhone(userProfile.verifiedPhone) === normalizePhone(phone) ? <span className="profile-phone-verified"><Check size={14} /> Phone verified</span> : <><span>Verify your phone to speed up checkout.</span>{!otpSent ? <button type="button" onClick={requestPhoneOtp} disabled={otpLoading}>{otpLoading ? "Sending..." : "Send OTP"}</button> : <div className="profile-otp-entry"><input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit OTP" inputMode="numeric" /><button type="button" onClick={confirmPhoneOtp} disabled={otpLoading || otp.length < 6}>{otpLoading ? "Checking..." : "Verify"}</button></div>}</>}</div>
              <label>Workshop notes<textarea value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Tell us about your vehicle or workshop" rows="4" /></label>
              <button type="submit" disabled={saving} className="profile-primary-button">{saving ? <Loader2 size={16} /> : <Save size={16} />} {saving ? "Saving..." : "Save profile"}</button>
            </form>
            <div className="profile-quick-grid"><button onClick={() => setActiveTab("orders")}><Package size={18} /><span><strong>{orders.length || "View"}</strong> orders</span><ChevronRight size={15} /></button><button onClick={() => setActiveTab("addresses")}><MapPin size={18} /><span><strong>{addresses.length}</strong> saved addresses</span><ChevronRight size={15} /></button></div>
          </>}

          {activeTab === "orders" && <><div className="profile-content-heading"><div><p className="profile-kicker">ORDER ACTIVITY</p><h2>Your orders</h2></div><Link to="/orders" className="profile-text-link">Open full history ↗</Link></div>{ordersLoading ? <div className="profile-loading"><Loader2 size={20} /> Loading order activity...</div> : orders.length === 0 ? <div className="profile-empty"><Package size={34} /><strong>No orders yet</strong><Link to="/products">Browse parts ↗</Link></div> : <div className="profile-order-list">{orders.slice(0, 6).map((order) => <Link to={`/orders/${order.id}`} className="profile-order-row" key={order.id}><div><span>#{order.id.slice(0, 8).toUpperCase()}</span><strong>{order.items?.[0]?.name || "Truck component order"}</strong><small>{new Date(order.createdAt).toLocaleDateString("en-IN")}</small></div><div><b>{formatPrice(order.totalAmount ?? order.total)}</b><em className={`profile-order-status ${orderStatus(order)}`}>{orderStatus(order)}</em></div><ChevronRight size={15} /></Link>)}</div>}</>}

          {activeTab === "addresses" && <><div className="profile-content-heading"><div><p className="profile-kicker">DELIVERY BOOK</p><h2>Saved addresses</h2></div><button onClick={() => setShowAddressForm(!showAddressForm)} className="profile-secondary-button"><Plus size={15} /> Add address</button></div>{showAddressForm && <form onSubmit={addAddress} className="profile-address-form"><div className="profile-form-grid"><label>Label<input value={newAddress.label} onChange={(event) => setNewAddress({ ...newAddress, label: event.target.value })} placeholder="Home" /></label><label>PIN code<input required value={newAddress.zip} onChange={(event) => setNewAddress({ ...newAddress, zip: event.target.value })} placeholder="110001" /></label></div><label>Street address<input required value={newAddress.street} onChange={(event) => setNewAddress({ ...newAddress, street: event.target.value })} placeholder="House, street, area" /></label><div className="profile-form-grid"><label>City<input required value={newAddress.city} onChange={(event) => setNewAddress({ ...newAddress, city: event.target.value })} placeholder="City" /></label><label>State<input value={newAddress.state} onChange={(event) => setNewAddress({ ...newAddress, state: event.target.value })} placeholder="State" /></label></div><button type="submit" className="profile-primary-button">Save address</button></form>}{addresses.length === 0 ? <div className="profile-empty"><MapPin size={34} /><strong>No saved addresses</strong><span>Add one for a faster checkout.</span></div> : <div className="profile-address-grid">{addresses.map((address) => <article key={address.id}><span>{address.label || "Address"}</span><strong>{address.street}</strong><p>{address.city}, {address.state} {address.zip}</p><button onClick={() => removeAddress(address.id)}><Trash2 size={14} /> Remove</button></article>)}</div>}</>}

          {activeTab === "settings" && <><div className="profile-content-heading"><div><p className="profile-kicker">ACCOUNT PREFERENCES</p><h2>Stay in the loop.</h2></div></div><div className="profile-settings">{[["emailNotifications", "Email notifications", "Account activity and important updates"], ["orderUpdates", "Order status updates", "Know when your parts ship and arrive"], ["promotionalOffers", "Promotional offers", "Part deals and seasonal savings"]].map(([key, title, description]) => <button key={key} onClick={() => toggleSetting(key)}><span><strong>{title}</strong><small>{description}</small></span><i className={settings[key] ? "is-on" : ""}><b /></i></button>)}</div></>}

          {activeTab === "security" && <><div className="profile-content-heading"><div><p className="profile-kicker">ACCOUNT SECURITY</p><h2>Keep access protected.</h2></div></div><form onSubmit={updatePassword} className="profile-security-panel"><label>New password<input required minLength="6" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 6 characters" /></label><button type="submit" disabled={passwordLoading} className="profile-primary-button">{passwordLoading ? <Loader2 size={16} /> : <KeyRound size={16} />} Update password</button></form><div className="profile-danger-panel"><div><strong>Danger zone</strong><span>Log out of this device or permanently delete your account.</span></div><div><button onClick={handleLogout} className="profile-secondary-button"><LogOut size={14} /> Log out</button><button onClick={handleDeleteAccount} className="profile-danger-button"><Trash2 size={14} /> Delete account</button></div></div></>}
        </section>
      </div>
    </main>
  );
}
