export function jsonRequest(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "body"> = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  return new Request(url, {
    ...init,
    headers,
    body: JSON.stringify(body),
  });
}

export function formRequest(
  url: string,
  formData: FormData,
  init: Omit<RequestInit, "body"> = {},
) {
  return new Request(url, {
    ...init,
    body: formData,
  });
}

export function requestWithUser(
  url: string,
  userId = "user-test",
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-user-id", userId);

  return new Request(url, {
    ...init,
    headers,
  });
}

export function personaParams(personaId = "persona-test") {
  return {
    params: Promise.resolve({ personaId }),
  };
}

export function personaMessageParams(
  personaId = "persona-test",
  messageId = "message-test",
) {
  return {
    params: Promise.resolve({ personaId, messageId }),
  };
}
