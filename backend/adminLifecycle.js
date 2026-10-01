import { normalizeLifecycleStatus } from "./lifecycle.js";

export function adminLifecycleOverrideProblem(status) {
  const normalized = normalizeLifecycleStatus(status);
  const workflowOnly = {
    shipped: ["SHIPPING_EVIDENCE_REQUIRED", "Shipment status is controlled by verified Shiprocket tracking evidence."],
    in_transit: ["SHIPPING_EVIDENCE_REQUIRED", "Shipment status is controlled by verified Shiprocket tracking evidence."],
    out_for_delivery: ["SHIPPING_EVIDENCE_REQUIRED", "Shipment status is controlled by verified Shiprocket tracking evidence."],
    delivered: ["DELIVERY_EVIDENCE_REQUIRED", "Delivery status is controlled by verified Shiprocket tracking evidence."],
    return_window: ["DELIVERY_EVIDENCE_REQUIRED", "Return-window status is controlled by verified delivery and return-policy dates."],
    completed: ["DELIVERY_EVIDENCE_REQUIRED", "Order completion is controlled by verified delivery and return-policy dates."],
    settled: ["SETTLEMENT_WORKFLOW_REQUIRED", "Order settlement status can only change through the payout reconciliation workflow."],
    return_requested: ["RETURN_WORKFLOW_REQUIRED", "Return status is controlled by the return-review workflow."],
    return_approved: ["RETURN_WORKFLOW_REQUIRED", "Return status is controlled by the return-review workflow."],
    return_rejected: ["RETURN_WORKFLOW_REQUIRED", "Return status is controlled by the return-review workflow."],
    refunded: ["REFUND_WORKFLOW_REQUIRED", "Refund status is controlled by the refund reconciliation workflow."],
    rto: ["SHIPPING_EVIDENCE_REQUIRED", "Return-to-origin status is controlled by verified Shiprocket tracking evidence."],
    rto_completed: ["SHIPPING_EVIDENCE_REQUIRED", "Return-to-origin status is controlled by verified Shiprocket tracking evidence."],
    partially_rto: ["SHIPPING_EVIDENCE_REQUIRED", "Return-to-origin status is controlled by verified Shiprocket tracking evidence."],
    partially_delivered: ["SHIPPING_EVIDENCE_REQUIRED", "Delivery status is controlled by verified Shiprocket tracking evidence."],
  }[normalized];
  if (workflowOnly) return { status: 409, code: workflowOnly[0], message: workflowOnly[1] };
  return null;
}