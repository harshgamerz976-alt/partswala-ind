const ADMIN_EMAILS = new Set([
  "kripaldiamond@gmail.com",
  "harshgamerz976@gmail.com",
  "partswalaind@gmail.com",
]);

export function hasAdminClaim(user) {
  if (user?.admin === true) return true;
  return typeof user?.email === "string"
    && ADMIN_EMAILS.has(user.email.trim().toLowerCase());
}
