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

enum SWRStatus {
  HIT = "HIT",
  MISS = "MISS",
  REVALIDATING = "REVALIDATING",
}

export const swrCache = ({
  cacheName,
  wait,
  cacheControl,
  vary,
  keyGenerator,
  swr = {},
}: SwrCacheOptions): MiddlewareHandler => {
  if (!globalThis.caches) {
    console.error(
      "SWR Cache Middleware requires globalThis.caches to be available"
    );
    return createMiddleware(async (c, next) => await next());
  }

  swr = {
    staleAtHeaderName: "x-edge-cache-stale-at",
    statusHeaderName: "x-edge-cache-status",
    clientCacheControlHeaderName: "x-client-cache-control",
    originCacheControlHeaderName: "x-edge-cache-control",
    ...swr,
  };

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

        if (name === "stale-while-revalidate") {
          c.header(
            swr.staleAtHeaderName!,
            (Date.now() + parseInt(value, 10)).toString()
          );
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

  const shouldRevalidate = (res: Response) => {
    const staleAt = res.headers.get(swr.staleAtHeaderName!);

    // if we don't have the SWR headers set by this middleware, don't revalidate
    if (!staleAt) {
      return false;
    }

    return Date.now() > new Date(parseInt(staleAt, 10)).getTime();
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
        c.res.headers.set(swr.statusHeaderName!, SWRStatus.HIT);
        return;
      }

      c.res.headers.set(swr.statusHeaderName!, SWRStatus.REVALIDATING);
    } else {
      c.res.headers.set(swr.statusHeaderName!, SWRStatus.MISS);
    }

    const processNext = new Promise<void>(async (resolve) => {
      await next();

      if (!c.res.ok) {
        return;
      }

      addHeaders(c);

      const cacheableResponse = c.res.clone();

      await cache.put(key, cacheableResponse);

      resolve();
    });

    if (wait) {
      await processNext;
    } else {
      c.executionCtx.waitUntil(processNext);
    }
  });
};
