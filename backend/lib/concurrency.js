/**
 * Runs `fn` over `items` with at most `limit` in flight at once.
 *
 * At low order volume a plain sequential loop calling an external API
 * (DTDC) per item is fine. At the "lakhs of orders" volume this system is
 * built for, a batch of thousands of pending bookings/tracking-lookups
 * processed one-at-a-time would take too long to finish before the next
 * scheduled run starts. This caps concurrency instead of firing everything
 * at once (which would just trade one bottleneck for hammering DTDC's API).
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = { mapWithConcurrency };
