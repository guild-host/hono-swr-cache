import { createMiddleware } from "hono/factory";

export const swrCache = ({ cacheName }: { cacheName: string }) => {
  if (!globalThis.caches) {
    console.error(
      "SWR Cache Middleware requires globalThis.caches to be available"
    );
    return createMiddleware(async (c, next) => await next());
  }

  const cachePromise = globalThis.caches.open(cacheName);

  return createMiddleware(async (c, next) => {
    const cache = await cachePromise;

    const response = await cache.match(c.req.url);

    if (response) {
      return new Response(response.body, response);
    }

    await next();

    if (!c.res.ok) {
      return;
    }

    const cacheableResponse = c.res.clone();

    c.executionCtx.waitUntil(cache.put(c.req.url, cacheableResponse));
  });
};
