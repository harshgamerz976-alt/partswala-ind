export function shouldShowComingSoon(preLaunchEnabled, isAdmin, isDevelopment = false) {
  if (isDevelopment) return false;
  return preLaunchEnabled !== false && isAdmin !== true;
}
