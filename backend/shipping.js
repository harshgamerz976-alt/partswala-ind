const quoteCache = new Map();
const quoteInFlight = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_LIMIT = 256;
const REQUEST_TIMEOUT_MS = 8000;

function shippingError(message) {
  const error = new Error(message);
  error.code = "SHIPPING_UNAVAILABLE";
  return error;
}

function quoteAmount(company) {
  const rate = Number(company.rate);
  if (Number.isFinite(rate) && rate > 0) return Number(rate.toFixed(2));
  const freight = Number(company.freight_charge);
  const cod = Number(company.cod_charges || 0);
  const other = Number(company.other_charges || 0);
  const total = freight + cod + other;
  return Number.isFinite(total) && total > 0 ? Number(total.toFixed(2)) : null;
}

export async function getShiprocketShippingQuote({
  baseUrl,
  token,
  pickupPincode,
  deliveryPincode,
  chargeableWeight,
  cod,
  orderValue,
  pickupLocationId = "",
  dimensions = {},
  service = "",
  fetchImpl = fetch,
  now = Date.now,
}) {
  if (!/^\d{6}$/.test(String(pickupPincode || ""))) throw shippingError("Pickup pincode is missing or invalid for this shipment.");
  if (!/^\d{6}$/.test(String(deliveryPincode || ""))) throw shippingError("Enter a valid 6-digit delivery pincode to calculate shipping.");
  const weight = Number(chargeableWeight);
  if (!Number.isFinite(weight) || weight <= 0) throw shippingError("A valid shipment weight is required to calculate shipping.");
  if (!token) throw shippingError("Shipping provider authentication is unavailable.");

  const key = JSON.stringify([pickupLocationId, pickupPincode, deliveryPincode, weight, dimensions, Boolean(cod), Number(orderValue || 0), service]);
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > now()) return { ...cached.quote };
  if (quoteInFlight.has(key)) return { ...(await quoteInFlight.get(key)) };

  const request = (async () => {
    const query = new URLSearchParams({
      pickup_postcode: String(pickupPincode),
      delivery_postcode: String(deliveryPincode),
      weight: String(weight),
      cod: cod ? "1" : "0",
      declared_value: String(Math.max(0, Number(orderValue) || 0)),
    });
    let response;
    try {
      response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/courier/serviceability/?${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw shippingError(error?.name === "TimeoutError" ? "Shipping quote timed out. Try again." : "Shipping provider could not be reached. Try again.");
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw shippingError(result.message || `Shipping provider returned ${response.status}.`);
    const data = result.data || result.response?.data || result;
    const couriers = data.available_courier_companies || data.courier_companies || [];
    if (!Array.isArray(couriers) || couriers.length === 0) {
      throw shippingError(data.message || "No courier service is available for this destination.");
    }

    const options = couriers.map((company) => ({
      amount: quoteAmount(company),
      courierName: String(company.courier_name || company.courier_company || ""),
      rateId: String(company.courier_company_id || ""),
      estimatedDeliveryDays: Number(company.estimated_delivery_days || company.etd || 0) || null,
    })).filter((company) => company.amount != null);
    if (!options.length) throw shippingError("The courier did not return a valid shipping rate.");
    options.sort((left, right) => left.amount - right.amount);
    const selected = options[0];
    const quote = {
      ...selected,
      amount: selected.amount,
      provider: "shiprocket",
      isEstimate: true,
      available: true,
      quotedAt: new Date(now()).toISOString(),
      pickupPincode: String(pickupPincode),
      deliveryPincode: String(deliveryPincode),
      chargeableWeight: weight,
    };
    if (quoteCache.size >= CACHE_LIMIT) quoteCache.delete(quoteCache.keys().next().value);
    quoteCache.set(key, { quote, expiresAt: now() + CACHE_TTL_MS });
    return quote;
  })();

  quoteInFlight.set(key, request);
  try {
    return { ...(await request) };
  } finally {
    quoteInFlight.delete(key);
  }
}

export function clearShippingQuoteCache() {
  quoteCache.clear();
  quoteInFlight.clear();
}
