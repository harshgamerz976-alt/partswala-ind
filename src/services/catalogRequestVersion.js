export function createCatalogRequestVersion() {
  let version = 0;
  return {
    begin: () => ++version,
    current: () => version,
    isCurrent: (requestVersion) => requestVersion === version,
    invalidate(requestVersion) {
      if (requestVersion === version) version += 1;
    },
  };
}
