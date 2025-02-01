import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";

// Taken directly from https://github.com/honojs/hono/blob/b2affb84f18746b487a2e02f0b1cd18e2bd8e5f5/src/middleware/cache/index.ts#L34-L40
interface SwrCacheOptions {
  cacheName: string | ((c: Context) => Promise<string> | string);
  wait?: boolean;
  cacheControl?: string;
  vary?: string | string[];
  keyGenerator?: (c: Context) => Promise<string> | string;
}

export const swrCache = ({ cacheName }: SwrCacheOptions): MiddlewareHandler => {
  if (!globalThis.caches) {
    console.error(
      "SWR Cache Middleware requires globalThis.caches to be available"
    );
    return createMiddleware(async (c, next) => await next());
  }

  return createMiddleware(async (c, next) => {
    const cache =
      typeof cacheName === "string"
        ? await globalThis.caches.open(cacheName)
        : await globalThis.caches.open(await cacheName(c));

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
