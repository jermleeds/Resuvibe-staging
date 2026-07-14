import { describe, it, expect } from "vitest";
import { decideEntitlement } from "./entitlement";
import type { Entitlement } from "./types";

const free = (over: Partial<Entitlement> = {}): Entitlement => ({
  subscriptionTier: "free",
  trialUsedAt: null,
  trialApplicationId: null,
  ...over,
});

describe("decideEntitlement", () => {
  it("allows a paid user regardless of trial state", () => {
    expect(
      decideEntitlement(
        { subscriptionTier: "paid", trialUsedAt: null, trialApplicationId: null },
        "app-1",
      ).kind,
    ).toBe("allow");
    expect(
      decideEntitlement(
        { subscriptionTier: "paid", trialUsedAt: "2026-07-10T00:00:00Z", trialApplicationId: "other" },
        "app-1",
      ).kind,
    ).toBe("allow");
  });

  it("tells a free user with an unclaimed trial to claim it", () => {
    expect(decideEntitlement(free(), "app-1").kind).toBe("claim");
  });

  it("allows a free user whose trial is already bound to THIS application", () => {
    expect(
      decideEntitlement(
        free({ trialUsedAt: "2026-07-10T00:00:00Z", trialApplicationId: "app-1" }),
        "app-1",
      ).kind,
    ).toBe("allow");
  });

  it("paywalls a free user whose trial was used on a DIFFERENT application", () => {
    expect(
      decideEntitlement(
        free({ trialUsedAt: "2026-07-10T00:00:00Z", trialApplicationId: "app-2" }),
        "app-1",
      ).kind,
    ).toBe("paywall");
  });
});
