import fetch from "node-fetch";

function buildEndpoint(collectionId, page, perpage) {
  const base = "https://api.raindrop.io/rest/v1/raindrops";
  if (collectionId === "0") {
    return `${base}/0?perpage=${perpage}&page=${page}`;
  }
  return `${base}/${collectionId}?perpage=${perpage}&page=${page}`;
}

function parseTypeFilters(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap(entry => String(entry || '').split(','))
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function estimateLength(bookmark) {
  const excerptLength = (bookmark.excerpt || '').length;
  const hasNote = (bookmark.note || '').length > 0;

  let estimatedWords = Math.round(excerptLength * 0.15);

  if (bookmark.type === 'article') {
    estimatedWords = Math.max(estimatedWords, 200);
    estimatedWords = Math.round(estimatedWords * 5);
  }

  if (hasNote) {
    estimatedWords = Math.round(estimatedWords * 1.2);
  }

  if (estimatedWords < 500) return 'short';
  if (estimatedWords < 1500) return 'medium';
  return 'long';
}

function parseDateOnly(value, isEnd = false) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (isEnd) {
      parsed.setHours(23, 59, 59, 999);
    } else {
      parsed.setHours(0, 0, 0, 0);
    }
  }

  return parsed;
}

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const {
    collectionId,
    lengthFilter,
    typeFilter,
    tagFilter,
    dateFilter,
    startDate,
    endDate,
    addedAfter,
    addedBefore
  } = req.query;

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

    const normalizedLength = String(lengthFilter || 'all').toLowerCase();
    if (!['all', 'short', 'medium', 'long'].includes(normalizedLength)) {
      return res.status(400).json({ error: `Unsupported lengthFilter value: ${lengthFilter}` });
    }

    const requestedTypeFilters = parseTypeFilters(typeFilter);
    const hasAllTypeFilter = requestedTypeFilters.includes('all');
    const normalizedTypeFilters = [...new Set(requestedTypeFilters.filter(value => value !== 'all'))];

    if (normalizedTypeFilters.some(value => !['video', 'unsorted'].includes(value))) {
      return res.status(400).json({ error: `Unsupported typeFilter value: ${typeFilter}` });
    }

    const normalizedTagFilter = String(tagFilter || '').trim().toLowerCase();

    const nowDate = new Date();
    let rangeStart = null;
    let rangeEnd = null;
    const preset = String(dateFilter || '').toLowerCase();

    if (preset && preset !== 'any') {
      if (preset === 'last7') {
        rangeStart = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (preset === 'last30') {
        rangeStart = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (preset !== 'custom') {
        return res.status(400).json({ error: `Unsupported dateFilter value: ${dateFilter}` });
      }
    }

    const startCandidate = startDate || addedAfter || null;
    const endCandidate = endDate || addedBefore || null;

    if (preset === 'custom' || startCandidate) {
      if (startCandidate) {
        const parsedStart = parseDateOnly(startCandidate);
        if (!parsedStart) {
          return res.status(400).json({ error: 'Invalid start date provided' });
        }
        rangeStart = parsedStart;
      } else if (preset === 'custom' && !endCandidate) {
        return res.status(400).json({ error: 'Custom date filter requires a start or end date' });
      }
    }

    if (preset === 'custom' || endCandidate) {
      if (endCandidate) {
        const parsedEnd = parseDateOnly(endCandidate, true);
        if (!parsedEnd) {
          return res.status(400).json({ error: 'Invalid end date provided' });
        }
        rangeEnd = parsedEnd;
      }
    }

    if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const filteredItems = items.filter(item => {
      if (normalizedLength !== 'all' && estimateLength(item) !== normalizedLength) {
        return false;
      }

      if (normalizedTypeFilters.length > 0 && !hasAllTypeFilter) {
        const isVideo = (item.type || '').toLowerCase() === 'video';
        const itemCollectionId = item.collection?.$id ?? item.collection?._id ?? item.collectionId;
        const isUnsorted = Number(itemCollectionId) === -1;

        if (normalizedTypeFilters.includes('video') && !isVideo) {
          return false;
        }
        if (normalizedTypeFilters.includes('unsorted') && !isUnsorted) {
          return false;
        }
      }

      if (normalizedTagFilter) {
        const hasTag = Array.isArray(item.tags)
          && item.tags.some(tag => typeof tag === 'string' && tag.toLowerCase() === normalizedTagFilter);
        if (!hasTag) {
          return false;
        }
      }

      if (rangeStart || rangeEnd) {
        const createdDate = new Date(item.created);
        if (Number.isNaN(createdDate.getTime())) {
          return false;
        }
        if (rangeStart && createdDate < rangeStart) {
          return false;
        }
        if (rangeEnd && createdDate > rangeEnd) {
          return false;
        }
      }

      return true;
    });

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const totals = filteredItems.reduce((acc, item) => {
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
