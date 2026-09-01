// Regression tests for collection listing.
//   node --test api/getCollections.test.js
//
// A duplicated collection is not just a cosmetic repeat in the picker: the UI
// computes "All Collections (N)" by summing these counts, so one duplicate
// silently inflates the reported size of the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCollections } from './getCollections.js';

const collection = (id, title, count, parent) => ({
  _id: id, title, count, ...(parent ? { parent: { $id: parent } } : {})
});

// The nine collections the classifier manages, with their real counts.
const NINE = [
  ['Global & Cultural', 47], ['Finance & Economics', 103], ['Lifestyle & Practical', 183],
  ['Politics & Current Affairs', 130], ['Career & Professional Development', 146],
  ['Business & Startups', 223], ['Entertainment & Media', 896], ['AI & Technology', 576],
  ['Others', 13],
].map(([title, count], i) => collection(100 + i, title, count));

const REAL_TOTAL = 2317;

// The UI's own calculation, mirrored so the assertion means what it says.
const uiTotal = list => list.reduce((sum, c) => sum + (c.count || 0), 0);

test('a collection returned by both endpoints is listed once', () => {
  // Exactly the shipped bug: /collections/childrens echoed the same nine.
  const out = mergeCollections(NINE, NINE);

  assert.equal(out.length, 9, 'nine collections, not eighteen');
  const ids = out.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('the summed total is not doubled', () => {
  assert.equal(uiTotal(mergeCollections(NINE, NINE)), REAL_TOTAL, 'must be 2317, not 4634');
});

test('genuine children are included and prefixed with their parent', () => {
  const out = mergeCollections(
    [collection(1, 'Reading', 10)],
    [collection(2, 'Fiction', 4, 1)]
  );

  assert.deepEqual(out.map(c => c.title), ['Reading', 'Reading / Fiction']);
  assert.equal(uiTotal(out), 14, 'a real child contributes its own count');
});

test('a child whose parent is unknown keeps its bare title', () => {
  const out = mergeCollections(
    [collection(1, 'Reading', 10)],
    [collection(9, 'Orphan', 2, 999)]
  );
  assert.deepEqual(out.map(c => c.title), ['Reading', 'Orphan']);
});

test('root collections still list when the children endpoint fails', () => {
  // childrenData is null when that request 404s or errors.
  const out = mergeCollections(NINE, undefined);
  assert.equal(out.length, 9);
  assert.equal(uiTotal(out), REAL_TOTAL);
});

test('the root entry wins when both endpoints describe a collection', () => {
  // Root is authoritative: a child echo must not overwrite the title with a
  // prefixed duplicate, nor its count.
  const out = mergeCollections(
    [collection(1, 'Reading', 10)],
    [collection(1, 'Reading', 999, 1)]
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 1, title: 'Reading', count: 10 });
});

test('counts fall back to user stats when a collection omits one', () => {
  const out = mergeCollections(
    [{ _id: 5, title: 'No Count' }],
    [],
    new Map([[5, 42]])
  );
  assert.equal(out[0].count, 42);
});

test('malformed entries are skipped rather than listed as blanks', () => {
  const out = mergeCollections([null, { title: 'No Id' }, collection(1, 'Real', 3)], []);
  assert.deepEqual(out.map(c => c.title), ['Real']);
});
