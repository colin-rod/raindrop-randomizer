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
    const perpage = 100;
    let page = 0;
    let items = [];

    while (true) {
      const endpoint = buildEndpoint(normalizedCollectionId, page, perpage);
      const resp = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) {
        return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
      }

      const data = await resp.json();
      if (!Array.isArray(data.items) || data.items.length === 0) {
        break;
      }

      items = items.concat(data.items);
      page += 1;

      if (page > 10) {
        break;
      }
    }

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const totals = items.reduce((acc, item) => {
      acc.totalItems += 1;

      if ((item.type || "").toLowerCase() === "video") {
        acc.videoItems += 1;
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
      last7Days: 0,
      last30Days: 0
    });

    return res.status(200).json({
      totalItems: totals.totalItems,
      videoItems: totals.videoItems,
      last7Days: totals.last7Days,
      last30Days: totals.last30Days
    });
  } catch (error) {
    console.error("Failed to compute filter stats", error);
    return res.status(500).json({ error: "Failed to compute filter stats" });
  }
}
