import fetch from "node-fetch";

export default async function handler(req, res) {
  const token = process.env.RAINDROP_TOKEN;
  const { collectionId, lengthFilter } = req.query;

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

  // Filter by length if specified
  let filteredBookmarks = enrichedBookmarks;
  if (lengthFilter && lengthFilter !== 'all') {
    filteredBookmarks = enrichedBookmarks.filter(bookmark => 
      bookmark.lengthEstimate.category.toLowerCase() === lengthFilter.toLowerCase()
    );
  }

  if (!filteredBookmarks.length) {
    return res.status(200).json({ error: `No ${lengthFilter} articles found in this collection` });
  }

  const random = filteredBookmarks[Math.floor(Math.random() * filteredBookmarks.length)];
  
  return res.status(200).json(random);
}