import fetch from "node-fetch";

/**
 * The tag vocabulary with usage counts.
 *
 * GET /rest/v1/tags/0 returns every tag across every collection in one call,
 * so the tag filter can offer real choices instead of asking people to
 * remember exact spellings and type them blind.
 *
 * Query params:
 *  - collectionId (optional): restrict to one collection; 0 / omitted = all
 *  - limit (optional): cap the number of tags returned (default 500)
 */
export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;

  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  const collectionId = String(req.query?.collectionId ?? "0");
  const limit = Math.min(Number(req.query?.limit) || 500, 2000);

  try {
    const resp = await fetch(`https://api.raindrop.io/rest/v1/tags/${collectionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      console.error(`Tags API error: ${resp.status}`);
      return res.status(500).json({ error: "Failed to fetch tags" });
    }

    const data = await resp.json();
    const tags = (data.items || [])
      .map(item => ({ tag: item._id, count: item.count ?? 0 }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).json({ tags, total: (data.items || []).length });
  } catch (error) {
    console.error("Failed to fetch tags", error);
    return res.status(500).json({ error: "Failed to fetch tags" });
  }
}
