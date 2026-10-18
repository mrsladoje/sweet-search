# <pylate venv>/bin/python -I rerun/beir_prep_pinned.py [--manifest MANIFEST.json] <beir_prep.py arguments>
#
# Post-freeze wrapper (not frozen). The frozen BEIR build script (beir_prep.py) records each
# model's revision in its manifest but downloads the newest snapshot: load_model() calls
# huggingface_hub.snapshot_download(model_id) without a revision. This wrapper pins the download
# to the revisions of the paper's build and then runs beir_prep.main() unchanged, so a rebuild
# encodes with the same model weights. The revisions come from --manifest (the MANIFEST.json of
# the release) or, without it, from the constants below (the values in that manifest). It
# stops if the downloaded snapshot is not the pinned revision.
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

PINNED = {'answerdotai/answerai-colbert-small-v1': '934fa8bb4ce2284f4c2baa232d81aca4d076fa5e',
          'colbert-ir/colbertv2.0': 'c1e84128e85ef755c096a95bdb06b47793b13acf'}


def pin(manifest=None):
    if manifest:
        PINNED.update({m['id']: m['revision'] for m in json.load(open(manifest))['models'].values()})
    import huggingface_hub
    import beir_prep
    ids = {spec['id'] for spec in beir_prep.MODELS.values()}
    missing = ids - PINNED.keys()
    if missing:
        sys.exit(f'no pinned revision for {sorted(missing)}')
    orig = huggingface_hub.snapshot_download

    def pinned(repo_id, *a, **kw):
        if repo_id in PINNED:
            kw['revision'] = PINNED[repo_id]
        path = orig(repo_id, *a, **kw)
        if repo_id in PINNED and os.path.basename(path.rstrip('/')) != PINNED[repo_id]:
            sys.exit(f'{repo_id}: got snapshot {os.path.basename(path)}, pinned {PINNED[repo_id]}')
        return path
    huggingface_hub.snapshot_download = pinned   # load_model() imports it from the module at call time
    return beir_prep


def main():
    argv = sys.argv[1:]
    manifest = None
    if '--manifest' in argv:
        i = argv.index('--manifest')
        manifest = argv[i + 1]
        del argv[i:i + 2]
    beir_prep = pin(manifest)
    sys.argv = [os.path.join(os.path.dirname(HERE), 'beir_prep.py')] + argv
    beir_prep.main()


if __name__ == '__main__':
    main()
