import fetchAllRaindrops from "./_lib/fetchAllRaindrops.js";

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
    const items = await fetchAllRaindrops({
      token,
      collectionId: normalizedCollectionId,
      perpage: 100
    });

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

    return res.status(200).json({
      totalItems: totals.totalItems,
      videoItems: totals.videoItems,
      unsortedItems: totals.unsortedItems,
      last7Days: totals.last7Days,
      last30Days: totals.last30Days
    });
  } catch (error) {
    console.error("Failed to compute filter stats", error);
    return res.status(500).json({ error: "Failed to compute filter stats" });
  }
}
