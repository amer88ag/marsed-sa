(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ChirpsAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function normalizeCitySeries(dataset, cityId, productId) {
    if (!dataset || dataset.schema_version !== 1 || !dataset.series) {
      throw new TypeError("Unsupported CHIRPS dataset schema");
    }
    if (!["sat", "rnl"].includes(productId)) throw new TypeError("Unsupported CHIRPS product: " + productId);
    const records = dataset.series[productId] && dataset.series[productId][cityId];
    if (!Array.isArray(records)) throw new TypeError("No CHIRPS series for " + cityId + " / " + productId);
    return {
      schema_version: "1.0.0",
      service_id: "precipitation",
      provider_id: "chirps-v3",
      product_id: productId === "sat" ? "DAILY-SAT-FINAL" : "DAILY-RNL",
      retrieved_at: dataset.generated_at_utc || null,
      location: dataset.cities && dataset.cities[cityId] ? {
        id: cityId,
        name: dataset.cities[cityId].name,
        latitude: dataset.cities[cityId].lat,
        longitude: dataset.cities[cityId].lon
      } : { id: cityId },
      observations: records.map(function (row) {
        const value = row.precipitation_mm;
        if (value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          throw new TypeError("Invalid CHIRPS precipitation value for " + row.date);
        }
        return { valid_date: row.date, value: value, unit: "mm/day" };
      }),
      provenance: {
        source_url: dataset.source_url || "https://www.chc.ucsb.edu/data/chirps3",
        attribution: "CHIRPS v3, Climate Hazards Center, UCSB",
        methodology: productId === "sat" ? "SAT disaggregates pentad totals using IMERG Late V07" : "RNL disaggregates pentad totals using ERA5",
        spatial_sampling: dataset.spatial_sampling || "Unspecified",
        date_semantics: dataset.date_semantics || "Unspecified",
        limitations: ["Nearest grid cell at city coordinates; not a city-area mean or station observation"]
      }
    };
  }
  return { normalizeCitySeries };
});
