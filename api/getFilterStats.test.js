// Tests for the filter-count query building and assembly.
//   node --test api/getFilterStats.test.js
//
// These numbers are shown to the user as exact counts, so the rule the tests
// enforce is: a count we could not obtain is null, never an estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatQueries, statUrl, assembleStats } from './getFilterStats.js';

const NOW = new Date('2026-09-01T12:00:00Z');

test('every count is asked of the API directly, with perpage=1', () => {
  const q = buildStatQueries('0', NOW);
  // perpage=1 because we only want the `count` field, never the items.
  assert.match(statUrl(q.totalItems), /\/raindrops\/0\?perpage=1&page=0$/);
  assert.match(statUrl(q.videoItems), /search=type%3Avideo/);
});

test('date windows are asked as a search, not derived from a sample', () => {
  const q = buildStatQueries('0', NOW);
  // 7 days before 2026-09-01 is 2026-08-25.
  assert.match(decodeURIComponent(statUrl(q.last7Days)), /search=created:>2026-08-25/);
  assert.match(decodeURIComponent(statUrl(q.last30Days)), /search=created:>2026-08-02/);
});

test('unsorted is collection -1 for the whole library', () => {
  const q = buildStatQueries('0', NOW);
  assert.equal(q.unsortedItems.collection, '-1');
});

test('nothing inside a real collection is unsorted, so we do not ask', () => {
  const q = buildStatQueries('59437707', NOW);
  assert.equal(q.unsortedItems, null, 'no query for an impossible count');
  assert.equal(q.totalItems.collection, '59437707');
});

test('a count that could not be fetched is null, not a guess', () => {
  const stats = assembleStats({ totalItems: 2322, videoItems: null, unsortedItems: 62 });
  assert.equal(stats.totalItems, 2322);
  assert.equal(stats.videoItems, null, 'the UI must omit this, not invent it');
  assert.equal(stats.unsortedItems, 62);
});

test('nonsense values are rejected rather than displayed', () => {
  const stats = assembleStats({ totalItems: 'many', videoItems: -3, unsortedItems: undefined });
  assert.equal(stats.totalItems, null);
  assert.equal(stats.videoItems, null, 'a negative count is not a count');
  assert.equal(stats.unsortedItems, null);
  assert.equal(stats.exact, false);
});

test('zero is a real answer and survives', () => {
  const stats = assembleStats({ totalItems: 0, videoItems: 0 });
  assert.equal(stats.totalItems, 0);
  assert.equal(stats.videoItems, 0);
  assert.equal(stats.exact, true, 'zero is exact, not missing');
});

test('the video count is no longer scaled from a sample', () => {
  // Regression guard: the previous implementation scanned the newest 600
  // bookmarks and multiplied, reporting 887 videos out of 2322 from a sample
  // biased toward recent items. Whatever the API says is what we report.
  const stats = assembleStats({ totalItems: 2322, videoItems: 231 });
  assert.equal(stats.videoItems, 231, 'reported verbatim, never multiplied up');
});
