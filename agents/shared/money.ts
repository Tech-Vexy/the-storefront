import { ethers } from "ethers";

export const KITE_DECIMALS = 18;

// Default gas budget reserved when checking spendable balance.
// 0.01 KITE is generous for a single settleOrder call on testnet.
export const GAS_RESERVE_WEI = ethers.parseEther("0.01");

/**
 * Convert a decimal KITE quantity to bigint wei.
 *
 * Handles JS quirks the obvious approach (parseEther(x.toString()))
 * gets wrong:
 *  - scientific notation: (1e-7).toString() === "1e-7" → parseEther throws
 *  - more than 18 fractional digits: rounded down (truncated), not rejected
 *  - bigint passthrough: returns input unchanged
 *
 * Throws on NaN, Infinity, negative values, or non-numeric strings.
 */
export function kiteToWei(input: string | number | bigint): bigint {
  if (typeof input === "bigint") {
    if (input < 0n) throw new RangeError("kiteToWei: negative");
    return input;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new RangeError(`kiteToWei: non-finite ${input}`);
    if (input < 0) throw new RangeError(`kiteToWei: negative ${input}`);
    // toFixed(18) avoids scientific notation and caps fractional digits at 18.
    // We then trim trailing zeros so parseUnits doesn't see "1.000000000000000000".
    let s = input.toFixed(KITE_DECIMALS);
    s = s.replace(/\.?0+$/, "");
    if (s === "" || s === "-") s = "0";
    return ethers.parseUnits(s, KITE_DECIMALS);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) throw new RangeError("kiteToWei: empty string");
    if (/^-/.test(trimmed)) throw new RangeError(`kiteToWei: negative ${trimmed}`);
    // Reject scientific notation explicitly — ethers.parseUnits can't take it.
    if (/[eE]/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) throw new RangeError(`kiteToWei: bad number ${trimmed}`);
      return kiteToWei(n);
    }
    return ethers.parseUnits(trimmed, KITE_DECIMALS);
  }
  throw new TypeError(`kiteToWei: unsupported type ${typeof input}`);
}

/**
 * Format wei as a decimal KITE string for display only.
 * Trims trailing zeros so "1.500000000000000000" becomes "1.5".
 */
export function weiToKite(wei: bigint): string {
  const formatted = ethers.formatUnits(wei, KITE_DECIMALS);
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/\.?0+$/, "");
}

/**
 * unitWei × qty without going through float.
 * qty must be a non-negative integer.
 */
export function mulWei(unitWei: bigint, qty: number | bigint): bigint {
  if (unitWei < 0n) throw new RangeError("mulWei: negative unitWei");
  let q: bigint;
  if (typeof qty === "bigint") {
    q = qty;
  } else {
    if (!Number.isInteger(qty)) throw new RangeError(`mulWei: qty must be integer, got ${qty}`);
    q = BigInt(qty);
  }
  if (q < 0n) throw new RangeError("mulWei: negative qty");
  return unitWei * q;
}
