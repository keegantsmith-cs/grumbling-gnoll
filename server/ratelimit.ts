// Simple in-memory limits so nobody can guess passwords or invite codes by trying thousands of times.
import { HttpError } from "./helpers.ts";

const hits = new Map<string, number[]>();

/** Throws 429 if `key` already has `max` hits within `windowMs`. Call `hit` to count an attempt. */
export function checkLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, list);
  if (list.length >= max) {
    const wait = Math.ceil((windowMs - (now - list[0])) / 60000);
    throw new HttpError(429, `Too many attempts. Please wait ${wait} minute${wait === 1 ? "" : "s"} and try again.`);
  }
}
export function hit(key: string) {
  const list = hits.get(key) ?? [];
  list.push(Date.now());
  hits.set(key, list);
}
export function clearLimit(key: string) {
  hits.delete(key);
}

// Forget old entries now and then
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();
