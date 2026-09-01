import fetch from "node-fetch";

function buildEndpoint(collectionId, page, perpage) {
  const base = "https://api.raindrop.io/rest/v1/raindrops";
  if (collectionId === "0") {
    return `${base}/0?perpage=${perpage}&page=${page}`;
  }
  return `${base}/${collectionId}?perpage=${perpage}&page=${page}`;
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

  const normalizedCollectionId = String(collectionId);

  try {
    // Raindrop documents 50 as the maximum page size.
    const perpage = 50;

    // This used to stop at `page > 10`, so with more than ~1,100 bookmarks the
    // panel silently reported a truncated total as if it were the real one.
    // The API returns the true count on every response, so the headline figure
    // no longer depends on how much we managed to page through.
    const MAX_PAGES = 12;

    const fetchPage = async (page) => {
      const resp = await fetch(buildEndpoint(normalizedCollectionId, page, perpage), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return null;
      return resp.json();
    };

    const head = await fetchPage(0);
    if (!head) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }

    const reportedTotal = Number(head.count) || 0;
    const totalPages = Math.max(1, Math.ceil(reportedTotal / perpage));
    let items = head.items || [];

    const scannedPages = Math.min(totalPages, MAX_PAGES);
    for (let page = 1; page < scannedPages; page++) {
      const data = await fetchPage(page);
      if (!Array.isArray(data?.items) || data.items.length === 0) break;
      items = items.concat(data.items);
    }

    // The breakdown counts (videos, recent, unsorted) are derived from what we
    // actually read. When that is a sample rather than the whole collection we
    // scale them up and say so, instead of passing a partial count off as
    // complete.
    const sampled = items.length;
    const isSample = reportedTotal > sampled;
    const scale = isSample && sampled > 0 ? reportedTotal / sampled : 1;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const totals = items.reduce((acc, item) => {
      acc.totalItems += 1;

      if ((item.type || "").toLowerCase() === "video") {
        acc.videoItems += 1;
      }

      const collectionId = item.collection?.$id ?? item.collection?._id ?? item.collectionId;
      if (Number(collectionId) === -1) {
        acc.unsortedItems += 1;
      }

      const created = new Date(item.created);
      if (!Number.isNaN(created.getTime())) {
        const timestamp = created.getTime();
        if (timestamp >= sevenDaysAgo) {
          acc.last7Days += 1;
        }
        if (timestamp >= thirtyDaysAgo) {
          acc.last30Days += 1;
        }
      }

      return acc;
    }, {
      totalItems: 0,
      videoItems: 0,
      unsortedItems: 0,
      last7Days: 0,
      last30Days: 0
    });

    const scaled = value => (isSample ? Math.round(value * scale) : value);

    return res.status(200).json({
      totalItems: reportedTotal || totals.totalItems,
      videoItems: scaled(totals.videoItems),
      unsortedItems: scaled(totals.unsortedItems),
      last7Days: scaled(totals.last7Days),
      last30Days: scaled(totals.last30Days),
      sampled: isSample ? sampled : undefined,
      estimated: isSample || undefined
    });
  } catch (error) {
    console.error("Failed to compute filter stats", error);
    return res.status(500).json({ error: "Failed to compute filter stats" });
  }
}
