# Resident memory of this process, for the W11 RAM pass (mem.py; PAPER_PLAN.md W11).
#
# What is measured: the resident memory of the process (bytes in RAM that the process pays
# for), not cache traffic.
#   Linux  VmRSS / VmHWM from /proc/self/status; anonymous vs file-backed from
#          /proc/self/smaps_rollup; the high-water mark is reset between phases by writing
#          5 to /proc/self/clear_refs.
#   macOS  resident size from proc_pid_rusage(RUSAGE_INFO_V4); a phase peak comes from a
#          sampler thread (every 0.2 ms; numpy, torch and ctypes calls release the GIL), so
#          a peak shorter than that can be missed. phys_footprint is recorded beside it but
#          is not the primary number: libmalloc reuses pages it marked reusable without
#          charging them to the footprint again (seen in S4: 52 MB of held float32 arrays,
#          RSS +55 MB, phys_footprint +0.3 MB). ru_maxrss is kept as a lifetime cross-check.
# Freed memory: the allocator must return large blocks to the OS at once, or a freed copy
# still counts and the next phase reuses it unseen. mem.py runs with
# MALLOC_MMAP_THRESHOLD_=65536 (glibc: every block >= 64 KiB is its own mapping, unmapped on
# free) or MallocLargeCache=0 (macOS libmalloc: no cache of freed large blocks). These are
# accounting settings for the untimed pass only; ENV_KEYS lists them in every record.
import ctypes, os, resource, sys, time

ENV_KEYS = ('MALLOC_MMAP_THRESHOLD_', 'MALLOC_TRIM_THRESHOLD_', 'MallocLargeCache')
LINUX = sys.platform.startswith('linux')
SOURCE = 'linux: VmRSS/VmHWM + smaps_rollup, clear_refs=5' if LINUX else 'macos: resident size (proc_pid_rusage v4) + 0.2 ms sampler peak'

if not LINUX:
    _lp = ctypes.CDLL('/usr/lib/libproc.dylib')
    _buf = (ctypes.c_uint64 * 64)()

    def _rusage():
        if _lp.proc_pid_rusage(os.getpid(), 4, ctypes.byref(_buf)) != 0:
            raise OSError('proc_pid_rusage failed')
        u = _buf[2:]  # after the 16-byte uuid
        return u[6], u[7]  # ri_resident_size, ri_phys_footprint

    import threading
    _samp = dict(peak=0, stop=None, th=None)

    def _sampler(stop):
        while not stop.is_set():
            r = _rusage()[0]
            if r > _samp['peak']:
                _samp['peak'] = r
            time.sleep(0.0002)

    def _stop_sampler():
        if _samp['th']:
            _samp['stop'].set(); _samp['th'].join(); _samp['th'] = None


def _status():
    out = {}
    for line in open('/proc/self/status'):
        k, _, v = line.partition(':')
        if k in ('VmRSS', 'VmHWM', 'RssAnon', 'RssFile', 'RssShmem'):
            out[k] = int(v.split()[0]) * 1024
    return out


def current():
    """Resident bytes now (Linux VmRSS, macOS resident size)."""
    return _status()['VmRSS'] if LINUX else _rusage()[0]


def peak():
    """Peak resident bytes since the last reset_peak() (macOS: stops the sampler)."""
    if LINUX:
        return _status()['VmHWM']
    _stop_sampler()
    return max(_samp['peak'], _rusage()[0])


def reset_peak():
    """Start a new phase: the peak restarts at the resident bytes now."""
    if LINUX:
        with open('/proc/self/clear_refs', 'w') as f:
            f.write('5')
        return
    _stop_sampler()
    _samp['peak'] = _rusage()[0]
    _samp['stop'] = threading.Event()
    _samp['th'] = threading.Thread(target=_sampler, args=(_samp['stop'],), daemon=True)
    _samp['th'].start()


def split():
    """Full reading: resident, peak, anonymous / file-backed (Linux), lifetime max RSS."""
    r = dict(resident=current(), ru_maxrss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if not LINUX else 1024))
    if not LINUX:
        r['phys_footprint'] = _rusage()[1]
    if LINUX:
        s = _status()
        r['peak'] = s['VmHWM']
        r.update(anon=s.get('RssAnon'), file=s.get('RssFile'), shmem=s.get('RssShmem'))
        try:
            for line in open('/proc/self/smaps_rollup'):
                k, _, v = line.partition(':')
                if k in ('Rss', 'Anonymous', 'Pss'):
                    r['smaps_' + k.lower()] = int(v.split()[0]) * 1024
        except OSError:
            pass
    return r


def env():
    return {k: os.environ.get(k) for k in ENV_KEYS if os.environ.get(k) is not None}
