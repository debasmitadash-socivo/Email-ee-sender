import { describe, it, expect } from "vitest";
import { temperatureOf, temperatureCategories } from "../lib/temperature";

describe("temperature derivation", () => {
  it("positive state is warm", () => {
    expect(temperatureOf("positive")).toBe("warm");
  });
  it("running/no-reply states are cold", () => {
    for (const s of ["queued", "researching", "awaiting_approval", "scheduled", "in_sequence", "finished"] as const) {
      expect(temperatureOf(s)).toBe("cold");
    }
  });
  it("replied resolves by category", () => {
    expect(temperatureOf("replied", "interested")).toBe("warm");
    expect(temperatureOf("replied", "info_request")).toBe("warm");
    expect(temperatureOf("replied", "not_interested")).toBe("rejected");
    expect(temperatureOf("replied", "not_now")).toBe("neutral");
    expect(temperatureOf("replied", "ooo")).toBe("neutral");
    expect(temperatureOf("replied", null)).toBe("neutral");
  });
  it("bounced/unsubscribed/failed are rejected", () => {
    expect(temperatureOf("bounced")).toBe("rejected");
    expect(temperatureOf("unsubscribed")).toBe("rejected");
    expect(temperatureOf("failed")).toBe("rejected");
  });
  it("paused is neutral", () => {
    expect(temperatureOf("paused")).toBe("neutral");
  });
  it("every reply category maps to exactly one temperature bucket", () => {
    const all = Object.values(temperatureCategories).flat();
    expect(new Set(all).size).toBe(all.length); // no category in two buckets
    expect(all.sort()).toEqual(
      ["bounce", "info_request", "interested", "not_interested", "not_now", "ooo", "other", "unsubscribe", "wrong_person"].sort()
    );
  });
});
