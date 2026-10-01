export const SELLER_INVOICE_REVIEW_MODEL = "seller_specific_snapshot_requires_accounting_review";

export function needsAccountingReview(invoice) {
  return invoice?.issuerModel === SELLER_INVOICE_REVIEW_MODEL && invoice.accountingReviewStatus !== "reviewed";
}

export function canDownloadInvoice(invoice) {
  return !needsAccountingReview(invoice);
}