(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChirpsChart = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // SVG bar chart for CHIRPS SAT vs RNL daily rainfall at one city.
  // - Series are aligned by DATE (not by position).
  // - A valid zero is drawn as a visible baseline mark labelled 0 (no rain is data).
  // - A missing value (null/absent) is drawn as a grey ×, never as zero.
  // - Returns a status so the page can show a message instead of an empty chart.
  const W = 600, H = 180, LEFT = 38, RIGHT = 12, TOP = 16, BOTTOM = 30;
  const COLORS = { sat: "#1769aa", rnl: "#2e8b57", missing: "#9aa5b1" };

  function toValue(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // Small non-zero amounts keep two decimals so 0.02 is never printed as "0".
  function label(v) { return v === 0 ? "0" : v < 0.1 ? v.toFixed(2) : String(+v.toFixed(1)); }
  function arDays(n) { return n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? n + " أيام" : n + " يوماً"; }

  function index(records) {
    const map = new Map();
    (records || []).forEach(function (r) {
      const date = r && (r.date || r.valid_date);
      if (typeof date === "string") map.set(date, toValue(r.precipitation_mm !== undefined ? r.precipitation_mm : r.value));
    });
    return map;
  }

  function build(satRecords, rnlRecords) {
    const sat = index(satRecords), rnl = index(rnlRecords);
    const dates = Array.from(new Set(Array.from(sat.keys()).concat(Array.from(rnl.keys())))).sort();
    const counts = { days: dates.length, sat_valid: 0, rnl_valid: 0, sat_missing: 0, rnl_missing: 0, zeros: 0 };
    if (!dates.length) return { status: "no_records", svg: "", counts: counts, dates: dates };
    const values = [];
    dates.forEach(function (d) {
      const a = sat.has(d) ? sat.get(d) : null, b = rnl.has(d) ? rnl.get(d) : null;
      if (a === null) counts.sat_missing++; else { counts.sat_valid++; if (a === 0) counts.zeros++; values.push(a); }
      if (b === null) counts.rnl_missing++; else { counts.rnl_valid++; if (b === 0) counts.zeros++; values.push(b); }
    });
    const plotH = H - TOP - BOTTOM, plotW = W - LEFT - RIGHT;
    let max = values.length ? Math.max.apply(null, values) : 0;
    max = max <= 0 ? 1 : Math.ceil(max / (max > 5 ? 5 : 1)) * (max > 5 ? 5 : 1);
    const parts = [];
    [0, 0.5, 1].forEach(function (f) {
      const y = TOP + plotH * (1 - f);
      parts.push('<line x1="' + LEFT + '" y1="' + y + '" x2="' + (W - RIGHT) + '" y2="' + y + '" stroke="' + (f === 0 ? "#c9d4de" : "#edf1f5") + '"/>');
      parts.push('<text x="' + (LEFT - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#7b8794">' + +(max * f).toFixed(max < 2 ? 1 : 0) + '</text>');
    });
    const step = plotW / dates.length, barW = Math.max(3, Math.min(14, step * 0.3)), gap = 2;
    const labelEvery = Math.max(1, Math.ceil(dates.length / 10));
    const showValues = dates.length <= 10;
    const base = TOP + plotH;
    function bar(x, value, color, name, date) {
      if (value === null) {
        return '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (base - 3) + '" text-anchor="middle" font-size="11" fill="' + COLORS.missing + '"><title>' + name + " " + date + ': قيمة مفقودة (ليست صفراً)</title>×</text>';
      }
      const h = value === 0 ? 2 : Math.max(2, Math.min(plotH, value / max * plotH));
      let s = '<rect x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1" fill="' + color + '"><title>' + name + " " + date + ": " + value + ' ملم</title></rect>';
      if (showValues) s += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (base - h - 3).toFixed(1) + '" text-anchor="middle" font-size="9" fill="' + color + '">' + label(value) + '</text>';
      return s;
    }
    dates.forEach(function (d, i) {
      const center = LEFT + i * step + step / 2;
      parts.push(bar(center - gap / 2 - barW, sat.has(d) ? sat.get(d) : null, COLORS.sat, "SAT", d));
      parts.push(bar(center + gap / 2, rnl.has(d) ? rnl.get(d) : null, COLORS.rnl, "RNL", d));
      if (i % labelEvery === 0) parts.push('<text x="' + center.toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#4c5b6b">' + d.slice(5) + '</text>');
    });
    const status = values.length === 0 ? "all_missing" : values.every(function (v) { return v === 0; }) ? "all_zero" : (counts.sat_missing || counts.rnl_missing) ? "partial" : "ok";
    return { status: status, svg: parts.join(""), counts: counts, dates: dates, max: max };
  }

  // Arabic caption for the chart state; always explicit, never an empty chart.
  function caption(result) {
    const c = result.counts;
    if (result.status === "no_records") return "لا توجد سجلات CHIRPS لهذه المدينة في العينة، فلا يُرسم مخطط.";
    const range = result.dates[0] + " إلى " + result.dates[result.dates.length - 1] + " (" + arDays(c.days) + ")";
    if (result.status === "all_missing") return "كل القيم مفقودة في الفترة " + range + "؛ تظهر × رمادية لكل يوم، ولا تُعد صفراً.";
    let text = "الفترة " + range + " · SAT متاح " + c.sat_valid + "/" + c.days + " · RNL متاح " + c.rnl_valid + "/" + c.days + ".";
    if (result.status === "all_zero") text += " كل القيم المتاحة صفر (لا هطول مقدّر)، وتظهر كعلامة على خط الأساس مع الرقم 0.";
    else if (c.zeros) text += " القيم الصفرية تظهر كعلامة على خط الأساس.";
    if (c.sat_missing || c.rnl_missing) text += " × رمادية = قيمة مفقودة وليست صفراً.";
    return text;
  }

  return { build: build, caption: caption, label: label, arDays: arDays, COLORS: COLORS };
});
