import fetch from "node-fetch";

/**
 * Supported query parameters:
 *  - collectionId (required): Raindrop collection identifier ("0" for all collections)
 *  - lengthFilter (optional): "all" | "short" | "medium" | "long"
 *  - typeFilter (optional): "all" | "video"
 *  - dateFilter (optional): "any" | "last7" | "last30" | "custom"
 *  - startDate / endDate (optional): ISO date strings used with dateFilter=custom
 *  - addedAfter / addedBefore (optional aliases for startDate/endDate)
 */
export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const {
    collectionId,
    lengthFilter,
    typeFilter,
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

  // Fetch bookmarks from given collection (0 = all collections)
  let page = 0;
  const perpage = 100;
  let all = [];

  while (true) {
    const endpoint = collectionId === "0" 
      ? `https://api.raindrop.io/rest/v1/raindrops/0?perpage=${perpage}&page=${page}`
      : `https://api.raindrop.io/rest/v1/raindrops/${collectionId}?perpage=${perpage}&page=${page}`;
      
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!resp.ok) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }
    
    const data = await resp.json();
    if (!data.items.length) break;
    all = all.concat(data.items);
    page++;
    if (page > 10) break; // safety cap
  }

  if (!all.length) {
    return res.status(200).json({ error: "No bookmarks in this collection" });
  }

  // Add article length estimation to all bookmarks
  const estimateLength = (bookmark) => {
    // Use excerpt length as a proxy for article length
    const excerptLength = (bookmark.excerpt || '').length;
    const hasNote = (bookmark.note || '').length > 0;
    
    // Rough estimation based on excerpt length
    // Assuming excerpt is about 10-20% of full article
    let estimatedWords = Math.round(excerptLength * 0.15); // rough word count from excerpt
    
    // Boost estimate for articles vs other content types
    if (bookmark.type === 'article') {
      estimatedWords = Math.max(estimatedWords, 200); // minimum for articles
      estimatedWords = Math.round(estimatedWords * 5); // articles likely longer than excerpt suggests
    }
    
    // Add bonus for having notes (suggests more substantial content)
    if (hasNote) {
      estimatedWords = Math.round(estimatedWords * 1.2);
    }
    
    // Categorize length
    if (estimatedWords < 500) return { category: 'Short', words: estimatedWords, readTime: '1-2 min' };
    if (estimatedWords < 1500) return { category: 'Medium', words: estimatedWords, readTime: '3-6 min' };
    return { category: 'Long', words: estimatedWords, readTime: '7+ min' };
  };

  // Add length estimates to all bookmarks
  const enrichedBookmarks = all.map(bookmark => ({
    ...bookmark,
    lengthEstimate: estimateLength(bookmark)
  }));

  const isLengthFilterActive = Boolean(lengthFilter && lengthFilter !== 'all');
  const normalizedLength = lengthFilter ? lengthFilter.toLowerCase() : 'all';

  const normalizedType = (typeFilter || 'all').toLowerCase();
  if (!['all', 'video'].includes(normalizedType)) {
    return res.status(400).json({ error: `Unsupported typeFilter value: ${typeFilter}` });
  }
  const isContentFilterActive = normalizedType !== 'all';

  let filteredBookmarks = enrichedBookmarks;
  if (isLengthFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark =>
      bookmark.lengthEstimate.category.toLowerCase() === normalizedLength
    );
  }

  if (isContentFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark =>
      (bookmark.type || '').toLowerCase() === 'video'
    );
  }

  const now = new Date();
  let rangeStart = null;
  let rangeEnd = null;

  const preset = (dateFilter || '').toLowerCase();
  if (preset && preset !== 'any') {
    if (preset === 'last7') {
      rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (preset === 'last30') {
      rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (preset !== 'custom') {
      return res.status(400).json({ error: `Unsupported dateFilter value: ${dateFilter}` });
    }
  }

  const parseDateOnly = (value, isEnd = false) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    if (!Number.isNaN(parsed.getTime()) && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      if (isEnd) {
        parsed.setHours(23, 59, 59, 999);
      } else {
        parsed.setHours(0, 0, 0, 0);
      }
    }
    return parsed;
  };

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

  const isDateFilterActive = Boolean(rangeStart || rangeEnd);

  if (isDateFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark => {
      const createdDate = new Date(bookmark.created);
      if (Number.isNaN(createdDate.getTime())) {
        return false;
      }
      if (rangeStart && createdDate < rangeStart) {
        return false;
      }
      if (rangeEnd && createdDate > rangeEnd) {
        return false;
      }
      return true;
    });
  }

  if (!filteredBookmarks.length) {
    if (isDateFilterActive) {
      return res.status(200).json({ error: 'No bookmarks in this date range' });
    }
    if (isLengthFilterActive) {
      return res.status(200).json({ error: `No ${lengthFilter} articles found in this collection` });
    }
    if (isContentFilterActive) {
      return res.status(200).json({ error: 'No video bookmarks available with the video filter enabled' });
    }
    return res.status(200).json({ error: 'No bookmarks available' });
  }

  const random = filteredBookmarks[Math.floor(Math.random() * filteredBookmarks.length)];

  return res.status(200).json(random);
}