import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { swrCache } from "../src/swrCache.js";

class Context implements ExecutionContext {
  passThroughOnException(): void {
    throw new Error("Method not implemented.");
  }
  async waitUntil(promise: Promise<unknown>): Promise<void> {
    await promise;
  }
}

const ctx = new Context();

describe("swrCache Middleware", () => {
  let cacheOpen: Mock;
  let cacheMatch: Mock;
  let cachePut: Mock;

  beforeEach(() => {
    cacheMatch = vi.fn().mockImplementation(async () => undefined);
    cachePut = vi.fn().mockImplementation(async () => undefined);

    cacheOpen = vi.fn().mockImplementation(async () => ({
      match: cacheMatch,
      put: cachePut,
    }));

    vi.stubGlobal("caches", {
      open: cacheOpen,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("cache miss", () => {
    it("returns and caches the original response", async () => {
      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/uncached1", (c) => c.text("uncached1"));
      app.get("/uncached2", (c) => c.text("uncached2"));

      const res1 = await app.fetch(
        new Request("http://localhost/uncached1"),
        undefined,
        ctx
      );

      expect(res1.headers.get("x-edge-cache-status")).toBe("MISS");
      expect(await res1.text()).toBe("uncached1");
      expect(cachePut).toHaveBeenCalledWith(
        "http://localhost/uncached1",
        expect.objectContaining({
          status: 200,
          // TODO: Would be nice to match the exact body
          body: expect.any(ReadableStream),
        })
      );

      const res2 = await app.fetch(
        new Request("http://localhost/uncached2"),
        undefined,
        ctx
      );

      expect(res2.headers.get("x-edge-cache-status")).toBe("MISS");
      expect(await res2.text()).toBe("uncached2");
      expect(cachePut).toHaveBeenCalledWith(
        "http://localhost/uncached2",
        expect.objectContaining({
          status: 200,
          // TODO: Would be nice to match the exact body
          body: expect.any(ReadableStream),
        })
      );
    });

    it("does not cache non-200 responses", async () => {
      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/error", (c) => c.text("error", 500));

      const res = await app.request("http://localhost/error");

      expect(res.ok).toBe(false);
      expect(res.headers.get("x-edge-cache-status")).toBe("MISS");
      expect(await res.text()).toBe("error");

      expect(cachePut).not.toHaveBeenCalled();
    });

    it('accepts a function for "cacheName"', async () => {
      const app = new Hono();

      app.use("*", swrCache({ cacheName: (c) => c.req.path }));
      app.get("/uncached", (c) => c.text("uncached"));

      const res = await app.fetch(
        new Request("http://localhost/uncached"),
        undefined,
        ctx
      );

      expect(await res.text()).toBe("uncached");
      expect(cacheOpen).toHaveBeenCalledWith("/uncached");
    });

    it("waits if wait: true", async () => {
      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default", wait: true }));
      app.get("/uncached", (c) => c.text("uncached"));

      const res = await app.fetch(
        new Request("http://localhost/uncached"),
        undefined,
        ctx
      );

      expect(cachePut).toHaveBeenCalledWith(
        "http://localhost/uncached",
        expect.any(Response)
      );

      expect(await res.text()).toBe("uncached");
    });

    describe("cacheControl option", () => {
      it("sets the response's Cache-Control", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            cacheControl: "public,max-age=60,s-maxage=120",
          })
        );
        app.get("/uncached", (c) => c.text("uncached"));

        const res = await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(res.headers.get("Cache-Control")).toBe(
          "public, max-age=60, s-maxage=120"
        );
      });

      it("adds to the response's existing Cache-Control", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            cacheControl: "public,max-age=60,s-maxage=120",
          })
        );
        app.get("/uncached", (c) => {
          c.res.headers.set("Cache-Control", "max-age=0");
          return c.text("uncached");
        });

        const res = await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(res.headers.get("Cache-Control")).toBe(
          "max-age=0, public, s-maxage=120"
        );
      });
    });

    describe("vary option", () => {
      it("adds to the response's existing Vary", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            vary: "x-header-123,x-header-789",
          })
        );
        app.get("/uncached", (c) => {
          c.res.headers.set("vary", "x-header-456");
          return c.text("uncached");
        });

        const res = await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(res.headers.get("vary")).toBe(
          "x-header-123, x-header-456, x-header-789"
        );
      });

      it("accepts an array", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            vary: ["x-header-123", "x-header-789"],
          })
        );
        app.get("/uncached", (c) => c.text("uncached"));

        const res = await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(res.headers.get("vary")).toBe("x-header-123, x-header-789");
      });

      it("sets Vary header to * if response Vary is *", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            vary: "x-header-123,x-header-789",
          })
        );
        app.get("/uncached", (c) => {
          c.res.headers.set("vary", "*");
          return c.text("uncached");
        });

        const res = await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(res.headers.get("vary")).toBe("*");
      });

      it("does not accept vary: * as an option", async () => {
        expect(() => {
          swrCache({
            cacheName: "default",
            vary: "*",
          });
        }).toThrow(
          'Middleware vary configuration cannot include "*", as it disallows effective caching.'
        );
      });
    });

    describe("keyGenerator option", () => {
      it("uses the keyGenerator result as the cache key", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
            keyGenerator: async (c) => `${c.req.url}/123456`,
          })
        );
        app.get("/uncached", (c) => c.text("uncached"));

        await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(cacheMatch).toHaveBeenCalledWith(
          "http://localhost/uncached/123456"
        );
        expect(cachePut).toHaveBeenCalledWith(
          "http://localhost/uncached/123456",
          expect.any(Response)
        );
      });

      it("defaults to the request's url if no keyGenerator is passed", async () => {
        const app = new Hono();

        app.use(
          "*",
          swrCache({
            cacheName: "default",
          })
        );
        app.get("/uncached", (c) => c.text("uncached"));

        await app.fetch(
          new Request("http://localhost/uncached"),
          undefined,
          ctx
        );

        expect(cacheMatch).toHaveBeenCalledWith("http://localhost/uncached");
        expect(cachePut).toHaveBeenCalledWith(
          "http://localhost/uncached",
          expect.any(Response)
        );
      });
    });
  });

  describe("cache hit", () => {
    it("returns the cached response", async () => {
      cacheMatch.mockImplementation(async () => new Response("cached"));

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));

      const responseFn = vi.fn();

      app.get("/uncached", responseFn);

      const res = await app.request("http://localhost/uncached");

      expect(res).not.toBeNull();
      expect(res.status).toBe(200);
      expect(res.headers.get("x-edge-cache-status")).toBe("HIT");
      expect(await res.text()).toBe("cached");

      expect(responseFn).not.toHaveBeenCalled();
    });

    it("returns different responses for different urls", async () => {
      cacheMatch.mockImplementation(async (key: string) => {
        if (key === "http://localhost/url1") return new Response("url1");
        if (key === "http://localhost/url2") return new Response("url2");
      });

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));

      const responseFn = vi.fn();

      app.get("/url1", responseFn);
      app.get("/url1", responseFn);

      const res1 = await app.fetch(
        new Request("http://localhost/url1"),
        undefined,
        ctx
      );
      const res2 = await app.fetch(
        new Request("http://localhost/url2"),
        undefined,
        ctx
      );

      expect(await res1.text()).toBe("url1");
      expect(await res2.text()).toBe("url2");

      expect(responseFn).not.toHaveBeenCalled();
    });

    describe("stale-while-revalidate", () => {
      it("returns the cached response and revalidates in the background", async () => {
        cacheMatch.mockImplementation(
          async () =>
            new Response("cached", {
              headers: {
                "x-edge-cache-stale-at": "0",
              },
            })
        );

        const app = new Hono();

        app.use("*", swrCache({ cacheName: "default" }));

        const responseFn = vi
          .fn()
          .mockImplementation(async (c) => c.text("revalidated"));

        app.get("/uncached", responseFn);

        const res = await app.fetch(
          new Request("http://localhost/uncached", { headers: {} }),
          undefined,
          ctx
        );

        expect(res).not.toBeNull();
        expect(res.status).toBe(200);
        expect(res.headers.get("x-edge-cache-status")).toBe("REVALIDATING");
        expect(await res.text()).toBe("cached");

        expect(responseFn).toHaveBeenCalled();
      });
    });
  });

  describe("no globalThis.caches", () => {
    it("logs an error and returns the original response", async () => {
      vi.stubGlobal("caches", undefined);
      const consoleError = console.error;
      console.error = vi.fn();

      const app = new Hono();
      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/default", (c) => c.text("default"));

      const res = await app.fetch(
        new Request("http://localhost/default"),
        undefined,
        ctx
      );

      expect(console.error).toHaveBeenCalledWith(
        "SWR Cache Middleware requires globalThis.caches to be available"
      );

      expect(await res.text()).toBe("default");

      console.error = consoleError;
    });
  });
});
