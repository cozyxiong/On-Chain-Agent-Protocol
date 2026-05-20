import assert from "node:assert/strict";
import test from "node:test";
import { resolveToken, toBaseUnits, fromBaseUnits } from "../src/tokens/tokenRegistry.js";

test("resolves configured Sepolia tokens", () => {
  const usdc = resolveToken("USDC");

  assert.equal(usdc.chainId, 11155111);
  assert.equal(usdc.decimals, 6);
  assert.equal(usdc.address, "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238");
});

test("converts decimal token amounts to base units", () => {
  assert.equal(toBaseUnits("1.25", 6), "1250000");
  assert.equal(toBaseUnits("0.01", 18), "10000000000000000");
});

test("converts base units to decimal token amounts", () => {
  assert.equal(fromBaseUnits("1250000", 6), "1.25");
  assert.equal(fromBaseUnits("10000000000000000", 18), "0.01");
});

test("rejects unsupported token symbols", () => {
  assert.throws(() => resolveToken("DOGE"), /Unsupported token/);
});
