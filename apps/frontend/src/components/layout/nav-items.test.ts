import { describe, expect, it } from "vitest";

import { NAV_ITEMS, flattenNavItems } from "@/components/layout/nav-items";

describe("NAV_ITEMS", () => {
  it("omits billing, apis, and devices from top-level navigation", () => {
    const labels = NAV_ITEMS.map((item) => item.label);

    expect(labels).not.toContain("Billing");
    expect(labels).not.toContain("APIs");
    expect(labels).not.toContain("Devices");
    expect(labels).toContain("Settings");
  });

  it("keeps projects child routes flattened", () => {
    const flattened = flattenNavItems(NAV_ITEMS);

    expect(flattened.some((item) => item.to === "/projects/plans" && item.depth === 1)).toBe(true);
    expect(flattened.some((item) => item.to === "/projects/issues" && item.depth === 1)).toBe(true);
    expect(flattened.some((item) => item.to === "/source-control" && item.depth === 1)).toBe(true);
  });
});
