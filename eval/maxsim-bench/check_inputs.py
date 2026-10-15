# venv/bin/python -I check_inputs.py [set-dir]
#
# Reference (a) of a rival arm is computed from contracts.spre_inputs. That is exact only
# if the arm receives those very values. This checks, on real dev calls (default: the
# first 50 calls of agent-dev), bit for bit:
#   - numpy_packed_int4 / maxsim_cpu_variable_int4 decode inside their timed call
#     (bench._dequant_all) to the same float32 arrays as contracts.dequant_norm32;
#   - torch's float32 -> bfloat16 cast equals contracts.to_bf16 (round to nearest even);
#   - NumKong's nk.astype to float16 equals contracts.cast; its bfloat16 cast is NOT round
#     to nearest even below 2^-17, so contract C's reference uses contracts.cast_numkong:
#     counted here, for the record (rival arms of contract Spre use torch's RNE cast).
import os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bench, contracts  # noqa: E402
from replay_py import load_set  # noqa: E402

root = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.ss-eval/maxsim-replay/agent-dev')
calls = load_set(root)[:50]
bad = 0
nk_bf16_vs_rne = n_el = 0
import torch, numkong as nk  # noqa: E402
for c in calls:
    qn, docs = contracts.spre_inputs(c)
    raw, mn, sc, nr, lens, offs = bench._int4_store(c)
    D = bench._dequant_all(raw, mn, sc, nr, c['dim'])
    bad += not np.array_equal(D.view(np.uint32), np.concatenate(docs).view(np.uint32))
    X = np.concatenate([qn] + docs)
    tb = torch.from_numpy(X).to(torch.bfloat16).to(torch.float32).numpy()
    bad += not np.array_equal(tb.view(np.uint32), contracts.to_bf16(X).view(np.uint32))
    got = np.asarray(nk.astype(nk.astype(X, 'float16'), 'float32'), np.float32)
    bad += not np.array_equal(got.view(np.uint32), contracts.cast(X, 'f16').astype(np.float32).view(np.uint32))
    nkb = np.asarray(nk.astype(nk.astype(X, 'bfloat16'), 'float32'), np.float32)
    nk_bf16_vs_rne += int((nkb.view(np.uint32) != contracts.to_bf16(X).view(np.uint32)).sum()); n_el += X.size
print(f'NumKong bf16 cast vs round-to-nearest-even: {nk_bf16_vs_rne} of {n_el} values differ (all below 2^-17; reference C uses NumKong\'s cast)')
print(f'{len(calls)} calls, 3 checks each: {bad} differ' + (' (FAIL)' if bad else ' (pass: the arms receive the reference (a) inputs bit for bit)'))
sys.exit(1 if bad else 0)
