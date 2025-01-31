import { Hono } from "hono";
import { describe, it, expect } from "vitest";
import { swrCache } from "../src/swrCache.js";

describe("swrCache Middleware", () => {
  const app = new Hono();

  app.use("*", swrCache({ cacheName: "default" }));
  app.get("/default", (c) => c.text("foo"));
  app.get("/1day", (c) => c.text("foo"));

  it("doesn't change the response", async () => {
    const res = await app.request("http://localhost/default");

    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("foo");
  });
});
