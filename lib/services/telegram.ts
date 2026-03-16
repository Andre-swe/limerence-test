import { getPersona, listPendingTelegramMessages, updateMessage } from "@/lib/store";

const TELEGRAM_DELIVERY_TIMEOUT_MS = 15_000;

export async function sendTelegramText(chatId: number, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return false;
  }

  // Keep background delivery bounded so a slow Telegram API call does not stall
  // the rest of the flush loop indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_DELIVERY_TIMEOUT_MS);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  return response.ok;
}

export async function flushPendingTelegramMessages() {
  const pendingMessages = await listPendingTelegramMessages();
  const results: Array<{ messageId: string; delivered: boolean }> = [];

  for (const message of pendingMessages) {
    const persona = await getPersona(message.personaId);

    if (!persona?.telegramChatId) {
      continue;
    }

    try {
      const delivered = await sendTelegramText(persona.telegramChatId, message.body);
      await updateMessage(message.id, (current) => ({
        ...current,
        delivery: {
          ...current.delivery,
          // Record every attempt, even when Telegram rejects the request, so
          // retries and operator diagnostics have a complete delivery history.
          telegramStatus: delivered ? "sent" : "failed",
          attempts: current.delivery.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: delivered ? undefined : "Telegram sendMessage failed.",
        },
      }));
      results.push({ messageId: message.id, delivered });
    } catch (error) {
      await updateMessage(message.id, (current) => ({
        ...current,
        delivery: {
          ...current.delivery,
          telegramStatus: "failed",
          attempts: current.delivery.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : "Unknown telegram delivery error.",
        },
      }));
      results.push({ messageId: message.id, delivered: false });
    }
  }

  return results;
}
