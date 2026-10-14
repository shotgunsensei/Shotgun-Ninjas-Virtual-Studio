import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";

const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve("express"));
const qs = expressRequire("qs");
const proxyaddr = expressRequire("proxy-addr");

test("qs applies the configured comma limit to bracket and plain keys", () => {
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
  for (const key of ["a[]", "a"]) {
    assert.throws(() => qs.parse(`${key}=1,2,3,4`, options), RangeError);
    const parsed = qs.parse(`${key}=1,2,3`, options);
    assert.deepEqual(parsed.a.flat(), ["1", "2", "3"]);
  }
  // arrayLimit without throwOnLimitExceeded is not an allocation ceiling.
  assert.deepEqual(qs.parse("a[]=1,2,3,4", { comma: false }).a, ["1,2,3,4"]);
});

test("qs handles attacker-supplied isBuffer keys without breaking ordinary or Buffer serialization", () => {
  for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
    for (const value of ["y", "", "0"]) {
      const parsed = qs.parse(`x[constructor][isBuffer]=${value}`, options);
      assert.doesNotThrow(() => qs.stringify(parsed));
      assert.equal(
        qs.stringify(parsed),
        `x%5Bconstructor%5D%5BisBuffer%5D=${value}`,
      );
    }
  }
  assert.equal(qs.stringify({ file: Buffer.from("studio") }), "file=studio");
  assert.deepEqual(qs.parse("track[name]=Piano&note[]=60&note[]=64"), {
    track: { name: "Piano" },
    note: ["60", "64"],
  });
  assert.equal(qs.stringify(qs.parse("x[constructor][isBuffer]=y")), "");
});

test("proxy-addr rejects unrelated IPv4 hops for IPv6 trust subnets and preserves valid trust", () => {
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    const trust = proxyaddr.compile(subnet);
    for (const address of ["203.0.113.9", "::ffff:203.0.113.9"]) {
      assert.equal(trust(address), false, `${subnet}: ${address}`);
      assert.equal(
        proxyaddr(
          {
            socket: { remoteAddress: address },
            headers: { "x-forwarded-for": "198.51.100.42" },
          },
          trust,
        ),
        address,
      );
    }
  }
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyaddr.compile(subnet);
    assert.equal(trust("203.0.113.9"), false);
    assert.equal(trust("10.0.0.42"), true);
    assert.equal(trust("::ffff:10.0.0.42"), true);
    assert.equal(
      proxyaddr(
        {
          socket: { remoteAddress: "10.0.0.42" },
          headers: { "x-forwarded-for": "198.51.100.42" },
        },
        trust,
      ),
      "198.51.100.42",
    );
  }
  const nativeV6 = proxyaddr.compile("2001:db8:1234::/48");
  assert.equal(nativeV6("2001:db8:1234::5"), true);
  assert.equal(nativeV6("2001:db8:5678::5"), false);
  assert.equal(nativeV6("203.0.113.9"), false);
});

test("the actual API keeps default proxy trust and serves health after nested form and JSON parsing", async () => {
  // Import the app without the entry point: no database, external target or
  // production listener is started. Suppress request logging for these probes.
  process.env.NODE_ENV = "production";
  process.env.LOG_LEVEL = "silent";
  const { default: app } = await import("../src/app");
  assert.equal(app.get("trust proxy"), false);
  assert.equal(app.get("query parser"), "simple");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${origin}/api/healthz?a[]=1,2,3,4`, {
      headers: { "X-Forwarded-For": "198.51.100.42" },
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    for (const [contentType, body] of [
      [
        "application/x-www-form-urlencoded",
        "track[name]=Piano&note[]=60&note[]=64",
      ],
      ["application/x-www-form-urlencoded", "x[constructor][isBuffer]=y"],
      [
        "application/json",
        JSON.stringify({ track: { name: "Piano" }, note: [60, 64] }),
      ],
    ]) {
      // The application has no POST route: middleware must parse safely and
      // continue to the ordinary 404 rather than producing a parser failure.
      const response = await fetch(`${origin}/api/healthz`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
      assert.equal(response.status, 404);
    }
    assert.equal((await fetch(`${origin}/api/healthz`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
