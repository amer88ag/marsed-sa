(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MarsedRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SERVICE_STATUSES = new Set(["active", "research", "planned", "disabled"]);
  const LICENSE_STATUSES = new Set([
    "approved", "approved_with_conditions", "research_reviewed",
    "review_required", "approval_required", "rejected"
  ]);
  const HEALTH_STATUSES = new Set([
    "healthy", "degraded", "not_monitored", "ci_smoke_tested",
    "not_connected", "unavailable"
  ]);

  function uniqueIds(items, label, errors) {
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item.id !== "string" || !item.id.trim()) {
        errors.push(label + " contains an entry without an id");
        continue;
      }
      if (seen.has(item.id)) errors.push(label + " has duplicate id: " + item.id);
      seen.add(item.id);
    }
    return seen;
  }

  function validateRegistries(servicesRegistry, providersRegistry) {
    const errors = [];
    if (!servicesRegistry || servicesRegistry.registry_type !== "services" ||
        !Array.isArray(servicesRegistry.services)) {
      errors.push("Invalid services registry envelope");
    }
    if (!providersRegistry || providersRegistry.registry_type !== "providers" ||
        !Array.isArray(providersRegistry.providers)) {
      errors.push("Invalid providers registry envelope");
    }
    if (errors.length) return { valid: false, errors };

    const serviceIds = uniqueIds(servicesRegistry.services, "services", errors);
    const providerIds = uniqueIds(providersRegistry.providers, "providers", errors);

    for (const service of servicesRegistry.services) {
      if (!SERVICE_STATUSES.has(service.status)) {
        errors.push("Unknown status for service " + service.id + ": " + service.status);
      }
      if (!Array.isArray(service.provider_ids)) {
        errors.push("provider_ids must be an array for service " + service.id);
        continue;
      }
      for (const providerId of service.provider_ids) {
        if (!providerIds.has(providerId)) {
          errors.push("Unknown provider " + providerId + " referenced by service " + service.id);
        }
      }
    }

    for (const provider of providersRegistry.providers) {
      if (!LICENSE_STATUSES.has(provider.license_status)) {
        errors.push("Unknown license status for provider " + provider.id);
      }
      if (!HEALTH_STATUSES.has(provider.health_status)) {
        errors.push("Unknown health status for provider " + provider.id);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  function getServices(servicesRegistry, options) {
    const statuses = options && Array.isArray(options.statuses) ? new Set(options.statuses) : null;
    return (servicesRegistry.services || []).filter(service => !statuses || statuses.has(service.status));
  }

  function getProvidersForService(service, providersRegistry) {
    const ids = new Set(service.provider_ids || []);
    return (providersRegistry.providers || []).filter(provider => ids.has(provider.id));
  }

  function isProviderEligibleForPublicDisplay(provider) {
    return !!provider && ["approved", "approved_with_conditions"].includes(provider.license_status);
  }

  return {
    validateRegistries,
    getServices,
    getProvidersForService,
    isProviderEligibleForPublicDisplay
  };
});
