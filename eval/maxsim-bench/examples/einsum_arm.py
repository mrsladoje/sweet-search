# Example: a new arm (plain NumPy einsum) added WITHOUT editing bench.py.
#
#   venv/bin/python -I examples/einsum_arm.py --set DIR --out OUT.json [--limit 20] [--reps 5]
#
# It imports bench.py as a module, registers one arm in bench.ARMS, and calls bench.main(),
# so the result file has the same format as any other arm. See ADDING_AN_IMPLEMENTATION.md.
# To make run_matrix.py and fixtures_contracts.py see the arm, paste the function into
# bench.py of your fork instead (section "Put the arm in your fork" of that file).
import argparse, os, sys
import numpy as np

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BENCH)
import bench  # noqa: E402  (module import: bench.args holds the defaults)


# contract 'Spre' = the library gets a normalized query and docs divided by their stored
# norms, and no clamp. precision 'f32' = it gets float32 arrays.
@bench.arm('numpy_einsum', contract='Spre', clamp=False, precision='f32')
def np_einsum(call):
    # Untimed set-up. qn: [nq, dim] float32, L2-normalized. docs: list of [nt, dim] float32.
    qn, docs = bench.rival_inputs(call)
    D, lens, offs = bench.packed(docs)        # all doc tokens in one matrix + start offsets
    nq = qn.shape[0]

    def run():                                # the timed part
        S = np.einsum('qd,td->qt', qn, D, optimize=True)         # all token similarities
        best = np.maximum.reduceat(S, offs, axis=1)              # best doc token per doc, [nq, n_docs]
        return best.sum(0, dtype=np.float64) / nq                # mean over query tokens, [n_docs]
    return run


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--reps', type=int, default=5)
    a = ap.parse_args()
    bench.args.arm, bench.args.set, bench.args.out = 'numpy_einsum', [a.set], a.out
    bench.args.limit, bench.args.reps = a.limit, a.reps
    bench.main()
