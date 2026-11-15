import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { earthdataToken, nasaText } from "./nasa-http";
import { DailyError } from "./errors";

const realFetch = globalThis.fetch;
const savedToken = process.env.EDL_TOKEN, savedFile = process.env.EDL_TOKEN_FILE;
beforeEach(() => {
  delete process.env.EDL_TOKEN; delete process.env.EDL_TOKEN_FILE;
  globalThis.fetch = async () => { throw new Error("unexpected network request"); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env.EDL_TOKEN; else process.env.EDL_TOKEN = savedToken;
  if (savedFile === undefined) delete process.env.EDL_TOKEN_FILE; else process.env.EDL_TOKEN_FILE = savedFile;
});

test("requires explicit server credentials and rejects whitespace in a bearer token", async () => {
  await assert.rejects(earthdataToken(), (error) => error instanceof DailyError && error.status === 503);
  process.env.EDL_TOKEN = " token-without-whitespace ";
  assert.equal(await earthdataToken(), "token-without-whitespace");
  process.env.EDL_TOKEN = "bad\ntoken";
  await assert.rejects(earthdataToken(), DailyError);
});

test("loads a mounted token file and sanitizes file errors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aqua-daily-auth-"));
  try {
    process.env.EDL_TOKEN_FILE = path.join(dir, "token");
    await writeFile(process.env.EDL_TOKEN_FILE, "test-only-token\n", { mode: 0o600 });
    assert.equal(await earthdataToken(), "test-only-token");
    process.env.EDL_TOKEN_FILE = path.join(dir, "secret-missing-path");
    await assert.rejects(earthdataToken(), (error) => error instanceof DailyError && !error.message.includes(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only forwards authorization to the fixed NASA data host and refuses redirects", async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(String(url)).hostname, "opendap.earthdata.nasa.gov");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, signal);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-token");
    return new Response("valid data");
  };
  assert.equal(await nasaText(new URL("https://opendap.earthdata.nasa.gov/test"), "test-only-token", signal), "valid data");
  for (const target of ["https://evil.test/", "http://opendap.earthdata.nasa.gov/", "https://opendap.earthdata.nasa.gov.evil.test/", "https://cmr.earthdata.nasa.gov/", "https://opendap.earthdata.nasa.gov:8443/"]) {
    await assert.rejects(nasaText(new URL(target), "test-only-token", signal), DailyError);
  }
  assert.equal(calls, 1);
});

test("limits response bytes and hides upstream error bodies", async () => {
  const target = new URL("https://opendap.earthdata.nasa.gov/test");
  const signal = new AbortController().signal;
  globalThis.fetch = async () => new Response("x".repeat(20));
  await assert.rejects(nasaText(target, "test-only-token", signal, 10), DailyError);
  globalThis.fetch = async () => new Response("private upstream message", { status: 401 });
  await assert.rejects(nasaText(target, "test-only-token", signal), (error) => error instanceof DailyError && !error.message.includes("private"));
});
