(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AstroSeasons = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Astronomical equinoxes and solstices: Jean Meeus, Astronomical Algorithms
  // (2nd ed.), chapter 27, tables 27.B (years 2000–3000) and 27.C. The result is
  // in Terrestrial Time; UTC = TT − ΔT. ΔT is taken as 69 s (≈ its value in the
  // mid-2020s); the error this adds is well under a minute. Overall accuracy is
  // about a minute, so times are shown to the minute and labelled approximate.
  // These are ASTRONOMICAL dates; folk seasons (المربعانية، الوسم…) are a
  // different, traditional calendar and are not derived from these.
  const DELTA_T_SECONDS = 69;
  const MEAN = {
    march: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
    june: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
    september: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
    december: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
  };
  const TERMS = [
    [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
    [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
    [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
    [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
    [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
    [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074]
  ];
  const RAD = Math.PI / 180;

  function jde(year, which) {
    if (!Number.isInteger(year) || year < 2000 || year > 3000) throw new RangeError("Year must be an integer in 2000–3000");
    const c = MEAN[which];
    if (!c) throw new TypeError("Unknown event: " + which);
    const Y = (year - 2000) / 1000;
    const jde0 = c[0] + c[1] * Y + c[2] * Y * Y + c[3] * Y * Y * Y + c[4] * Y * Y * Y * Y;
    const T = (jde0 - 2451545.0) / 36525;
    const W = (35999.373 * T - 2.47) * RAD;
    const dL = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
    const S = TERMS.reduce(function (sum, t) { return sum + t[0] * Math.cos((t[1] + t[2] * T) * RAD); }, 0);
    return jde0 + (0.00001 * S) / dL;
  }

  function toUtcDate(julianEphemerisDay) {
    const ms = (julianEphemerisDay - 2440587.5) * 86400000 - DELTA_T_SECONDS * 1000;
    return new Date(Math.round(ms / 60000) * 60000); // nearest minute
  }

  const LABELS = {
    march: "الاعتدال الربيعي (بداية الربيع فلكياً)",
    june: "الانقلاب الصيفي (بداية الصيف فلكياً)",
    september: "الاعتدال الخريفي (بداية الخريف فلكياً)",
    december: "الانقلاب الشتوي (بداية الشتاء فلكياً)"
  };

  function events(year) {
    return ["march", "june", "september", "december"].map(function (which) {
      return { id: which, label: LABELS[which], utc: toUtcDate(jde(year, which)) };
    });
  }

  return { jde, toUtcDate, events, DELTA_T_SECONDS, LABELS };
});
