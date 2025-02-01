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
        expect(await res.text()).toBe("uncached");
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
        expect(await res.text()).toBe("uncached");
      });
    });
  });

  describe("cache hit", () => {
    it("returns the cached response", async () => {
      cacheMatch.mockImplementation(async () => new Response("cached"));

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/uncached", (c) => c.text("uncached"));

      const res = await app.request("http://localhost/uncached");

      expect(res).not.toBeNull();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("cached");
    });

    it("returns different responses for different urls", async () => {
      cacheMatch.mockImplementation(async (key: string) => {
        if (key === "http://localhost/url1") return new Response("url1");
        if (key === "http://localhost/url2") return new Response("url2");
      });

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/url1", (c) => c.text("url1"));
      app.get("/url1", (c) => c.text("url2"));

      const res1 = await app.request("http://localhost/url1");
      const res2 = await app.request("http://localhost/url2");

      expect(await res1.text()).toBe("url1");
      expect(await res2.text()).toBe("url2");
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
