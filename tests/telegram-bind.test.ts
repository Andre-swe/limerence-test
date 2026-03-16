import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTelegramBindCommand,
  isTelegramBindCodeValid,
  parseTelegramBindCommand,
  telegramBindCodeLifetimeMinutes,
} from "@/lib/telegram-bind";

const persona = {
  id: "persona-mom",
  userId: "user-demo",
};

describe("telegram bind codes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires bind codes after the configured lifetime", () => {
    vi.setSystemTime(new Date("2026-03-16T15:00:00.000Z"));

    const command = buildTelegramBindCommand(persona);
    const parsed = parseTelegramBindCommand(command);

    expect(parsed).not.toBeNull();
    expect(isTelegramBindCodeValid(persona, parsed?.code)).toBe(true);

    vi.setSystemTime(
      new Date(Date.now() + (telegramBindCodeLifetimeMinutes + 1) * 60_000),
    );

    expect(isTelegramBindCodeValid(persona, parsed?.code)).toBe(false);
  });
});
