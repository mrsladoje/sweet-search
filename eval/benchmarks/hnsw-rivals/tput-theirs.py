# Throughput at matched quality: each rival at its best config for the given ef, 12 threads, batched.
# usage: python tput-theirs.py <name> '<json list of [method, M, efC, ef]>'
import json, sys, time, numpy as np, faiss, hnswlib
from usearch.index import Index
name, cfgs = sys.argv[1], json.loads(sys.argv[2])
meta = json.load(open(f'{name}/meta.json')); d = meta['dim']
X = np.fromfile(f'{name}/corpus768.bin', dtype=np.float32).reshape(-1, d); Q = np.fromfile(f'{name}/q768.bin', dtype=np.float32).reshape(-1, d)
X /= np.linalg.norm(X, axis=1, keepdims=True); Q /= np.linalg.norm(Q, axis=1, keepdims=True); n = len(X)
for method, M, efC, ef in cfgs:
    if method.startswith('FAISS'):
        faiss.omp_set_num_threads(12); ix = faiss.IndexHNSWFlat(d, M, faiss.METRIC_INNER_PRODUCT); ix.hnsw.efConstruction = efC; ix.add(X); ix.hnsw.efSearch = ef
        run = lambda: ix.search(Q, 10)
    elif method.startswith('hnswlib'):
        ix = hnswlib.Index(space='cosine', dim=d); ix.init_index(n, M=M, ef_construction=efC); ix.set_num_threads(12); ix.add_items(X, np.arange(n)); ix.set_ef(max(ef, 10))
        run = lambda: ix.knn_query(Q, k=10, num_threads=12)
    else:
        ix = Index(ndim=d, metric='cos', dtype=method.split()[1], connectivity=M, expansion_add=efC); ix.add(np.arange(n), X, threads=12); ix.expansion_search = ef
        run = lambda: ix.search(Q, 10, threads=12)
    run(); t = time.time()
    for _ in range(3): run()
    print(json.dumps(dict(name=name, method=method, M=M, efC=efC, ef=ef, threads=12, qps=round(3 * len(Q) / (time.time() - t)))), flush=True)
