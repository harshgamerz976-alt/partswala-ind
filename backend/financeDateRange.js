export function normalizeFinanceDateRange({ startDate, endDate } = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const normalizedStart = String(startDate || `${today.slice(0, 4)}-01-01`);
  const normalizedEnd = String(endDate || today);
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
  };
  if (!isDate(normalizedStart) || !isDate(normalizedEnd) || normalizedStart > normalizedEnd) {
    throw new Error("Choose a valid finance reporting period.");
  }
  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    startAt: `${normalizedStart}T00:00:00.000Z`,
    endAt: `${normalizedEnd}T23:59:59.999Z`,
  };
}