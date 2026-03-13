import pino from "pino";

const level = process.env.SOUL_LOG_LEVEL?.trim() || (process.env.NODE_ENV === "development" ? "debug" : "info");

export const soulLogger = pino({
  name: "limerence-soul",
  level,
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});
