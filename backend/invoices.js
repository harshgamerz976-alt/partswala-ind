import { createHash } from "node:crypto";

function amount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new Error("Invoice snapshot values must be finite.");
  return Number(number.toFixed(2));
}

export function buildSellerInvoiceSnapshots(orderId, invoiceDate, seller, items) {
  const groups = new Map();
  for (const item of items || []) {
    const sellerType = item.sellerType === "vendor" ? "vendor" : "partswala";
    const sellerId = String(item.sellerId || "partswala");
    const key = `${sellerType}:${sellerId}`;
    const group = groups.get(key) || { key, sellerType, sellerId, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const invoiceNumber = `${orderId}-S-${createHash("sha256").update(group.key).digest("hex").slice(0, 10).toUpperCase()}`;
    const lines = group.items.map((item) => ({
      productId: String(item.productId),
      name: item.name || item.productName || "Product",
      quantity: Number(item.quantity || 0),
      unitPrice: amount(item.unitPrice ?? item.price),
      mrp: amount(item.mrp),
      discount: amount(item.discount),
      taxableValue: amount(item.taxableValue ?? item.sellerSubtotal),
      gstRate: amount(item.gstRate),
      cgst: amount(item.cgst),
      sgst: amount(item.sgst),
      igst: amount(item.igst),
      taxAmount: amount(item.taxAmount ?? item.gstTotal),
      shippingChargedToCustomer: amount(item.shippingChargedToCustomer),
      customerLineTotal: amount(item.customerLineTotal),
      hsn: String(item.hsn || ""),
    }));
    return {
      invoiceNumber,
      orderId: String(orderId),
      invoiceDate,
      seller: {
        sellerId: group.sellerId,
        sellerType: group.sellerType,
        name: group.items[0].sellerName || (group.sellerType === "vendor" ? `Vendor ${group.sellerId}` : seller.storeName || "PARTSWALA IND"),
        address: group.items[0].sellerAddress || (group.sellerType === "partswala" ? seller.address || "" : ""),
        gstin: group.items[0].sellerGstin || (group.sellerType === "partswala" ? seller.gst || "" : ""),
        state: group.items[0].sellerState || seller.state || "",
      },
      items: lines,
      accountingReviewStatus: "pending",
      totals: {
        taxableAmount: amount(lines.reduce((sum, item) => sum + item.taxableValue, 0)),
        discount: amount(lines.reduce((sum, item) => sum + item.discount, 0)),
        cgst: amount(lines.reduce((sum, item) => sum + item.cgst, 0)),
        sgst: amount(lines.reduce((sum, item) => sum + item.sgst, 0)),
        igst: amount(lines.reduce((sum, item) => sum + item.igst, 0)),
        gst: amount(lines.reduce((sum, item) => sum + item.taxAmount, 0)),
        shippingChargedToCustomer: amount(lines.reduce((sum, item) => sum + item.shippingChargedToCustomer, 0)),
        grandTotal: amount(lines.reduce((sum, item) => sum + item.customerLineTotal, 0)),
      },
      issuerModel: "seller_specific_snapshot_requires_accounting_review",
    };
  });
}