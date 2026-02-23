import fetch from "node-fetch";

function buildEndpoint(collectionId, page, perpage) {
  const base = "https://api.raindrop.io/rest/v1/raindrops";
  if (collectionId === "0") {
    return `${base}/0?perpage=${perpage}&page=${page}`;
  }
  return `${base}/${collectionId}?perpage=${perpage}&page=${page}`;
}

function parseMaxPages(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function fetchAllRaindrops({ token, collectionId, perpage = 100 }) {
  const normalizedCollectionId = String(collectionId);
  const maxPages = parseMaxPages(process.env.MAX_RAINDROP_PAGES);

  let page = 0;
  const items = [];

  while (true) {
    const endpoint = buildEndpoint(normalizedCollectionId, page, perpage);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch bookmarks from collection (status ${response.status})`);
    }

    const data = await response.json();
    const pageItems = Array.isArray(data.items) ? data.items : [];

    if (pageItems.length === 0) {
      break;
    }

    items.push(...pageItems);

    if (pageItems.length < perpage) {
      break;
    }

    page += 1;

    if (maxPages && page >= maxPages) {
      console.warn(
        `MAX_RAINDROP_PAGES limit hit at page ${page} for collection ${normalizedCollectionId}. Returning partial results.`
      );
      break;
    }
  }

  return items;
}
