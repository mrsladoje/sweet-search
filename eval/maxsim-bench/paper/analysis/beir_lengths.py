# venv/bin/python -I paper/analysis/beir_lengths.py
#
# Post-freeze analysis code (not frozen). Share of BEIR documents that ColBERTv2's default
# document length (180 tokens) cut. Both models use the same tokenizer and token filter, so a
# document that was not cut has the same number of stored tokens under both models; a document
# with more tokens under answerai-colbert-small (300-token limit) was cut by the 180-token
# limit. Reads only the token counts (doc_offsets.npy) of the BEIR prep. Writes
# tables/beir_lengths.json.
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dump  # noqa: E402

RAW = os.path.expanduser('~/.ss-eval/maxsim-beir-prep/raw')


def main():
    res = {}
    for ds in ('scifact', 'nfcorpus'):
        n = {m: np.diff(np.load(os.path.join(RAW, f'{ds}-{m}', 'doc_offsets.npy'))) for m in ('answersmall', 'colbertv2')}
        ids = [json.load(open(os.path.join(RAW, f'{ds}-{m}', 'doc_ids.json'))) for m in ('answersmall', 'colbertv2')]
        assert ids[0] == ids[1]
        a, c = n['answersmall'], n['colbertv2']
        res[ds] = dict(docs=int(a.size), cut_180=float(np.mean(a > c)), equal=float(np.mean(a == c)), colbertv2_longer=float(np.mean(c > a)),
                       median_tokens=dict(answersmall=float(np.median(a)), colbertv2=float(np.median(c))))
        print(ds, res[ds])
    dump('beir_lengths.json', res)


if __name__ == '__main__':
    main()
