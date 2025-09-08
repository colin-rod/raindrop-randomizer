import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  
  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  const resp = await fetch("https://api.raindrop.io/rest/v1/collections", {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error(`Raindrop API error: ${resp.status} - ${errorText}`);
    return res.status(500).json({ 
      error: `Failed to fetch collections: ${resp.status} ${resp.statusText}`,
      details: errorText 
    });
  }

  const data = await resp.json();

  // Return id, title, and count
  const collections = data.items.map(c => ({
    id: c._id,
    title: c.title,
    count: c.count
  }));

  return res.status(200).json(collections);
}