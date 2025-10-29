import fetch from "node-fetch";

async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.RAINDROP_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "RAINDROP_TOKEN environment variable is not configured" });
  }

  let body;
  try {
    body = await parseRequestBody(req);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to parse request body" });
  }

  const { id, title, tags, collectionId } = body;

  if (!id) {
    return res.status(400).json({ error: "Missing bookmark ID" });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Title is required" });
  }

  const payload = { title: title.trim() };

  if (Array.isArray(tags)) {
    payload.tags = tags;
  }

  if (collectionId !== undefined && collectionId !== null && collectionId !== "") {
    const numericId = Number(collectionId);
    payload.collectionId = Number.isNaN(numericId) ? collectionId : numericId;
  }

  try {
    const response = await fetch(`https://api.raindrop.io/rest/v1/raindrop/${id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (parseError) {
      console.error("Failed to parse update response:", parseError);
    }

    if (!response.ok) {
      const message = data?.error || `Failed to update bookmark: ${response.status}`;
      return res.status(response.status || 500).json({ error: message, details: text });
    }

    return res.status(200).json(data?.item || data || {});
  } catch (error) {
    console.error("Error updating bookmark:", error);
    return res.status(500).json({ error: "Failed to update bookmark" });
  }
}
