import fetch from "node-fetch";

/**
 * Combine root and nested collections into one list.
 *
 * /collections and /collections/childrens can return the SAME collection.
 * Concatenating them blindly listed every collection twice in the picker and
 * doubled the "All Collections" total, which the UI computes by summing these
 * counts. Deduplicate by id, first writer wins, so a collection appears once
 * whichever endpoint reported it.
 *
 * Exported so the dedup can be tested without standing up the HTTP handler.
 */
export function mergeCollections(rootItems, childItems, statsMap = new Map()) {
  const root = Array.isArray(rootItems) ? rootItems : [];
  const children = Array.isArray(childItems) ? childItems : [];

  // Guard here too, not just in add() below: this map is built first, so a
  // malformed entry would throw before the per-item check ever ran.
  const rootTitles = new Map(
    root.filter(c => c?._id != null).map(c => [c._id, c.title])
  );
  const byId = new Map();

  const add = (c, isChild) => {
    if (c?._id == null || byId.has(c._id)) return;

    // Only prefix a genuine child whose parent we can actually name; an
    // unresolvable parent would otherwise produce a bare duplicate title.
    const parentId = c.parent?.$id ?? c.parent?._id;
    const parentTitle = isChild && parentId != null ? rootTitles.get(parentId) : null;

    byId.set(c._id, {
      id: c._id,
      title: parentTitle ? `${parentTitle} / ${c.title}` : c.title,
      count: c.count ?? statsMap.get(c._id) ?? 0
    });
  };

  root.forEach(c => add(c, false));
  children.forEach(c => add(c, true));

  return [...byId.values()];
}

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  
  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  try {
    // Fetch both user collections and system stats in parallel
    // /collections returns root collections only. Nested ones live behind
    // /collections/childrens, so without it any bookmark filed in a sub-collection
    // was missing from the picker entirely.
    const [collectionsResp, childrenResp, statsResp] = await Promise.all([
      fetch("https://api.raindrop.io/rest/v1/collections", {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch("https://api.raindrop.io/rest/v1/collections/childrens", {
        headers: { Authorization: `Bearer ${token}` }
      }),
      fetch("https://api.raindrop.io/rest/v1/user/stats", {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    if (!collectionsResp.ok) {
      const errorText = await collectionsResp.text();
      console.error(`Collections API error: ${collectionsResp.status} - ${errorText}`);
      return res.status(500).json({ 
        error: `Failed to fetch collections: ${collectionsResp.status} ${collectionsResp.statusText}`,
        details: errorText 
      });
    }

    if (!statsResp.ok) {
      console.warn(`Stats API error: ${statsResp.status} - but continuing with collections only`);
    }

    const collectionsData = await collectionsResp.json();
    const childrenData = childrenResp.ok ? await childrenResp.json() : null;
    const statsData = statsResp.ok ? await statsResp.json() : null;

    if (!childrenResp.ok) {
      console.warn(`Child collections API error: ${childrenResp.status} - continuing with root collections only`);
    }

    // Debug logging
    if (collectionsData.items && collectionsData.items.length > 0) {
      const first = collectionsData.items[0];
      console.log('Collection fields:', Object.keys(first));
      console.log('Count field value:', first.count);
    }

    if (statsData) {
      console.log('Stats data:', statsData.items?.map(s => ({ id: s._id, count: s.count })));
    }

    // Create a map of collection IDs to counts from stats
    const statsMap = new Map();
    if (statsData?.items) {
      statsData.items.forEach(stat => {
        statsMap.set(stat._id, stat.count);
      });
    }

    const collections = mergeCollections(
      collectionsData.items,
      childrenData?.items,
      statsMap
    );

    return res.status(200).json(collections);
    
  } catch (error) {
    console.error('Error fetching collections:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}