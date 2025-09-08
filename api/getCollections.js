import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  
  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  try {
    // Fetch both user collections and system stats in parallel
    const [collectionsResp, statsResp] = await Promise.all([
      fetch("https://api.raindrop.io/rest/v1/collections", {
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
    const statsData = statsResp.ok ? await statsResp.json() : null;

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

    // Process user collections
    const collections = collectionsData.items.map(c => ({
      id: c._id,
      title: c.title,
      count: c.count ?? statsMap.get(c._id) ?? 0
    }));

    return res.status(200).json(collections);
    
  } catch (error) {
    console.error('Error fetching collections:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}