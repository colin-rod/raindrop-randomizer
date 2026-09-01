import fetch from "node-fetch";

/**
 * Supported query parameters:
 *  - collectionId (required): Raindrop collection identifier ("0" for all collections)
 *  - lengthFilter (optional): "all" | "short" | "medium" | "long"
 *  - typeFilter (optional): comma-separated content filters: "all", "video", "unsorted"
 *  - tagFilter (optional): case-insensitive tag value to match
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

  // Raindrop documents 50 as the maximum page size; asking for 100 silently
  // gave us half the page we thought we were getting.
  const perpage = 50;

  // A hard `if (page > 10) break` used to cap this loop, so with a library
  // larger than a few hundred bookmarks everything past the cap was unreachable
  // by the random pick -- roughly half the library at 2,000+ bookmarks. How we
  // avoid it depends on whether anything needs filtering client-side.
  const anyFilterActive = Boolean(
    (lengthFilter && lengthFilter !== 'all') ||
    (typeFilter && !/^all$/i.test(String(typeFilter).trim())) ||
    (tagFilter && String(tagFilter).trim()) ||
    (dateFilter && dateFilter !== 'any') ||
    startDate || endDate || addedAfter || addedBefore
  );

  const endpointFor = (page, size) => {
    const base = collectionId === "0"
      ? `https://api.raindrop.io/rest/v1/raindrops/0`
      : `https://api.raindrop.io/rest/v1/raindrops/${collectionId}`;
    return `${base}?perpage=${size}&page=${page}`;
  };

  const fetchPage = async (page, size = perpage) => {
    const resp = await fetch(endpointFor(page, size), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    return resp.json();
  };

  let all = [];

  if (!anyFilterActive) {
    // Nothing to filter, so there is no reason to page through the collection
    // at all: read the total, pick an index, fetch just that one bookmark.
    // Two requests regardless of library size, and no reachability ceiling.
    const head = await fetchPage(0, 1);
    if (!head) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }

    const total = Number(head.count) || head.items?.length || 0;
    if (!total) {
      return res.status(200).json({ error: "No bookmarks in this collection" });
    }

    const index = Math.floor(Math.random() * total);
    const hit = await fetchPage(index, 1);
    if (!hit?.items?.length) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }
    all = hit.items;
  } else {
    // Filters are evaluated client-side, so we do need bookmarks in hand.
    // Scan the whole collection when it is small enough to finish inside the
    // function's time budget; otherwise sample random pages, which keeps every
    // bookmark reachable however large the library grows.
    const MAX_PAGES = 12;

    const head = await fetchPage(0);
    if (!head) {
      return res.status(500).json({ error: "Failed to fetch bookmarks from collection" });
    }

    const total = Number(head.count) || head.items?.length || 0;
    const totalPages = Math.max(1, Math.ceil(total / perpage));
    all = head.items || [];

    if (totalPages <= MAX_PAGES) {
      // Small enough to be exact -- "no results" genuinely means no results.
      for (let page = 1; page < totalPages; page++) {
        const data = await fetchPage(page);
        if (!data?.items?.length) break;
        all = all.concat(data.items);
      }
    } else {
      const seen = new Set([0]);
      let attempts = 0;
      while (seen.size < MAX_PAGES && attempts < MAX_PAGES * 4) {
        attempts++;
        const page = Math.floor(Math.random() * totalPages);
        if (seen.has(page)) continue;
        seen.add(page);

        const data = await fetchPage(page);
        if (!data?.items?.length) continue;
        all = all.concat(data.items);
      }
    }
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

  const parseTypeFilters = (value) => {
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
  };

  const requestedTypeFilters = parseTypeFilters(typeFilter);
  const hasAllTypeFilter = requestedTypeFilters.includes('all');
  const normalizedTypeFilters = [...new Set(requestedTypeFilters.filter(value => value !== 'all'))];

  if (normalizedTypeFilters.some(value => !['video', 'unsorted'].includes(value))) {
    return res.status(400).json({ error: `Unsupported typeFilter value: ${typeFilter}` });
  }

  const isContentFilterActive = normalizedTypeFilters.length > 0 && !hasAllTypeFilter;

  let filteredBookmarks = enrichedBookmarks;
  if (isLengthFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark =>
      bookmark.lengthEstimate.category.toLowerCase() === normalizedLength
    );
  }

  if (isContentFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark => {
      const isVideo = (bookmark.type || '').toLowerCase() === 'video';
      const collectionId = bookmark.collection?.$id ?? bookmark.collection?._id ?? bookmark.collectionId;
      const isUnsorted = Number(collectionId) === -1;

      if (normalizedTypeFilters.includes('video') && !isVideo) {
        return false;
      }
      if (normalizedTypeFilters.includes('unsorted') && !isUnsorted) {
        return false;
      }
      return true;
    });
  }

  const normalizedTagFilter = (tagFilter || '').trim().toLowerCase();
  const isTagFilterActive = normalizedTagFilter.length > 0;

  if (isTagFilterActive) {
    filteredBookmarks = filteredBookmarks.filter(bookmark =>
      Array.isArray(bookmark.tags) &&
      bookmark.tags.some(tag =>
        typeof tag === 'string' && tag.toLowerCase() === normalizedTagFilter
      )
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
      const hasVideoFilter = normalizedTypeFilters.includes('video');
      const hasUnsortedFilter = normalizedTypeFilters.includes('unsorted');
      if (hasVideoFilter && hasUnsortedFilter) {
        return res.status(200).json({ error: 'No unsorted video bookmarks available with both filters enabled' });
      }
      if (hasVideoFilter) {
        return res.status(200).json({ error: 'No video bookmarks available with the video filter enabled' });
      }
      if (hasUnsortedFilter) {
        return res.status(200).json({ error: 'No unsorted bookmarks available with the unsorted filter enabled' });
      }
      return res.status(200).json({ error: 'No bookmarks available with the selected content filter enabled' });
    }
    if (isTagFilterActive) {
      return res.status(200).json({ error: `No bookmarks found with tag "${tagFilter}"` });
    }
    return res.status(200).json({ error: 'No bookmarks available' });
  }

  const random = filteredBookmarks[Math.floor(Math.random() * filteredBookmarks.length)];

  return res.status(200).json(random);
}