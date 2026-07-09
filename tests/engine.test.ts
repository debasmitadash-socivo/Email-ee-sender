import { describe, it, expect, beforeAll } from "vitest";
import { effectiveCap, HARD_MAX_DAILY_CAP } from "../config/ramp";
import { lintEmail } from "../lib/lint";
import { spin, renderVars, assembleBody } from "../lib/render";
import { snapIntoWindow, computeNextSendAt, localParts, jitterSeconds } from "../lib/schedule";
import { parseCsv, toCsv } from "../lib/csv";
import { encrypt, decrypt, signToken, verifyToken } from "../lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

describe("ramp", () => {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  it("applies the warm-up schedule", () => {
    expect(effectiveCap(day(0), 40)).toBe(8); // week 1
    expect(effectiveCap(day(7), 40)).toBe(15); // week 2
    expect(effectiveCap(day(14), 40)).toBe(25); // week 3
    expect(effectiveCap(day(28), 40)).toBe(40); // week 4+
  });
  it("never exceeds the hard max", () => {
    expect(effectiveCap(day(60), 500)).toBe(HARD_MAX_DAILY_CAP);
  });
});

describe("lint", () => {
  it("flags spam words and banned phrases", () => {
    const issues = lintEmail("Act now — free trial", "I hope this email finds you well. Click here!");
    expect(issues.some((i) => i.rule === "spam_word")).toBe(true);
    expect(issues.some((i) => i.rule === "banned_phrase" && i.level === "error")).toBe(true);
  });
  it("enforces max 2 links", () => {
    const body = "See https://a.com and https://b.com and https://c.com";
    expect(lintEmail("Hi", body).some((i) => i.rule === "max_links")).toBe(true);
    expect(lintEmail("Hi", "https://a.com https://b.com").some((i) => i.rule === "max_links")).toBe(false);
  });
});

describe("render", () => {
  it("resolves spintax deterministically with a fixed rand", () => {
    expect(spin("{a|b|c}", () => 0)).toBe("a");
    expect(spin("{a|b|c}", () => 0.99)).toBe("c");
  });
  it("substitutes vars and reports missing", () => {
    const r = renderVars("Hi {{first_name}} of {{company}} {{ai_opener}}", { first_name: "Ada", company: "" });
    expect(r.rendered).toContain("Ada");
    expect(r.missing).toContain("company");
    expect(r.missing).toContain("ai_opener");
  });
  it("always appends unsubscribe + footer identity", () => {
    const out = assembleBody({
      body: "Hello",
      profile: { footer_identity: "Socivo Ltd, London" },
      unsubscribeUrl: "https://go.example/u/tok",
      plainText: true,
    });
    expect(out.text).toContain("Unsubscribe: https://go.example/u/tok");
    expect(out.text).toContain("Socivo Ltd, London");
    expect(out.html).toBeUndefined(); // plain-text mode: text only
  });
});

describe("schedule", () => {
  const window = { start: "08:30", end: "17:30", days: [1, 2, 3, 4, 5] };
  it("jitter stays in the 120–540s band", () => {
    for (let i = 0; i < 50; i++) {
      const j = jitterSeconds();
      expect(j).toBeGreaterThanOrEqual(120);
      expect(j).toBeLessThan(540);
    }
  });
  it("snaps a weekend send into the next weekday window", () => {
    const saturday = new Date("2026-07-11T10:00:00Z"); // a Saturday
    const snapped = snapIntoWindow(saturday, window, "Europe/London");
    const { isoDay, minutes } = localParts(snapped, "Europe/London");
    expect(isoDay).toBeLessThanOrEqual(5);
    expect(minutes).toBeGreaterThanOrEqual(8 * 60 + 30);
    expect(minutes).toBeLessThanOrEqual(17 * 60 + 30);
  });
  it("never lands outside the compliance band", () => {
    const midnight = new Date("2026-07-08T23:30:00Z");
    const snapped = computeNextSendAt({ base: midnight, delayDays: 0, window, timeZone: "Europe/London" });
    const { minutes } = localParts(snapped, "Europe/London");
    expect(minutes).toBeGreaterThanOrEqual(6 * 60);
    expect(minutes).toBeLessThanOrEqual(21 * 60);
  });
});

describe("csv", () => {
  it("round-trips quoted fields", () => {
    const rows = parseCsv('email,name\n"a@b.com","Smith, Jane"\nc@d.com,"He said ""hi"""');
    expect(rows).toEqual([
      ["email", "name"],
      ["a@b.com", "Smith, Jane"],
      ["c@d.com", 'He said "hi"'],
    ]);
    expect(toCsv(rows)).toContain('"Smith, Jane"');
  });
});

describe("crypto", () => {
  it("encrypts and decrypts", async () => {
    const secret = "refresh-token-value-123";
    expect(await decrypt(await encrypt(secret))).toBe(secret);
  });
  it("signs and verifies tokens; rejects tampering", async () => {
    const token = await signToken({ e: "x@y.com", w: "ws1" });
    expect(await verifyToken(token)).toEqual({ e: "x@y.com", w: "ws1" });
    expect(await verifyToken(token.slice(0, -3) + "abc")).toBeNull();
  });
});
