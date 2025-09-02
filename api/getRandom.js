import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const { collectionId } = req.query;

  if (!collectionId) {
    return res.status(400).json({ error: "Missing collectionId" });
  }

  // Fetch bookmarks from given collection
  let page = 0;
  const perpage = 100;
  let all = [];

  while (true) {
    const resp = await fetch(
      `https://api.raindrop.io/rest/v1/raindrops/${collectionId}?perpage=${perpage}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await resp.json();
    if (!data.items.length) break;
    all = all.concat(data.items);
    page++;
    if (page > 10) break; // safety cap
  }

  if (!all.length) {
    return res.status(200).json({ error: "No bookmarks in this collection" });
  }

  const random = all[Math.floor(Math.random() * all.length)];
  return res.status(200).json(random);
}