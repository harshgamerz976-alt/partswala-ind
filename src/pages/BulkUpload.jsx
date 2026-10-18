import { useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import {
  confirmVendorProductImport,
  downloadVendorImportTemplate,
  previewVendorProductImport,
} from "../services/vendorBulkImportService";

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? `₹${price.toLocaleString("en-IN")}` : "—";
}

export default function BulkUpload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [summary, setSummary] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function chooseFile(event) {
    setFile(event.target.files?.[0] || null);
    event.target.value = "";
    setPreview(null);
    setSummary(null);
    setConfirmed(false);
    setError("");
  }

  async function downloadTemplate() {
    setBusy("template");
    setError("");
    try {
      const blob = await downloadVendorImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "vendor-product-import-template.xlsx";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError.message || "The Excel template could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  async function validateFile(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose an .xlsx, .xls, or .csv file first.");
      return;
    }
    setBusy("preview");
    setPreview(null);
    setSummary(null);
    setConfirmed(false);
    setError("");
    try {
      setPreview(await previewVendorProductImport(file));
    } catch (previewError) {
      setError(previewError.message || "The file could not be validated.");
    } finally {
      setBusy("");
    }
  }

  async function importProducts() {
    if (!file || !preview?.validRows || !confirmed) return;
    setBusy("import");
    setSummary(null);
    setError("");
    try {
      const result = await confirmVendorProductImport(file);
      setSummary(result);
      setPreview(null);
      setConfirmed(false);
    } catch (importError) {
      setError(importError.message || "The products could not be imported.");
    } finally {
      setBusy("");
    }
  }

  const imported = summary?.summary;
  const createdCount = summary?.imported?.filter((item) => !item.updateExisting).length ?? 0;
  const updatedCount = summary?.imported?.filter((item) => item.updateExisting).length ?? 0;

  return (
    <main className="vendor-page">
      <header className="vendor-dashboard-header">
        <div>
          <p className="vendor-kicker">PARTSWALA IND · VENDOR WORKSPACE</p>
          <h1>Bulk Upload Products</h1>
          <p>Upload an Excel workbook to validate and import multiple products.</p>
        </div>
        <Link className="vendor-secondary" to="/vendor/dashboard"><ArrowLeft size={15} />Vendor Dashboard</Link>
      </header>

      <section className="vendor-section-panel mx-auto max-w-5xl">
        <div className="vendor-panel-heading">
          <div><p className="vendor-kicker">PRODUCT CATALOG</p><h2>Import products from Excel</h2></div>
          <FileSpreadsheet aria-hidden="true" />
        </div>
        <p className="vendor-muted">
          Use the template to prepare your spreadsheet. New products are submitted for review;
          matching part number and brand pairs update your own existing listings.
        </p>
        <button className="vendor-secondary mt-4" type="button" onClick={downloadTemplate} disabled={Boolean(busy)}>
          {busy === "template" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
          {busy === "template" ? "Preparing template…" : "Download Excel template (.xlsx)"}
        </button>

        <form className="mt-6 space-y-4" onSubmit={validateFile}>
          <label className="block text-sm text-slate-300">
            <span className="mb-2 block font-semibold">Product spreadsheet (.xlsx, .xls, or .csv)</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={chooseFile}
              disabled={Boolean(busy)}
              className="block w-full rounded border border-slate-600 bg-slate-950 p-3 text-sm text-slate-200 file:mr-4 file:rounded file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:font-semibold file:text-white"
            />
          </label>
          {file && <p className="vendor-muted" aria-live="polite">Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
          <button className="vendor-primary" type="submit" disabled={!file || Boolean(busy)}>
            {busy === "preview" ? <Loader2 className="animate-spin" size={15} /> : <FileSpreadsheet size={15} />}
            {busy === "preview" ? "Validating spreadsheet…" : "Preview upload"}
          </button>
        </form>

        {busy === "import" && <p className="vendor-muted mt-4" role="status">Importing {preview?.validRows} valid rows. Keep this page open…</p>}
        {error && <p className="vendor-error mt-4" role="alert">{error}</p>}
        {summary && (
          <section className="mt-6 rounded border border-emerald-500/40 bg-emerald-950/30 p-4" aria-live="polite">
            <h2 className="font-bold text-emerald-200">Import completed</h2>
            <p className="mt-2 text-sm text-slate-200">
              {imported?.imported ?? summary.imported?.length ?? 0} products processed:
              {" "}{createdCount} new and {updatedCount} updated.
              {imported?.invalidRows ? ` ${imported.invalidRows} invalid rows were skipped.` : ""}
            </p>
            {summary.warnings?.length > 0 && (
              <div className="mt-3 text-sm text-amber-200">
                <p>{summary.warnings.length} row warning{summary.warnings.length === 1 ? "" : "s"}:</p>
                <ul className="mt-1 list-inside list-disc">
                  {summary.warnings.map((warning, index) => (
                    <li key={`${warning.rowNumber}-${index}`}>Row {warning.rowNumber}: {warning.errors.join("; ")}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </section>

      {preview && (
        <section className="vendor-section-panel mx-auto mt-6 max-w-5xl" aria-labelledby="bulk-preview-heading">
          <div className="vendor-panel-heading">
            <div><p className="vendor-kicker">CHECK BEFORE IMPORT</p><h2 id="bulk-preview-heading">Upload preview</h2></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Total rows", preview.totalRows],
              ["Valid rows", preview.validRows],
              ["Invalid rows", preview.invalidRows],
              ["Existing listings to update", preview.duplicates],
            ].map(([label, value]) => (
              <div className="rounded border border-slate-700 bg-slate-950/60 p-3" key={label}>
                <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value ?? 0}</p>
              </div>
            ))}
          </div>

          {preview.reImportBehavior && <p className="vendor-muted mt-4">{preview.reImportBehavior}</p>}

          {preview.rows?.length > 0 && (
            <div className="vendor-table-scroll mt-5">
              <table className="vendor-data-table">
                <thead><tr><th>Row</th><th>Product</th><th>Part number</th><th>Brand</th><th>Price</th><th>Action</th></tr></thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.partNumber}-${row.brand}`}>
                      <td>{row.rowNumber}</td>
                      <td>{row.name}</td>
                      <td>{row.partNumber}</td>
                      <td>{row.brand}</td>
                      <td>{formatPrice(row.price)}</td>
                      <td>{row.updateExisting ? "Update your listing" : "Create pending review"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.errors?.length > 0 && (
            <div className="vendor-table-scroll mt-5">
              <h3 className="mb-2 font-bold text-red-200">Row validation errors</h3>
              <table className="vendor-data-table">
                <thead><tr><th>Spreadsheet row</th><th>Validation issue</th></tr></thead>
                <tbody>
                  {preview.errors.map((entry, index) => (
                    <tr key={`${entry.rowNumber}-${index}`}>
                      <td>{entry.rowNumber}</td>
                      <td className="text-red-200">{entry.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.validRows > 0 && (
            <div className="mt-5 border-t border-slate-700 pt-4">
              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} />
                <span>I reviewed the preview and want to import {preview.validRows} valid rows. Invalid rows will be skipped.</span>
              </label>
              <button className="vendor-primary mt-4" type="button" onClick={importProducts} disabled={!confirmed || Boolean(busy)}>
                {busy === "import" ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                {busy === "import" ? "Importing…" : `Import ${preview.validRows} valid products`}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
