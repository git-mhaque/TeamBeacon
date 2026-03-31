import { vi } from "vitest";

type JsonLike = Record<string, unknown> | Array<unknown>;

function jsonResponse(payload: JsonLike, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export function setupFetchMock(handlers: Record<string, JsonLike>) {
  const orderedHandlers = Object.entries(handlers).sort(([left], [right]) => right.length - left.length);
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const match = orderedHandlers.find(([path]) => url.includes(path));
    if (!match) {
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    }

    return jsonResponse(match[1]);
  });
}
