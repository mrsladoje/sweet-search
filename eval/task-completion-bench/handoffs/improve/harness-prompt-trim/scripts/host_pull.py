#!/usr/bin/env python3
"""Pull a public Docker Hub image on the HOST and write a `docker load` archive.

Why: on the owner's Mac the Colima VM cannot reach Docker Hub's blob CDN (connections time
out inside the VM while the host reaches the same hosts in ~10 ms), so `docker pull` fails.
`docker load` goes through the socket and needs no VM network. Anonymous pulls only; the
platform is linux/amd64 (the SWE-rebench images). Standard library only.

    host_pull.py docker.io/swerebenchv2/pytask-dev-pytask:210-3022733 OUT.tar
    docker load -i OUT.tar
"""
import hashlib, io, json, os, sys, tarfile, urllib.request

ACCEPT = ', '.join([
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
])


def parse(ref):
    ref = ref.removeprefix('docker.io/')
    name, tag = ref.rsplit(':', 1)
    if '/' not in name:
        name = f'library/{name}'
    return name, tag


def get(url, token, accept=None):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}', **({'Accept': accept} if accept else {})})
    return urllib.request.urlopen(req, timeout=120)


def main(ref, out):
    name, tag = parse(ref)
    tok = json.load(urllib.request.urlopen(
        f'https://auth.docker.io/token?service=registry.docker.io&scope=repository:{name}:pull', timeout=60))['token']
    base = f'https://registry-1.docker.io/v2/{name}'
    man = json.load(get(f'{base}/manifests/{tag}', tok, ACCEPT))
    if 'manifests' in man:  # index: pick linux/amd64
        pick = [m for m in man['manifests'] if m.get('platform', {}).get('architecture') == 'amd64'
                and m.get('platform', {}).get('os') == 'linux']
        man = json.load(get(f'{base}/manifests/{pick[0]["digest"]}', tok, ACCEPT))
    cfg_digest = man['config']['digest']
    cfg = get(f'{base}/blobs/{cfg_digest}', tok).read()
    assert 'sha256:' + hashlib.sha256(cfg).hexdigest() == cfg_digest, 'config digest mismatch'
    layers = []
    with tarfile.open(out + '.part', 'w') as tf:
        def add(path, data):
            ti = tarfile.TarInfo(path); ti.size = len(data); tf.addfile(ti, io.BytesIO(data))
        add(f'{cfg_digest[7:]}.json', cfg)
        for i, layer in enumerate(man['layers']):
            d = layer['digest']
            path = f'{d[7:]}/layer.tar'
            h = hashlib.sha256()
            tmp = out + f'.layer{i}'
            with get(f'{base}/blobs/{d}', tok) as r, open(tmp, 'wb') as f:
                while chunk := r.read(1 << 20):
                    h.update(chunk); f.write(chunk)
            assert 'sha256:' + h.hexdigest() == d, f'layer digest mismatch {d}'
            tf.add(tmp, arcname=path)  # compressed layer; docker load decompresses it
            os.remove(tmp)
            layers.append(path)
            print(f'  layer {i + 1}/{len(man["layers"])} {layer["size"] / 1e6:.0f} MB', flush=True)
        add('manifest.json', json.dumps([{'Config': f'{cfg_digest[7:]}.json',
                                          'RepoTags': [f'{name}:{tag}'], 'Layers': layers}]).encode())
    os.replace(out + '.part', out)
    print(f'wrote {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
