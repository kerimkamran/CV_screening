/* global localStorage, document */
// Applies the last chosen page background before first paint, so there is no flash.
// (Kept as a file because the Content-Security-Policy does not allow inline scripts.)
(function () {
  try {
    const v = localStorage.getItem('cv-background');
    if (/^(white|grey|sky|dark)$/.test(v)) document.documentElement.setAttribute('data-bg', v);
  } catch {
    /* storage blocked: the page follows the device */
  }
})();
