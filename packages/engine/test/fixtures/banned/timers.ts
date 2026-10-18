// Banned in sim code (C02 rule 1): timers.
export const later = (f: () => void): void => {
  setTimeout(f, 10);
  setInterval(f, 10);
};
