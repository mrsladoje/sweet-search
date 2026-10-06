# Rivals with a build-budget grid: each library builds HNSW from the full 768-d
# floats at its default budget and at ours (M=64, efC=800). efSearch is swept
# until recall@10 vs exact >= 0.999 or p50 > 15 ms. Reports build time (12
# threads), index bytes, p50/p99 (1 thread), recall@10 vs exact kNN, MRR@10.
# Aggregate output only. usage: python theirs3.py <name>
import json, sys, time, gc, os, tempfile, numpy as np, faiss, hnswlib
from usearch.index import Index
name = sys.argv[1]
meta = json.load(open(f'{name}/meta.json')); ours = json.load(open(f'{name}/ours.json'))
d = meta['dim']
X = np.fromfile(f'{name}/corpus768.bin', dtype=np.float32).reshape(-1, d)
Q = np.fromfile(f'{name}/q768.bin', dtype=np.float32).reshape(-1, d)
X /= np.linalg.norm(X, axis=1, keepdims=True); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
n, nq = len(X), len(Q)
GT = np.empty((nq, 10), dtype=np.int64)
for b in range(0, nq, 256):
    S = Q[b:b+256] @ X.T; P = np.argpartition(-S, 10, axis=1)[:, :10]
    GT[b:b+256] = np.take_along_axis(P, np.argsort(-np.take_along_axis(S, P, 1), 1), 1); del S
chunkDoc = meta['chunkDoc']; gold = [set(q['gold']) if q['gold'] else None for q in meta['queries']]

def score(res, lat):
    lat = np.asarray(lat); rec, mrr = [], []
    for i, r in enumerate(res):
        r = [int(x) for x in r if x >= 0][:10]
        rec.append(len(set(r) & set(GT[i].tolist())) / 10)
        docs = list(dict.fromkeys(chunkDoc[c] for c in r))
        mrr.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    return dict(p50_us=float(np.percentile(lat, 50)), p99_us=float(np.percentile(lat, 99)),
                recall10_vs_exact=float(np.mean(rec)), mrr10=float(np.mean(mrr)))

def timeit(fn):
    for i in range(min(200, nq)): fn(i)
    lat, res = [], []
    for i in range(nq):
        t = []
        for _ in range(3):
            s = time.perf_counter_ns(); r = fn(i); t.append((time.perf_counter_ns() - s) / 1e3)
        lat.append(sorted(t)[1]); res.append(r)
    return lat, res

rows = [dict(method='sweet (prod cascade)', M=64, efC=800, ef='adaptive', **score(ours['res'], ours['total_us'])),
        dict(method='exact cosine (ceiling)', ef='-', **score(GT, [0] * nq))]
out = f'{name}/results3.json'
def emit(r):
    rows.append(r); print(json.dumps(r), flush=True); json.dump(rows, open(out, 'w'), indent=1)
EFS = [16, 32, 64, 128, 256, 512, 1024, 2048]
def sweep(label, M, efC, build_s, nbytes, set_ef, query):
    for ef in EFS:
        set_ef(ef)
        lat, res = timeit(query)
        r = dict(method=label, M=M, efC=efC, build_s=round(build_s, 1), index_mb=round(nbytes / 2**20, 1), ef=ef, **score(res, lat))
        emit(r)
        if r['recall10_vs_exact'] >= 0.999 or r['p50_us'] > 15000: break

for M, efC in ((16, 40), (32, 200), (64, 800)):
    faiss.omp_set_num_threads(12); t = time.time()
    ix = faiss.IndexHNSWFlat(d, M, faiss.METRIC_INNER_PRODUCT); ix.hnsw.efConstruction = efC; ix.add(X); bt = time.time() - t
    nb = faiss.serialize_index(ix).nbytes; faiss.omp_set_num_threads(1)
    sweep('FAISS HNSWFlat f32', M, efC, bt, nb, lambda ef: setattr(ix.hnsw, 'efSearch', ef), lambda i: ix.search(Q[i:i+1], 10)[1][0])
    del ix; gc.collect()

for M, efC in ((16, 200), (64, 800)):
    t = time.time(); ix = hnswlib.Index(space='cosine', dim=d); ix.init_index(n, M=M, ef_construction=efC)
    ix.set_num_threads(12); ix.add_items(X, np.arange(n)); bt = time.time() - t; ix.set_num_threads(1)
    with tempfile.NamedTemporaryFile(suffix='.bin') as f: ix.save_index(f.name); nb = os.path.getsize(f.name)
    sweep('hnswlib f32', M, efC, bt, nb, lambda ef: ix.set_ef(max(ef, 10)), lambda i: ix.knn_query(Q[i:i+1], k=10)[0][0])
    del ix; gc.collect()

for dt, M, efC in (('f16', 16, 128), ('f16', 64, 800), ('i8', 64, 800)):
    t = time.time(); ix = Index(ndim=d, metric='cos', dtype=dt, connectivity=M, expansion_add=efC); ix.add(np.arange(n), X, threads=12); bt = time.time() - t
    nb = ix.memory_usage
    sweep(f'USearch {dt}', M, efC, bt, nb, lambda ef: setattr(ix, 'expansion_search', ef), lambda i: ix.search(Q[i], 10, threads=1).keys)
    del ix; gc.collect()
print('done', len(rows))
