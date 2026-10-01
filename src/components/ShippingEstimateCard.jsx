import { Truck } from "lucide-react";
import { calculateShippingEstimate } from "../services/shippingService";

function weightLabel(value) {
  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0 ? `${weight.toFixed(2)} kg` : "—";
}

export default function ShippingEstimateCard({ weight, length, width, height }) {
  const estimate = calculateShippingEstimate({ weight, length, width, height });
  return (
    <div className="shipping-estimate-card">
      <div className="shipping-estimate-heading"><Truck size={16} /><strong>Shipping Estimate</strong></div>
      <div className="shipping-estimate-lines">
        <span>Actual Weight</span><strong>{weightLabel(estimate.actualWeight)}</strong>
        {estimate.hasDimensions && <><span>Volumetric Weight</span><strong>{weightLabel(estimate.volumetricWeight)}</strong></>}
        <span>Chargeable Weight</span><strong>{weightLabel(estimate.chargeableWeight)}</strong>
        <span>Estimated Shipping</span><strong>{estimate.amount == null ? estimate.message : `₹${estimate.amount.toFixed(2)}`}</strong>
      </div>
      <small>Courier pricing is calculated at checkout after the delivery pincode is validated.</small>
    </div>
  );
}
