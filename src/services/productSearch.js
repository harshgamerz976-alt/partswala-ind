export function getProductSearchFromUrl(search) {
  return new URLSearchParams(search).get("search")?.trim() || "";
}
