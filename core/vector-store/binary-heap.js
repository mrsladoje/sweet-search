/**
 * Typed-array backed binary heaps for HNSW search (Fix 1).
 *
 * Zero object allocation — node indices and distances stored in parallel
 * Uint32Arrays. Hamming distances are integers, so Uint32 is exact.
 *
 * Two variants:
 *   TypedMinHeap — extract closest candidate (candidates queue)
 *   TypedMaxHeap — track furthest in result set, replaceMax when closer found
 *
 * Both heaps auto-grow when capacity is exceeded (CRITICAL-3 fix).
 */

// =============================================================================
// MIN-HEAP (candidates queue — extract closest first)
// =============================================================================

export class TypedMinHeap {
  constructor(capacity) {
    this.capacity = capacity;
    this.keys = new Uint32Array(capacity);   // node indices
    this.vals = new Uint32Array(capacity);   // distances (Hamming = integer)
    this.size = 0;
  }

  _grow() {
    const newCap = this.capacity * 2;
    const newKeys = new Uint32Array(newCap);
    const newVals = new Uint32Array(newCap);
    newKeys.set(this.keys);
    newVals.set(this.vals);
    this.keys = newKeys;
    this.vals = newVals;
    this.capacity = newCap;
  }

  insert(key, val) {
    if (this.size >= this.capacity) this._grow();
    const pos = this.size++;
    this.keys[pos] = key;
    this.vals[pos] = val;
    this._siftUp(pos);
  }

  peekVal() {
    return this.vals[0];
  }

  peekKey() {
    return this.keys[0];
  }

  extractMin() {
    const key = this.keys[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.vals[0] = this.vals[this.size];
      this._siftDown(0);
    }
    return key;
  }

  _siftUp(i) {
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (vals[i] >= vals[parent]) break;
      let tmp = keys[i]; keys[i] = keys[parent]; keys[parent] = tmp;
      tmp = vals[i]; vals[i] = vals[parent]; vals[parent] = tmp;
      i = parent;
    }
  }

  _siftDown(i) {
    const keys = this.keys, vals = this.vals, n = this.size;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && vals[left] < vals[smallest]) smallest = left;
      if (right < n && vals[right] < vals[smallest]) smallest = right;
      if (smallest === i) break;
      let tmp = keys[i]; keys[i] = keys[smallest]; keys[smallest] = tmp;
      tmp = vals[i]; vals[i] = vals[smallest]; vals[smallest] = tmp;
      i = smallest;
    }
  }

  clear() {
    this.size = 0;
  }
}

// =============================================================================
// MAX-HEAP (results buffer — peek furthest, replaceMax when closer found)
// =============================================================================

export class TypedMaxHeap {
  constructor(capacity) {
    this.capacity = capacity;
    this.keys = new Uint32Array(capacity);
    this.vals = new Uint32Array(capacity);
    this.size = 0;
  }

  _grow() {
    const newCap = this.capacity * 2;
    const newKeys = new Uint32Array(newCap);
    const newVals = new Uint32Array(newCap);
    newKeys.set(this.keys);
    newVals.set(this.vals);
    this.keys = newKeys;
    this.vals = newVals;
    this.capacity = newCap;
  }

  insert(key, val) {
    if (this.size >= this.capacity) this._grow();
    const pos = this.size++;
    this.keys[pos] = key;
    this.vals[pos] = val;
    this._siftUp(pos);
  }

  peekVal() {
    return this.vals[0];
  }

  peekKey() {
    return this.keys[0];
  }

  // Replace root (max) with new entry if new entry is closer
  replaceMax(key, val) {
    this.keys[0] = key;
    this.vals[0] = val;
    this._siftDown(0);
  }

  _siftUp(i) {
    const keys = this.keys, vals = this.vals;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (vals[i] <= vals[parent]) break;
      let tmp = keys[i]; keys[i] = keys[parent]; keys[parent] = tmp;
      tmp = vals[i]; vals[i] = vals[parent]; vals[parent] = tmp;
      i = parent;
    }
  }

  _siftDown(i) {
    const keys = this.keys, vals = this.vals, n = this.size;
    while (true) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && vals[left] > vals[largest]) largest = left;
      if (right < n && vals[right] > vals[largest]) largest = right;
      if (largest === i) break;
      let tmp = keys[i]; keys[i] = keys[largest]; keys[largest] = tmp;
      tmp = vals[i]; vals[i] = vals[largest]; vals[largest] = tmp;
      i = largest;
    }
  }

  // Drain heap into sorted order (ascending by distance). Destructive.
  // The returned keys/vals are POOLED buffers reused by the next drain —
  // callers must consume (or copy) them before draining again. Both call
  // sites (searchLayer/searchLayerQuery) box the entries immediately, so
  // this removes two typed-array allocations per query / per insert-level.
  drainSorted() {
    const n = this.size;
    if (!this._drainKeys || this._drainKeys.length < n) {
      const cap = Math.max(64, n);
      this._drainKeys = new Uint32Array(cap);
      this._drainVals = new Uint32Array(cap);
    }
    const resultKeys = this._drainKeys;
    const resultVals = this._drainVals;
    // Extract max repeatedly → fills from end → ascending order
    for (let i = n - 1; i >= 0; i--) {
      resultKeys[i] = this.keys[0];
      resultVals[i] = this.vals[0];
      this.size--;
      if (this.size > 0) {
        this.keys[0] = this.keys[this.size];
        this.vals[0] = this.vals[this.size];
        this._siftDown(0);
      }
    }
    return { keys: resultKeys, vals: resultVals, length: n };
  }

  clear() {
    this.size = 0;
  }
}

// =============================================================================
// GENERATION-STAMPED VISITED LIST (replaces new Set() per search)
// =============================================================================

export class VisitedList {
  constructor(maxElements) {
    this.stamps = new Uint32Array(maxElements);
    this.generation = 0;
    this.maxElements = maxElements;
  }

  reset() {
    this.generation++;
    // Wrap at 2^32 — extremely unlikely (4 billion searches)
    if (this.generation === 0) {
      this.stamps.fill(0);
      this.generation = 1;
    }
  }

  mark(idx) {
    this.stamps[idx] = this.generation;
  }

  isVisited(idx) {
    return this.stamps[idx] === this.generation;
  }

  // Grow if index is built incrementally beyond initial capacity
  ensureCapacity(needed) {
    if (needed <= this.maxElements) return;
    const newStamps = new Uint32Array(needed);
    newStamps.set(this.stamps);
    this.stamps = newStamps;
    this.maxElements = needed;
  }
}
