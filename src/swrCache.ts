import { createMiddleware } from "hono/factory";
import type { Context, MiddlewareHandler } from "hono";

interface SwrCacheOptions {
  // Taken directly from https://github.com/honojs/hono/blob/b2affb84f18746b487a2e02f0b1cd18e2bd8e5f5/src/middleware/cache/index.ts#L34-L40
  cacheName: string | ((c: Context) => Promise<string> | string);
  wait?: boolean;
  cacheControl?: string;
  vary?: string | string[];
  keyGenerator?: (c: Context) => Promise<string> | string;

  // additional hono-swr-cache specific options

  swr?: {
    staleAtHeaderName?: string;
    statusHeaderName?: string;
    clientCacheControlHeaderName?: string;
    originCacheControlHeaderName?: string;
  };
}

export const swrCache = ({
  cacheName,
  wait,
  cacheControl,
  vary,
  keyGenerator,
}: SwrCacheOptions): MiddlewareHandler => {
  if (!globalThis.caches) {
    console.error(
      "SWR Cache Middleware requires globalThis.caches to be available"
    );
    return createMiddleware(async (c, next) => await next());
  }

  const cacheControlDirectives = cacheControl
    ?.split(",")
    .map((d) => d.trim().toLowerCase());

  const varyDirectives = Array.isArray(vary)
    ? vary
    : vary?.split(",").map((d) => d.trim());

  if (varyDirectives?.includes("*")) {
    throw new Error(
      'Middleware vary configuration cannot include "*", as it disallows effective caching.'
    );
  }

  const addHeaders = (c: Context) => {
    if (cacheControlDirectives) {
      const existingDirectives =
        c.res.headers
          .get("cache-control")
          ?.split(",")
          .map((d) => d.trim().split("=", 1)[0]) ?? [];

      for (const directive of cacheControlDirectives) {
        const [name, value] = directive.trim().split("=", 2);

        if (!existingDirectives.includes(name)) {
          c.header("cache-control", `${name}${value ? `=${value}` : ""}`, {
            append: true,
          });
        }
      }
    }

    if (varyDirectives) {
      const existingVary =
        c.res.headers
          .get("vary")
          ?.split(",")
          .map((d) => d.trim()) ?? [];

      const vary = Array.from(
        new Set(
          [...existingVary, ...varyDirectives].map((d) => d.toLowerCase())
        )
      ).sort();

      if (vary.includes("*")) {
        c.header("vary", "*");
      } else {
        c.header("vary", vary.join(", "));
      }
    }
  };

  return createMiddleware(async (c, next) => {
    const cache =
      typeof cacheName === "string"
        ? await globalThis.caches.open(cacheName)
        : await globalThis.caches.open(await cacheName(c));

    const key = keyGenerator ? await keyGenerator(c) : c.req.url;

    const response = await cache.match(key);

    if (response) {
      c.res = new Response(response.body, response);

      if (!shouldRevalidate(response)) {
        return;
      }
    }

    await next();

    if (!c.res.ok) {
      return;
    }

    addHeaders(c);

    const cacheableResponse = c.res.clone();

    if (wait) {
      await cache.put(c.req.url, cacheableResponse);
    } else {
      c.executionCtx.waitUntil(cache.put(key, cacheableResponse));
    }
  });
};

const shouldRevalidate = (res: Response) => {
  // if we don't have the SWR headers set by this middleware, don't revalidate
  const staleAt = res.headers.get("x-edge-cache-stale-at");

  if (!staleAt) {
    return false;
  }

  return Date.now() > new Date(parseInt(staleAt, 10)).getTime();
};
