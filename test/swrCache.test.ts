import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { describe, it, expect, vi, afterEach } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("cache miss", () => {
    it("returns the original response", async () => {
      const cachePut = vi.fn();

      vi.stubGlobal("caches", {
        open: async () => ({
          match: () => undefined,
          put: cachePut,
        }),
      });

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
      const cachePut = vi.fn();

      vi.stubGlobal("caches", {
        open: async () => ({
          match: () => undefined,
          put: cachePut,
        }),
      });

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/error", (c) => c.text("error", 500));

      const res = await app.request("http://localhost/error");

      expect(res.ok).toBe(false);
      expect(await res.text()).toBe("error");

      expect(cachePut).not.toHaveBeenCalled();
    });

    it('accepts a function for "cacheName"', async () => {
      const cacheOpen = vi.fn().mockImplementation(async () => ({
        match: () => undefined,
        put: () => undefined,
      }));

      vi.stubGlobal("caches", {
        open: cacheOpen,
      });

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
  });

  describe("cache hit", () => {
    it("returns the cached response", async () => {
      vi.stubGlobal("caches", {
        open: async () => ({ match: async () => new Response("cached") }),
      });

      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/uncached", (c) => c.text("uncached"));

      const res = await app.request("http://localhost/uncached");

      expect(res).not.toBeNull();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("cached");
    });

    it("returns different responses for different urls", async () => {
      vi.stubGlobal("caches", {
        open: async () => ({
          match: async (key: string) => {
            if (key === "http://localhost/url1") return new Response("url1");
            if (key === "http://localhost/url2") return new Response("url2");
          },
        }),
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
