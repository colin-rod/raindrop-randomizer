import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const { id } = req.query;

  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  if (!id) {
    return res.status(400).json({ error: "Missing bookmark ID" });
  }

  const resp = await fetch(`https://api.raindrop.io/rest/v1/raindrop/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    return res.status(500).json({ error: "Failed to delete bookmark" });
  }

  return res.status(200).json({ success: true });
}