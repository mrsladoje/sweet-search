/**
 * ss-search / ss-find `### imports`: only the import lines whose bound names the printed code
 * uses (agent-output-fixes.js usedImports). Real case: okhttp Cache.kt `fun key\(` printed 17
 * imports for a companion object that uses 4 of them; the packer's substring filter kept every
 * `okhttp3.internal.*` line because the code says `internal`.
 */
import { describe, expect, it } from 'vitest';

import { importBoundNames, renderFixedBlocks, selectEntries, usedImports } from '../../core/search/agent-output-fixes.js';

describe('importBoundNames', () => {
  const cases = [
    ['import java.util.TreeSet', ['TreeSet']],
    ['import okio.ByteString.Companion.encodeUtf8', ['encodeUtf8']],
    ['import static org.assertj.core.api.Assertions.assertThat;', ['assertThat']],
    ['import kotlin.time.Duration as KDuration', ['KDuration']],
    ['import { convertIndexSignatures, b as c } from "./x.js";', ['convertIndexSignatures', 'c']],
    ['import type { Context } from "./context.js";', ['Context']],
    ['import assert from "assert";', ['assert']],
    ['import * as ts from "typescript";', ['ts']],
    ['const path = require("path")', ['path']],
    ['const { a, b: c } = require("x")', ['a', 'c']],
    ['\t"github.com/dgraph-io/dgraph/v25/posting"', ['posting']],
    ['\t"time"', ['time']],
    ['\tpb "github.com/x/protos/pb"', ['pb']],
    ['use std::collections::{HashMap, HashSet as Set};', ['HashMap', 'Set']],
    ['use crate::backend::{self, Backend};', ['Backend', 'backend']],
    ['use super::foo;', ['foo']],
    ['use Composer\\Util\\Http\\Response;', ['Response']],
    ['from tortoise.fields import Field, ForeignKeyField as FK', ['Field', 'FK']],
    ['import os.path as osp', ['osp']],
  ];
  for (const [line, names] of cases) it(line, () => expect(importBoundNames(line)).toEqual(names));

  it('cannot tell (the line is kept): wildcards, namespaces, includes, side effects, `as _`', () => {
    for (const line of ['import java.util.*', 'from x import *', 'using System.Linq;', '#include <vector>',
      'import "./side-effect.css"', 'use itertools::Itertools as _;', 'require "set"', '\t_ "embed"']) {
      expect(importBoundNames(line)).toBe(null);
    }
  });
});

describe('usedImports', () => {
  it('keeps the lines whose names the code uses as a whole word, and the ones it cannot judge', () => {
    const head = [
      'import java.util.TreeSet',
      'import okhttp3.internal.cache.DiskLruCache',
      'import okio.ByteString.Companion.encodeUtf8',
      'import okhttp3.internal.platform.Platform',
      'import okio.*',
    ].join('\n');
    const code = 'internal fun key(url: HttpUrl): String = url.toString().encodeUtf8().md5().hex()\nval s = TreeSet<String>()\n// DiskLruCacheX';
    expect(usedImports(head, code)).toBe('import java.util.TreeSet\nimport okio.ByteString.Companion.encodeUtf8\nimport okio.*');
  });

  it('an imports block with no used line is not printed', () => {
    const r = {
      rank: 1, file: 'a/Cache.kt', startLine: 10, endLine: 10, shownStartLine: 10, shownEndLine: 10, symbol: 'key',
      symbolType: 'function', presentation: 'full', code: 'fun key() = 1', headerContext: 'import okhttp3.internal.cache.DiskLruCache',
    };
    const out = renderFixedBlocks([r], selectEntries([r], { dedupe: 'a2' }), { compact: true });
    expect(out).not.toContain('imports of');
    const used = { ...r, code: 'fun key() = DiskLruCache.KEY' };
    expect(renderFixedBlocks([used], selectEntries([used], { dedupe: 'a2' }), { compact: true }))
      .toContain('\nimports of Cache.kt: import okhttp3.internal.cache.DiskLruCache\n');
  });
});
