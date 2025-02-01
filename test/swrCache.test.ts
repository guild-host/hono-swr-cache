import { Hono } from "hono";
import { describe, it, expect, vi } from "vitest";
import { swrCache } from "../src/swrCache.js";

describe("swrCache Middleware", () => {
  describe("cache miss", () => {
    it("returns the original response", async () => {
      const app = new Hono();

      app.use("*", swrCache({ cacheName: "default" }));
      app.get("/uncached", (c) => c.text("uncached"));

      const res = await app.request("http://localhost/uncached");

      expect(res).not.toBeNull();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("uncached");
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
});
