export async function requestVendorBulkImport({
  user,
  baseUrl,
  path,
  file,
  confirm = false,
  responseType = "json",
  expectedContentType,
  fetchImpl = fetch,
}) {
  if (!user) throw new Error("Sign in is required to import products.");
  const token = await user.getIdToken();
  const headers = { Authorization: `Bearer ${token}` };
  const options = { headers };

  if (file) {
    const form = new FormData();
    form.append("file", file);
    if (confirm) form.append("confirm", "true");
    options.method = "POST";
    options.body = form;
  }

  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, options);
  } catch (error) {
    throw new Error(`Network request failed for ${path}: ${error?.message || "No response was received."}`);
  }
  if (!response.ok) {
    let serverMessage = "";
    if (response.headers?.get("content-type")?.includes("application/json")) {
      const result = await response.json().catch(() => ({}));
      if (typeof result.message === "string") serverMessage = result.message;
    } else if (response.headers?.get("content-type")?.startsWith("text/plain")) {
      serverMessage = (await response.text().catch(() => "")).trim().slice(0, 240);
    }
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(`${status} for ${path}.${serverMessage ? ` ${serverMessage}` : ""}`);
  }
  if (responseType === "blob") {
    const contentType = response.headers?.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (expectedContentType && contentType !== expectedContentType.toLowerCase()) {
      throw new Error(`Unexpected template content type from ${path}: ${contentType || "missing content type"}.`);
    }
    return response.blob();
  }
  const result = await response.json().catch(() => ({}));
  return result;
}
