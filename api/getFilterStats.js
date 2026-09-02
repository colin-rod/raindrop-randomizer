import fetch from "node-fetch";

const BASE = "https://api.raindrop.io/rest/v1/raindrops";

/**
 * Every filtered raindrops query returns the total number of matches in its
 * `count` field, so an exact figure costs one request with perpage=1 — no
 * pagination, and nothing derived from a sample.
 *
 * This replaces scanning the newest 600 bookmarks and scaling the result up to
 * the library size. That produced numbers that looked precise and were not:
 * the scan is ordered by creation date, so the sample was the most recent
 * bookmarks, and scaling "how many were created in the last 7 days" from the
 * 600 newest overstates it enormously.
 */
export function buildStatQueries(collectionId, now = new Date()) {
  const id = String(collectionId ?? "0");
  const isAll = id === "0";

  const dayStamp = daysAgo => {
    const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  return {
    totalItems: { collection: id },
    videoItems: { collection: id, search: "type:video" },
    // "Unsorted" is collection -1. Within any real collection nothing is
    // unsorted, so there is nothing to ask.
    unsortedItems: isAll ? { collection: "-1" } : null,
    last7Days: { collection: id, search: `created:>${dayStamp(7)}` },
    last30Days: { collection: id, search: `created:>${dayStamp(30)}` },
  };
}

export function statUrl({ collection, search }) {
  const params = new URLSearchParams({ perpage: "1", page: "0" });
  if (search) params.set("search", search);
  return `${BASE}/${collection}?${params}`;
}

/**
 * A count we could not obtain is null, never a guess. The UI omits the number
 * entirely rather than showing one that might be wrong.
 */
export function assembleStats(results) {
  const out = {};
  let anyExact = false;

  for (const [key, value] of Object.entries(results)) {
    // Check for absence before coercing: Number(null) is 0, which would turn a
    // failed request into a confident count of zero.
    if (value === null || value === undefined || value === '') {
      out[key] = null;
      continue;
    }
    const n = Number(value);
    out[key] = Number.isFinite(n) && n >= 0 ? n : null;
    if (out[key] !== null) anyExact = true;
  }

  out.exact = anyExact;
  return out;
}

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const { collectionId } = req.query;

  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  if (!collectionId) {
    return res.status(400).json({ error: "Missing collectionId" });
  }

  const queries = buildStatQueries(collectionId);

  const countFor = async query => {
    if (!query) return 0;
    try {
      const resp = await fetch(statUrl(query), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) {
        console.warn(`Filter stats: ${resp.status} for ${query.search || "total"}`);
        return null;
      }
      const data = await resp.json();
      return Number.isFinite(Number(data.count)) ? Number(data.count) : null;
    } catch (error) {
      console.warn(`Filter stats failed for ${query.search || "total"}:`, error.message);
      return null;
    }
  };

  try {
    const entries = Object.entries(queries);
    const counts = await Promise.all(entries.map(([, query]) => countFor(query)));
    const stats = assembleStats(Object.fromEntries(
      entries.map(([key], i) => [key, counts[i]])
    ));

    if (stats.totalItems === null) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Failed to compute filter stats", error);
    return res.status(500).json({ error: "Failed to compute filter stats" });
  }
}
