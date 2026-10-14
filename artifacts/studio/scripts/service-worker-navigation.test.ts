import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

for (const status of [404, 500]) {
  test(`HTTP ${status} navigation preserves the last working offline shell`, async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    let cached = new Response("working studio shell");
    let network: () => Promise<Response> = async () =>
      new Response("host error", { status });
    let writes = 0;
    const source = (
      await readFile(new URL("../public/sw.js", import.meta.url), "utf8")
    ).replace("__SN_PRECACHE_URLS__", "[]");
    runInNewContext(source, {
      URL,
      Request,
      Response,
      self: {
        registration: { scope: "https://studio.test/" },
        location: { origin: "https://studio.test" },
        addEventListener: (type: string, handler: (event: unknown) => void) =>
          handlers.set(type, handler),
      },
      fetch: () => network(),
      caches: {
        open: async () => ({
          put: async (_key: string, response: Response) => {
            cached = response;
            writes++;
          },
          match: async () => cached.clone(),
        }),
      },
    });
    async function navigate() {
      const request = new Request("https://studio.test/studio");
      Object.defineProperty(request, "mode", { value: "navigate" });
      let response: Promise<Response> | undefined;
      handlers.get("fetch")!({
        request,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      assert.ok(response);
      return response;
    }
    const failed = await navigate();
    assert.equal(failed.status, status);
    assert.equal(writes, 0);
    network = async () => {
      throw new Error("offline");
    };
    assert.equal(await (await navigate()).text(), "working studio shell");
    network = async () => new Response("updated studio shell");
    assert.equal(await (await navigate()).text(), "updated studio shell");
    assert.equal(writes, 1);
    network = async () => {
      throw new Error("offline");
    };
    assert.equal(await (await navigate()).text(), "updated studio shell");
  });
}
