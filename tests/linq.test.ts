import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  extractLinqMessageText,
  parseLinqPhoneToPersonaMap,
  verifyLinqWebhookSignature,
} from "@/lib/linq";

describe("linq helpers", () => {
  beforeEach(() => {
    delete process.env.LINQ_PHONE_TO_PERSONA_MAP;
  });

  it("verifies Linq webhook signatures against timestamp and raw body", () => {
    const timestamp = "1712059200";
    const rawBody = JSON.stringify({ hello: "world" });
    const secret = "super-secret";
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const valid = verifyLinqWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret,
      now: 1712059200 * 1000,
    });

    expect(valid).toBe(true);
  });

  it("rejects stale Linq webhook timestamps", () => {
    const valid = verifyLinqWebhookSignature({
      rawBody: "{}",
      timestamp: "1712059200",
      signature: "deadbeef",
      secret: "super-secret",
      now: 1712059200 * 1000 + 10 * 60 * 1000,
    });

    expect(valid).toBe(false);
  });

  it("extracts text and attachment summaries from Linq message parts", () => {
    const text = extractLinqMessageText([
      { type: "text", value: "hey there" },
      { type: "link", url: "https://example.com" },
      { type: "media", url: "https://cdn.example.com/photo.jpg" },
    ]);

    expect(text).toContain("hey there");
    expect(text).toContain("Shared link: https://example.com");
    expect(text).toContain("Shared a media attachment.");
  });

  it("parses phone-to-persona routing maps from env style strings", () => {
    expect(
      parseLinqPhoneToPersonaMap("+12025550123=persona-mom,+12025550124=persona-alex"),
    ).toEqual({
      "+12025550123": "persona-mom",
      "+12025550124": "persona-alex",
    });
  });
});
