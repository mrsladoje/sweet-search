#!/usr/bin/env node

/**
 * Emit simd-distance.wasm binary with SIMD v128 instructions.
 * No external tooling (wabt/wat2wasm) required.
 *
 * Functions:
 *   0: hamming_distance(a_ptr, b_ptr, len) → i32   [i8x16.popcnt SIMD]
 *   1: int8_dot(a_ptr, b_ptr, len) → i32           [i16x8 extend+mul SIMD]
 *   2: int8_norm_sq(a_ptr, len) → i32              [i16x8 extend+mul SIMD]
 *
 * SIMD path processes 16 bytes/iteration. Scalar tail handles remainder.
 * Memory: vectors start at offset 0 (no LUT needed with SIMD popcnt).
 *
 * Run: node scripts/build-wasm.js
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'core', 'vector-store', 'simd-distance.wasm');

// ============================================================================
// WASM LEB128 encoding
// ============================================================================

function leb128u(v) {
  const b = [];
  do { let byte = v & 0x7f; v >>>= 7; if (v) byte |= 0x80; b.push(byte); } while (v);
  return b;
}

function leb128s(v) {
  const b = [];
  let more = true;
  while (more) {
    let byte = v & 0x7f; v >>= 7;
    if ((v === 0 && !(byte & 0x40)) || (v === -1 && (byte & 0x40))) more = false;
    else byte |= 0x80;
    b.push(byte);
  }
  return b;
}

function section(id, content) { return [id, ...leb128u(content.length), ...content]; }
function vec(items) { return [...leb128u(items.length), ...items.flat()]; }

// ============================================================================
// Opcodes
// ============================================================================

// Control
const END = 0x0b, BLOCK = 0x02, LOOP = 0x03, BR = 0x0c, BR_IF = 0x0d;
// Vars
const GET = 0x20, SET = 0x21, TEE = 0x22;
// i32
const I32 = 0x7f, I32_CONST = 0x41, I32_ADD = 0x6a, I32_SUB = 0x6b;
const I32_MUL = 0x6c, I32_AND = 0x71, I32_XOR = 0x73;
const I32_GE_U = 0x4f, I32_LT_U = 0x49, I32_SHR_U = 0x76;
const I32_LOAD8_U = 0x2d, I32_LOAD8_S = 0x2c;
const VOID = 0x40;

// v128
const V128 = 0x7b;

// SIMD prefix + opcode (all SIMD ops start with 0xFD then LEB128 opcode)
function simd(op) { return [0xfd, ...leb128u(op)]; }
const V128_LOAD         = 0;    // + memarg
const V128_XOR          = 81;   // 0x51
const V128_CONST        = 12;   // 0x0c + 16 bytes
const I8x16_POPCNT      = 98;   // 0x62
const I8x16_ADD         = 110;  // 0x6e  (not used — we pairwise-extend instead)
const I16x8_EXTADD_U    = 124;  // 0x7c  i16x8.extadd_pairwise_i8x16_u
const I32x4_EXTADD_U    = 127;  // 0x7f  i32x4.extadd_pairwise_i16x8_u
const I32x4_ADD         = 174;  // 0xae
const I32x4_EXTRACT     = 27;   // 0x1b + lane
const I16x8_EXT_LO_S    = 0x87; // i16x8.extend_low_i8x16_s   (multi-byte after prefix)
const I16x8_EXT_HI_S    = 0x88; // i16x8.extend_high_i8x16_s
const I16x8_MUL         = 0xd5; // i16x8.mul
const I32x4_EXT_LO_S    = 0xa7; // i32x4.extend_low_i16x8_s
const I32x4_EXT_HI_S    = 0xa8; // i32x4.extend_high_i16x8_s

// ============================================================================
// Module construction
// ============================================================================

function buildModule() {
  // Type section: 5 signatures
  // type 0: (i32,i32,i32) → i32       [hamming, int8_dot]
  // type 1: (i32,i32) → i32           [int8_norm_sq]
  // type 2: (i32,i32,i32,i32) → i32   [asymmetric_distance]
  // type 3: (i32,i32,i32,i32,i32) → () [int8_batch_dot]
  // type 4: (i32,i32,i32,i32,i32) → f32 [maxsim_f32]
  const F32 = 0x7d;
  const typeSec = section(1, vec([
    [0x60, ...vec([[I32], [I32], [I32]]), ...vec([[I32]])],
    [0x60, ...vec([[I32], [I32]]), ...vec([[I32]])],
    [0x60, ...vec([[I32], [I32], [I32], [I32]]), ...vec([[I32]])],
    [0x60, ...vec([[I32], [I32], [I32], [I32], [I32]]), ...[0x00]], // → void
    [0x60, ...vec([[I32], [I32], [I32], [I32], [I32]]), ...vec([[F32]])], // → f32
  ]));

  // Function section: 6 functions (5 original + maxsim_f32)
  const funcSec = section(3, vec([[0], [0], [1], [2], [3], [4]]));

  // Memory: 64 pages (4MB — MaxSim needs Q×dim + D×dim float32 buffers)
  const memSec = section(5, vec([[0x00, ...leb128u(64)]]));

  // Exports
  const exp = (name, kind, idx) => [
    ...leb128u(name.length), ...Array.from(name).map(c => c.charCodeAt(0)),
    kind, ...leb128u(idx),
  ];
  const exportSec = section(7, vec([
    exp('memory', 2, 0),
    exp('hamming_distance', 0, 0),
    exp('int8_dot', 0, 1),
    exp('int8_norm_sq', 0, 2),
    exp('asymmetric_distance', 0, 3),
    exp('int8_batch_dot', 0, 4),
    exp('maxsim_f32', 0, 5),
  ]));

  // -----------------------------------------------------------------------
  // Function 0: hamming_distance(a, b, len) → i32
  //   SIMD: v128.load a, v128.load b, v128.xor, i8x16.popcnt,
  //         pairwise-extend to i32x4, accumulate. 16 bytes/iter.
  //   Scalar tail for remaining bytes.
  // -----------------------------------------------------------------------
  // Locals: $simd_end(i32), $acc(v128), $xored(v128), $scalar_total(i32)
  const hamming = [
    // 2 local decl groups: 2×i32, 2×v128
    ...leb128u(2),
    ...leb128u(2), I32,  // $simd_end(3), $scalar_total(4)
    ...leb128u(2), V128, // $acc(5), $xored(6)

    // $simd_end = $a + ($len & ~15)   — round down to multiple of 16
    GET, 0, // a
    GET, 2, // len
    I32_CONST, 0x70, // -16 in signed LEB = 0x70, but we need i32.and with ~15.
    // Actually ~15 = 0xFFFFFFF0. LEB128 signed: ...
    // Let's do len >> 4 << 4 instead: (len / 16) * 16
  ];

  // Simpler approach: $simd_end = $a + (($len >> 4) << 4)
  // But bit shifts: i32.shr_u by 4, i32.shl by 4 = effectively i32.and with ~15
  // i32.and with -16 (0xfffffff0): in signed LEB128 = [0x70]... no, -16 = 0xf0 0x7f
  // Actually for i32.const -16: leb128s(-16) = [0x70]
  // i32.and(len, -16) gives len rounded down to multiple of 16.

  // Let me just build this properly with a helper for the body bytes.

  function hammingBody() {
    const b = [];
    // Locals: 2 groups
    b.push(...leb128u(2));
    b.push(...leb128u(2), I32);  // locals 3,4 = i32
    b.push(...leb128u(1), V128); // local 5 = v128 accumulator

    // $simd_end = $a + ($len & 0xFFFFFFF0)
    b.push(GET, 0);             // a
    b.push(GET, 2);             // len
    b.push(I32_CONST, ...leb128s(-16)); // -16
    b.push(I32_AND);
    b.push(I32_ADD);
    b.push(SET, 3);             // $simd_end

    // $acc = v128.const 0
    // (initialized to zero by default for v128 locals)

    // SIMD loop: while ($a < $simd_end)
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    // xored = v128.load(a) ^ v128.load(b)
    b.push(GET, 0); b.push(...simd(V128_LOAD), 0x00, 0x00);  // v128.load a, align=0 offset=0
    b.push(GET, 1); b.push(...simd(V128_LOAD), 0x00, 0x00);  // v128.load b
    b.push(...simd(V128_XOR));

    // popcnt per lane
    b.push(...simd(I8x16_POPCNT));

    // pairwise extend: i8x16 → i16x8 → i32x4 (sum adjacent lanes)
    b.push(...simd(I16x8_EXTADD_U));
    b.push(...simd(I32x4_EXTADD_U));

    // $acc += result
    b.push(GET, 5);
    b.push(...simd(I32x4_ADD));
    b.push(SET, 5);

    // a += 16, b += 16
    b.push(GET, 0); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 0);
    b.push(GET, 1); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 1);
    b.push(BR, 0);
    b.push(END); // loop
    b.push(END); // block

    // Extract i32x4 lanes and sum
    // $scalar_total = acc[0] + acc[1] + acc[2] + acc[3]
    b.push(GET, 5); b.push(...simd(I32x4_EXTRACT), 0);
    b.push(GET, 5); b.push(...simd(I32x4_EXTRACT), 1);
    b.push(I32_ADD);
    b.push(GET, 5); b.push(...simd(I32x4_EXTRACT), 2);
    b.push(I32_ADD);
    b.push(GET, 5); b.push(...simd(I32x4_EXTRACT), 3);
    b.push(I32_ADD);
    b.push(SET, 4); // $scalar_total

    // Scalar tail: remaining bytes (a < a_orig + len)
    // $simd_end now repurposed: $end = original_a + len
    // But we already incremented $a. $end = $a_start + $len.
    // We need end pointer. a_start was param 0 but we modified it.
    // Workaround: $end = $simd_end + (len & 15)
    b.push(GET, 3); // $simd_end (= original_a + (len & ~15))
    b.push(GET, 2); // len
    b.push(I32_CONST, 15);
    b.push(I32_AND);
    b.push(I32_ADD);
    b.push(SET, 3); // $end

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    // XOR bytes, popcount via Kernighan
    b.push(GET, 0); b.push(I32_LOAD8_U, 0, 0);
    b.push(GET, 1); b.push(I32_LOAD8_U, 0, 0);
    b.push(I32_XOR);
    // Kernighan popcount loop for a single byte (max 8 iterations)
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(TEE, 3); // reuse $end as temp (we're past the loop that uses it as end)
    // Oops, can't reuse $end here since we're still in the tail loop using it.
    // Let me use a simpler approach: just use a lookup or bit tricks.
    // For tail bytes, simplest is bit-by-bit count in i32.
    // Actually let me just accumulate with shifts.

    // Better: use the simple approach since tail is at most 15 bytes.
    // Pop the XOR value, count bits:
    // bits = v; v = v - ((v >> 1) & 0x55); v = (v & 0x33) + ((v >> 2) & 0x33); v = (v + (v >> 4)) & 0x0f
    // But that's a lot of opcodes. Simpler: Kernighan with a local counter.
    b.length -= 4; // remove the block+loop we just started for Kernighan

    // Instead: inline bit count for byte using arithmetic
    // count = popcount_byte(xor_byte)
    // = ((xor * 0x0101010101010101) >> 56) — but that's 64-bit.
    // Just use Kernighan: while (v) { count++; v &= v-1; }
    // Need a temp local. But we're out of locals allocated for this purpose.
    // Let's add another local. Actually, we declared 2 i32 locals (3,4) and 1 v128 (5).
    // After the SIMD loop, 3 is used as $end and 4 as $scalar_total, 5 as accumulator.
    // After extracting SIMD result to $scalar_total(4), we repurpose $simd_end(3) as $end for tail.
    // We need a 6th local for the xor byte. Let's adjust local count.

    // This is getting complex with raw bytecodes. Let me use a simpler tail strategy:
    // just unrolled bit counting for a byte using shifts.
    // popcount(byte) = sum of 8 bits. Fastest in WASM scalar:
    // Use the parallel bit-count method for a byte (8 bits):

    // MUCH simpler: the tail is at most 15 bytes. Just process them one at a time
    // with a lookup-style approach using shifts.
    // popcount(x) for a byte:
    //   x = x - ((x >> 1) & 0x55)
    //   x = (x & 0x33) + ((x >> 2) & 0x33)
    //   x = (x + (x >> 4)) & 0x0F

    // Let's do it properly with an extra temp local. Adjust local decl to 3 i32.
    b.splice(0); // restart

    b.push(...leb128u(2));
    b.push(...leb128u(3), I32);  // locals 3=$simd_end, 4=$scalar_total, 5=$tmp
    b.push(...leb128u(1), V128); // local 6 = v128 accumulator

    // Recalculate with new local indices:
    // params: 0=a, 1=b, 2=len
    // locals: 3=$simd_end, 4=$scalar_total, 5=$tmp, 6=$v128_acc

    // $simd_end = $a + ($len & ~15)
    b.push(GET, 0); b.push(GET, 2); b.push(I32_CONST, ...leb128s(-16));
    b.push(I32_AND); b.push(I32_ADD); b.push(SET, 3);

    // SIMD loop
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    b.push(GET, 0); b.push(...simd(V128_LOAD), 0x00, 0x00);
    b.push(GET, 1); b.push(...simd(V128_LOAD), 0x00, 0x00);
    b.push(...simd(V128_XOR));
    b.push(...simd(I8x16_POPCNT));
    b.push(...simd(I16x8_EXTADD_U));
    b.push(...simd(I32x4_EXTADD_U));
    b.push(GET, 6); b.push(...simd(I32x4_ADD)); b.push(SET, 6);

    b.push(GET, 0); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 0);
    b.push(GET, 1); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 1);
    b.push(BR, 0);
    b.push(END); b.push(END);

    // Extract SIMD accumulator
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 0);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 1); b.push(I32_ADD);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 2); b.push(I32_ADD);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 3); b.push(I32_ADD);
    b.push(SET, 4);

    // Scalar tail: $end = $a_current + remaining bytes
    // remaining = len - ($a - original_a). But we modified $a.
    // $end = $simd_end + (len & 15). But $simd_end = original_a + (len & ~15).
    // So $end = original_a + len. We don't have original_a anymore.
    // Fix: $end = $simd_end + ($len & 15)
    b.push(GET, 3); b.push(GET, 2); b.push(I32_CONST, 15); b.push(I32_AND);
    b.push(I32_ADD); b.push(SET, 3);

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    // $tmp = mem[a] ^ mem[b]
    b.push(GET, 0); b.push(I32_LOAD8_U, 0, 0);
    b.push(GET, 1); b.push(I32_LOAD8_U, 0, 0);
    b.push(I32_XOR);
    // popcount byte: x -= (x>>1)&0x55; x=(x&0x33)+((x>>2)&0x33); x=(x+(x>>4))&0x0F
    b.push(SET, 5); // $tmp = xor
    b.push(GET, 5); b.push(GET, 5); b.push(I32_CONST, 1); b.push(I32_SHR_U);
    b.push(I32_CONST, 0x55); b.push(I32_AND); b.push(I32_SUB); b.push(SET, 5);
    b.push(GET, 5); b.push(I32_CONST, 0x33); b.push(I32_AND);
    b.push(GET, 5); b.push(I32_CONST, 2); b.push(I32_SHR_U); b.push(I32_CONST, 0x33); b.push(I32_AND);
    b.push(I32_ADD); b.push(SET, 5);
    b.push(GET, 5); b.push(GET, 5); b.push(I32_CONST, 4); b.push(I32_SHR_U);
    b.push(I32_ADD); b.push(I32_CONST, 0x0f); b.push(I32_AND);
    // $scalar_total += popcount
    b.push(GET, 4); b.push(I32_ADD); b.push(SET, 4);

    b.push(GET, 0); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 0);
    b.push(GET, 1); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 1);
    b.push(BR, 0);
    b.push(END); b.push(END);

    b.push(GET, 4);
    b.push(END);
    return b;
  }

  // -----------------------------------------------------------------------
  // Function 1: int8_dot(a, b, len) → i32
  //   SIMD: i16x8.extmul + i32x4.extadd_pairwise, 16 bytes/iteration.
  //   Scalar tail for remainder. ~4-8x faster than scalar for dim=512.
  // -----------------------------------------------------------------------
  // SIMD opcodes for int8 dot product
  const I16x8_EXTMUL_LO_S = 0x9C;  // i16x8.extmul_low_i8x16_s
  const I16x8_EXTMUL_HI_S = 0x9D;  // i16x8.extmul_high_i8x16_s
  const I32x4_EXTADD_S    = 0x7E;  // i32x4.extadd_pairwise_i16x8_s

  function int8DotBody() {
    const b = [];
    // params: 0=$a, 1=$b, 2=$len
    // locals: 3=$simd_end, 4=$scalar_total, 5=$tmp,
    //         6=$acc(v128), 7=$va(v128), 8=$vb(v128)
    b.push(...leb128u(2));
    b.push(...leb128u(3), I32);  // 3,4,5
    b.push(...leb128u(3), V128); // 6,7,8

    // $simd_end = $a + ($len & ~15)
    b.push(GET, 0); b.push(GET, 2); b.push(I32_CONST, ...leb128s(-16));
    b.push(I32_AND); b.push(I32_ADD); b.push(SET, 3);

    // SIMD loop: 16 int8 elements per iteration
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    // $va = v128.load(a), $vb = v128.load(b)
    b.push(GET, 0); b.push(...simd(V128_LOAD), 0x00, 0x00); b.push(SET, 7);
    b.push(GET, 1); b.push(...simd(V128_LOAD), 0x00, 0x00); b.push(SET, 8);

    // Low 8 bytes: extend to i16x8, multiply, pairwise-extend to i32x4, accumulate
    b.push(GET, 7); b.push(GET, 8);
    b.push(...simd(I16x8_EXTMUL_LO_S));  // i16x8 products from low 8 bytes
    b.push(...simd(I32x4_EXTADD_S));     // pairwise sum to i32x4
    b.push(GET, 6); b.push(...simd(I32x4_ADD)); b.push(SET, 6);

    // High 8 bytes: same pattern
    b.push(GET, 7); b.push(GET, 8);
    b.push(...simd(I16x8_EXTMUL_HI_S));  // i16x8 products from high 8 bytes
    b.push(...simd(I32x4_EXTADD_S));     // pairwise sum to i32x4
    b.push(GET, 6); b.push(...simd(I32x4_ADD)); b.push(SET, 6);

    // a += 16, b += 16
    b.push(GET, 0); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 0);
    b.push(GET, 1); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 1);
    b.push(BR, 0);
    b.push(END); b.push(END);

    // Extract i32x4 lanes and sum
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 0);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 1); b.push(I32_ADD);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 2); b.push(I32_ADD);
    b.push(GET, 6); b.push(...simd(I32x4_EXTRACT), 3); b.push(I32_ADD);
    b.push(SET, 4);

    // Scalar tail: $end = $simd_end + (len & 15)
    b.push(GET, 3); b.push(GET, 2); b.push(I32_CONST, 15); b.push(I32_AND);
    b.push(I32_ADD); b.push(SET, 3);

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    b.push(GET, 4);
    b.push(GET, 0); b.push(I32_LOAD8_S, 0, 0);
    b.push(GET, 1); b.push(I32_LOAD8_S, 0, 0);
    b.push(I32_MUL); b.push(I32_ADD); b.push(SET, 4);

    b.push(GET, 0); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 0);
    b.push(GET, 1); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 1);
    b.push(BR, 0);
    b.push(END); b.push(END);

    b.push(GET, 4);
    b.push(END);
    return b;
  }

  // -----------------------------------------------------------------------
  // Function 2: int8_norm_sq(a, len) → i32
  //   Same as int8_dot but a×a instead of a×b.
  // -----------------------------------------------------------------------
  function normSqBody() {
    const b = [];
    // Locals: 2=$end, 3=$total, 4=$val
    b.push(...leb128u(1));
    b.push(...leb128u(3), I32);

    // Scalar-only (norm_sq is called much less frequently than hamming/dot)
    b.push(GET, 0); b.push(GET, 1); b.push(I32_ADD); b.push(SET, 2); // $end

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 0); b.push(GET, 2); b.push(I32_GE_U); b.push(BR_IF, 1);

    b.push(GET, 0); b.push(I32_LOAD8_S, 0, 0); b.push(SET, 4);
    b.push(GET, 3); b.push(GET, 4); b.push(GET, 4); b.push(I32_MUL);
    b.push(I32_ADD); b.push(SET, 3);

    b.push(GET, 0); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 0);
    b.push(BR, 0);
    b.push(END); b.push(END);

    b.push(GET, 3);
    b.push(END);
    return b;
  }

  // Encode function body with size prefix
  function codeEntry(body) { return [...leb128u(body.length), ...body]; }

  // -----------------------------------------------------------------------
  // Function 3: asymmetric_distance(doc_ptr, query_int4_ptr, dim, query_norm_scaled) → i32
  //   For each dimension: if doc bit set, add queryInt4[i]; else subtract.
  //   Returns query_norm_scaled - 2 * approxDot (all integer-scaled).
  // -----------------------------------------------------------------------
  function asymDistBody() {
    const b = [];
    // Pure scalar: iterate dim times, compute byte and bit position each iteration.
    // params: 0=doc_ptr, 1=query_int4_ptr, 2=dim, 3=queryNorm
    // Locals: 4=$i, 5=$approxDot, 6=$byteVal, 7=$queryVal
    b.push(...leb128u(1));
    b.push(...leb128u(4), I32); // 4=$i, 5=$approxDot, 6=$byteVal, 7=$queryVal

    // Outer loop: i from 0 to dim
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 4); b.push(GET, 2); b.push(I32_GE_U); b.push(BR_IF, 1);

    // byteVal = doc[i >> 3]
    b.push(GET, 0);
    b.push(GET, 4); b.push(I32_CONST, 3); b.push(I32_SHR_U);
    b.push(I32_ADD);
    b.push(I32_LOAD8_U, 0, 0);
    b.push(SET, 6);

    // queryVal = query[i] (signed)
    b.push(GET, 1); b.push(GET, 4); b.push(I32_ADD);
    b.push(I32_LOAD8_S, 0, 0);
    b.push(SET, 7);

    // bit position = 7 - (i & 7), mask = 1 << bit
    // if (byteVal & (1 << (7 - (i & 7)))): approxDot += queryVal else -= queryVal
    b.push(GET, 6);
    b.push(I32_CONST, 1);
    b.push(I32_CONST, 7);
    b.push(GET, 4); b.push(I32_CONST, 7); b.push(I32_AND); // i & 7
    b.push(I32_SUB);  // 7 - (i & 7)
    b.push(0x74);     // i32.shl
    b.push(I32_AND);  // byteVal & mask

    b.push(0x04, 0x40); // if (void)
    // bit set: approxDot += queryVal
    b.push(GET, 5); b.push(GET, 7); b.push(I32_ADD); b.push(SET, 5);
    b.push(0x05); // else
    // bit clear: approxDot -= queryVal
    b.push(GET, 5); b.push(GET, 7); b.push(I32_SUB); b.push(SET, 5);
    b.push(END); // end if

    // i++
    b.push(GET, 4); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 4);
    b.push(BR, 0);
    b.push(END); b.push(END);

    // return queryNorm - 2 * approxDot
    b.push(GET, 3); // queryNorm (pre-scaled by caller)
    b.push(I32_CONST, 2);
    b.push(GET, 5);
    b.push(I32_MUL);
    b.push(I32_SUB);

    b.push(END);
    return b;
  }

  // -----------------------------------------------------------------------
  // Function 4: int8_batch_dot(query, slab, count, dim, scores) → void
  //   Single WASM call for all candidates. Loops internally, calling
  //   int8_dot for each candidate, writing i32 scores to output buffer.
  //   Eliminates per-candidate JS→WASM boundary crossings.
  // -----------------------------------------------------------------------
  const I32_SHL = 0x74;
  const I32_STORE = 0x36;
  const CALL = 0x10;

  function int8BatchDotBody() {
    const b = [];
    // params: 0=$query, 1=$slab, 2=$count, 3=$dim, 4=$scores
    // locals: 5=$i
    b.push(...leb128u(1));
    b.push(...leb128u(1), I32); // local 5 = $i

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    // if i >= count: break
    b.push(GET, 5); b.push(GET, 2); b.push(I32_GE_U); b.push(BR_IF, 1);

    // Address for i32.store: scores + i * 4
    b.push(GET, 4);       // $scores
    b.push(GET, 5);       // $i
    b.push(I32_CONST, 2);
    b.push(I32_SHL);      // i << 2 = i * 4
    b.push(I32_ADD);

    // Value: call int8_dot(query, slab + i*dim, dim)
    b.push(GET, 0);       // $query
    b.push(GET, 1);       // $slab
    b.push(GET, 5);       // $i
    b.push(GET, 3);       // $dim
    b.push(I32_MUL);      // i * dim
    b.push(I32_ADD);      // slab + i*dim
    b.push(GET, 3);       // $dim
    b.push(CALL, ...leb128u(1)); // call function 1 (int8_dot)

    // i32.store(addr, value) — align=2 (4-byte), offset=0
    b.push(I32_STORE, 0x02, 0x00);

    // i++
    b.push(GET, 5); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 5);

    b.push(BR, 0);
    b.push(END); b.push(END); // end loop, end block

    b.push(END); // end function
    return b;
  }

  // -----------------------------------------------------------------------
  // Function 5: maxsim_f32(q_ptr, d_ptr, num_q, num_d, dim) → f32
  //   Computes MaxSim score entirely in WASM with f32 arithmetic.
  //   For each query token, finds max cosine sim with any doc token.
  //   Returns average of clamped(0) max similarities.
  //
  //   Layout: q_ptr → num_q × dim × f32, d_ptr → num_d × dim × f32
  //   All data must be pre-copied to WASM memory by the caller.
  //
  //   ~10-30x faster than JS: f32 math, no GC, no object allocation,
  //   tight loop codegen, no function call overhead per pair.
  // -----------------------------------------------------------------------

  // f32 opcodes
  const F32_LOAD   = 0x2a;
  const F32_STORE  = 0x38;
  const F32_CONST  = 0x43;
  const F32_ADD    = 0x92;
  const F32_MUL    = 0x94;
  const F32_DIV    = 0x95;
  const F32_SQRT   = 0x91;
  const F32_MAX    = 0x97;
  const F32_GT     = 0x5e;
  const F32_CVT_S  = 0xb2; // f32.convert_i32_s
  const IF         = 0x04;
  const ELSE       = 0x05;

  function f32Bytes(val) {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = val;
    return [...new Uint8Array(buf)];
  }

  // f32x4 SIMD opcodes
  const F32x4_ADD          = 0xE4;
  const F32x4_MUL          = 0xE6;
  const F32x4_MAX          = 0xE9;
  const F32x4_EXTRACT      = 0x1F;  // + lane
  const F32x4_SPLAT        = 0x13;

  function maxsimF32Body() {
    const b = [];
    // params: 0=$q_ptr, 1=$d_ptr, 2=$num_q, 3=$num_d, 4=$dim
    // i32 locals: 5=$qi, 6=$di, 7=$k, 8=$q_base, 9=$d_base, 10=$dim16, 11=$kptr
    // f32 locals: 12=$total, 13=$max_sim, 14=$dot, 15=$q_norm, 16=$d_norm
    // v128 locals: 17=$dot_acc, 18=$norm_acc
    b.push(...leb128u(3));
    b.push(...leb128u(7), I32);   // locals 5-11
    b.push(...leb128u(5), F32);   // locals 12-16
    b.push(...leb128u(2), V128);  // locals 17-18

    // dim16 = dim * 4 bytes (stride per token)
    b.push(GET, 4); b.push(I32_CONST, 2); b.push(I32_SHL); b.push(SET, 10);

    // === Outer loop: qi ===
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 5); b.push(GET, 2); b.push(I32_GE_U); b.push(BR_IF, 1);

    // q_base = q_ptr + qi * dim * 4
    b.push(GET, 0); b.push(GET, 5); b.push(GET, 10); b.push(I32_MUL); b.push(I32_ADD);
    b.push(SET, 8);

    // Pre-compute q_norm via SIMD: q_norm_acc = Σ q[k]² using f32x4
    // norm_acc = 0
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 18);
    b.push(I32_CONST, 0); b.push(SET, 7); // k = 0 (counts in byte steps of 16)
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 7); b.push(GET, 10); b.push(I32_GE_U); b.push(BR_IF, 1);
    // qv = v128.load(q_base + k)
    b.push(GET, 8); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);
    // norm_acc += qv * qv (need to dup on stack)
    b.push(SET, 17); // temp save
    b.push(GET, 17); b.push(GET, 17); b.push(...simd(F32x4_MUL));
    b.push(GET, 18); b.push(...simd(F32x4_ADD)); b.push(SET, 18);
    // k += 16
    b.push(GET, 7); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 7);
    b.push(BR, 0);
    b.push(END); b.push(END);
    // Horizontal sum norm_acc → q_norm
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 0);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 1); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 2); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 3); b.push(F32_ADD);
    b.push(F32_SQRT); b.push(SET, 15);

    // max_sim = -1.0
    b.push(F32_CONST, ...f32Bytes(-1.0)); b.push(SET, 13);

    // === Middle loop: di ===
    b.push(I32_CONST, 0); b.push(SET, 6);
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 6); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    // d_base = d_ptr + di * dim * 4
    b.push(GET, 1); b.push(GET, 6); b.push(GET, 10); b.push(I32_MUL); b.push(I32_ADD);
    b.push(SET, 9);

    // SIMD inner loop: dot_acc = Σ q[k]*d[k], norm_acc = Σ d[k]²
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 17); // dot_acc = 0
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 18); // norm_acc = 0
    b.push(I32_CONST, 0); b.push(SET, 7); // k = 0 (byte offset)

    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 7); b.push(GET, 10); b.push(I32_GE_U); b.push(BR_IF, 1);

    // qv = v128.load(q_base + k) — 4 f32 query values
    b.push(GET, 8); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);
    // dv = v128.load(d_base + k) — 4 f32 doc values
    b.push(GET, 9); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);

    // Stack: [qv, dv]. Save dv for norm computation.
    b.push(SET, 18);      // temp: save dv to norm_acc (will overwrite)
    // dot_acc += qv * dv
    b.push(GET, 18);      // dv
    b.push(...simd(F32x4_MUL)); // qv * dv
    b.push(GET, 17);      // dot_acc
    b.push(...simd(F32x4_ADD));
    b.push(SET, 17);

    // We need norm_acc separately. Reload dv and compute dv*dv.
    // Re-load dv from memory (cheaper than extra local for long dims)
    b.push(GET, 9); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);
    b.push(SET, 18);
    b.push(GET, 18); b.push(GET, 18); b.push(...simd(F32x4_MUL));
    // Need old norm_acc. But we overwrote it with dv! We need a 3rd v128 local.
    // Let me fix this by using a different approach.
    // Actually, I stored qv*dv into dot_acc(17) and now need to accumulate dv*dv.
    // But norm_acc(18) was overwritten with dv. I need to keep a running norm_acc.
    // Solution: use a different strategy — keep separate running accumulators.

    // Hmm, let me restart the inner loop with 3 v128 locals.
    b.length = 0; // RESTART entire function
    b.push(...leb128u(3));
    b.push(...leb128u(7), I32);   // locals 5-11
    b.push(...leb128u(5), F32);   // locals 12-16
    b.push(...leb128u(3), V128);  // locals 17=$dot_acc, 18=$norm_acc, 19=$tmp_v

    // dim16 = dim * 4 bytes
    b.push(GET, 4); b.push(I32_CONST, 2); b.push(I32_SHL); b.push(SET, 10);

    // === Outer loop: qi ===
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 5); b.push(GET, 2); b.push(I32_GE_U); b.push(BR_IF, 1);

    // q_base = q_ptr + qi * dim * 4
    b.push(GET, 0); b.push(GET, 5); b.push(GET, 10); b.push(I32_MUL); b.push(I32_ADD);
    b.push(SET, 8);

    // q_norm via SIMD
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 18);
    b.push(I32_CONST, 0); b.push(SET, 7);
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 7); b.push(GET, 10); b.push(I32_GE_U); b.push(BR_IF, 1);
    b.push(GET, 8); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00); b.push(SET, 19);
    b.push(GET, 19); b.push(GET, 19); b.push(...simd(F32x4_MUL));
    b.push(GET, 18); b.push(...simd(F32x4_ADD)); b.push(SET, 18);
    b.push(GET, 7); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 7);
    b.push(BR, 0);
    b.push(END); b.push(END);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 0);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 1); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 2); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 3); b.push(F32_ADD);
    b.push(F32_SQRT); b.push(SET, 15);

    b.push(F32_CONST, ...f32Bytes(-1.0)); b.push(SET, 13); // max_sim

    // === Middle loop: di ===
    b.push(I32_CONST, 0); b.push(SET, 6);
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 6); b.push(GET, 3); b.push(I32_GE_U); b.push(BR_IF, 1);

    b.push(GET, 1); b.push(GET, 6); b.push(GET, 10); b.push(I32_MUL); b.push(I32_ADD);
    b.push(SET, 9);

    // dot_acc = 0, norm_acc = 0
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 17);
    b.push(...simd(V128_CONST), ...new Array(16).fill(0)); b.push(SET, 18);
    b.push(I32_CONST, 0); b.push(SET, 7);

    // === SIMD inner loop: 4 f32 per iteration ===
    b.push(BLOCK, VOID);
    b.push(LOOP, VOID);
    b.push(GET, 7); b.push(GET, 10); b.push(I32_GE_U); b.push(BR_IF, 1);

    // qv = v128.load(q_base + k)
    b.push(GET, 8); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);
    // dv = v128.load(d_base + k)
    b.push(GET, 9); b.push(GET, 7); b.push(I32_ADD);
    b.push(...simd(V128_LOAD), 0x02, 0x00);
    b.push(SET, 19); // save dv

    // dot_acc += qv * dv
    b.push(GET, 19);
    b.push(...simd(F32x4_MUL));
    b.push(GET, 17); b.push(...simd(F32x4_ADD)); b.push(SET, 17);

    // norm_acc += dv * dv
    b.push(GET, 19); b.push(GET, 19); b.push(...simd(F32x4_MUL));
    b.push(GET, 18); b.push(...simd(F32x4_ADD)); b.push(SET, 18);

    // k += 16
    b.push(GET, 7); b.push(I32_CONST, 16); b.push(I32_ADD); b.push(SET, 7);
    b.push(BR, 0);
    b.push(END); b.push(END);

    // Horizontal sum dot_acc → dot
    b.push(GET, 17); b.push(...simd(F32x4_EXTRACT), 0);
    b.push(GET, 17); b.push(...simd(F32x4_EXTRACT), 1); b.push(F32_ADD);
    b.push(GET, 17); b.push(...simd(F32x4_EXTRACT), 2); b.push(F32_ADD);
    b.push(GET, 17); b.push(...simd(F32x4_EXTRACT), 3); b.push(F32_ADD);
    b.push(SET, 14); // dot

    // Horizontal sum norm_acc → d_norm
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 0);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 1); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 2); b.push(F32_ADD);
    b.push(GET, 18); b.push(...simd(F32x4_EXTRACT), 3); b.push(F32_ADD);
    // d_norm = sqrt(sum)
    b.push(F32_SQRT); b.push(SET, 16);

    // sim = dot / (q_norm * d_norm + eps)
    b.push(GET, 14);
    b.push(GET, 15); b.push(GET, 16); b.push(F32_MUL);
    b.push(F32_CONST, ...f32Bytes(1e-8)); b.push(F32_ADD);
    b.push(F32_DIV);

    // max_sim = max(max_sim, sim)
    b.push(GET, 13); b.push(F32_MAX); b.push(SET, 13);

    b.push(GET, 6); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 6);
    b.push(BR, 0);
    b.push(END); b.push(END); // end middle loop

    // total += max(0, max_sim)
    b.push(GET, 12);
    b.push(GET, 13); b.push(F32_CONST, ...f32Bytes(0)); b.push(F32_MAX);
    b.push(F32_ADD); b.push(SET, 12);

    b.push(GET, 5); b.push(I32_CONST, 1); b.push(I32_ADD); b.push(SET, 5);
    b.push(BR, 0);
    b.push(END); b.push(END); // end outer loop

    // return total / f32(num_q)
    b.push(GET, 12);
    b.push(GET, 2); b.push(F32_CVT_S); b.push(F32_DIV);

    b.push(END);
    return b;
  }

  const codeSec = section(10, vec([
    codeEntry(hammingBody()),
    codeEntry(int8DotBody()),
    codeEntry(normSqBody()),
    codeEntry(asymDistBody()),
    codeEntry(int8BatchDotBody()),
    codeEntry(maxsimF32Body()),
  ]));

  // Assemble
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...typeSec, ...funcSec, ...memSec, ...exportSec, ...codeSec,
  ]);
}

// ============================================================================
// Build + verify
// ============================================================================

const wasm = buildModule();
writeFileSync(outPath, wasm);
console.log(`Wrote ${wasm.length} bytes to ${outPath}`);

try {
  const mod = new WebAssembly.Module(wasm);
  const inst = new WebAssembly.Instance(mod);
  console.log('Module OK. Exports:', Object.keys(inst.exports));
  const mem = new Uint8Array(inst.exports.memory.buffer);

  // Hamming: identical = 0
  mem.set([0xff, 0x00], 0); mem.set([0xff, 0x00], 64);
  console.log(`hamming(FF00, FF00) = ${inst.exports.hamming_distance(0, 64, 2)} (expect 0)`);

  // Hamming: opposite = 16
  mem.set([0xff, 0x00], 0); mem.set([0x00, 0xff], 64);
  console.log(`hamming(FF00, 00FF) = ${inst.exports.hamming_distance(0, 64, 2)} (expect 16)`);

  // Hamming: SIMD path (64 bytes = 4 SIMD iterations)
  const a64 = new Uint8Array(64).fill(0xAA);
  const b64 = new Uint8Array(64).fill(0x55);
  mem.set(a64, 0); mem.set(b64, 128);
  console.log(`hamming(AA×64, 55×64) = ${inst.exports.hamming_distance(0, 128, 64)} (expect 512)`);

  // int8_dot: [1,2]·[3,4] = 11
  mem[0] = 1; mem[1] = 2; mem[64] = 3; mem[65] = 4;
  console.log(`int8_dot([1,2],[3,4]) = ${inst.exports.int8_dot(0, 64, 2)} (expect 11)`);

  // int8_norm_sq: [3,4] → 25
  mem[0] = 3; mem[1] = 4;
  console.log(`int8_norm_sq([3,4]) = ${inst.exports.int8_norm_sq(0, 2)} (expect 25)`);

  // int8_dot SIMD path: 32 elements
  const sa = new Int8Array(32); const sb = new Int8Array(32);
  for (let i = 0; i < 32; i++) { sa[i] = 2; sb[i] = 3; }
  mem.set(new Uint8Array(sa.buffer), 0);
  mem.set(new Uint8Array(sb.buffer), 64);
  console.log(`int8_dot([2×32],[3×32]) = ${inst.exports.int8_dot(0, 64, 32)} (expect 192)`);

  // asymmetric_distance: doc=0xFF (all bits set, 8 dims), query=[1,1,1,1,1,1,1,1], norm=100
  // approxDot = 8 (all bits set → all +1). result = 100 - 2*8 = 84
  mem[0] = 0xFF;
  const qi = new Int8Array([1,1,1,1,1,1,1,1]);
  mem.set(new Uint8Array(qi.buffer), 64);
  const ad = inst.exports.asymmetric_distance(0, 64, 8, 100);
  console.log(`asymmetric_distance(0xFF, [1×8], 8, 100) = ${ad} (expect 84)`);

  // doc=0x00 (no bits set), same query. approxDot = -8. result = 100 - 2*(-8) = 116
  mem[0] = 0x00;
  const ad2 = inst.exports.asymmetric_distance(0, 64, 8, 100);
  console.log(`asymmetric_distance(0x00, [1×8], 8, 100) = ${ad2} (expect 116)`);

  // int8_batch_dot: 3 candidates, dim=4
  // query=[1,2,3,4], cand0=[1,1,1,1], cand1=[2,2,2,2], cand2=[0,0,0,0]
  // dot0 = 1+2+3+4 = 10, dot1 = 2+4+6+8 = 20, dot2 = 0
  const queryOff = 0;
  const slabOff = 16;
  const scoresOff = 64;
  const bq = new Int8Array([1,2,3,4]);
  const bc0 = new Int8Array([1,1,1,1]);
  const bc1 = new Int8Array([2,2,2,2]);
  const bc2 = new Int8Array([0,0,0,0]);
  mem.set(new Uint8Array(bq.buffer), queryOff);
  mem.set(new Uint8Array(bc0.buffer), slabOff);
  mem.set(new Uint8Array(bc1.buffer), slabOff + 4);
  mem.set(new Uint8Array(bc2.buffer), slabOff + 8);
  inst.exports.int8_batch_dot(queryOff, slabOff, 3, 4, scoresOff);
  const batchScores = new Int32Array(inst.exports.memory.buffer, scoresOff, 3);
  console.log(`int8_batch_dot: [${batchScores}] (expect 10,20,0)`);

  // maxsim_f32: 2 query tokens, 2 doc tokens, dim=4 (must be multiple of 4 for SIMD)
  // Q = [[1,0,0,0], [0,1,0,0]]  D = [[0.9,0.1,0,0], [0.1,0.9,0,0]]
  // For q[0]: cos(q0,d0) = 0.9/sqrt(0.82) ≈ 0.994, cos(q0,d1) = 0.1/sqrt(0.82) ≈ 0.110
  // For q[1]: cos(q1,d0) ≈ 0.110, cos(q1,d1) ≈ 0.994
  // MaxSim = (0.994 + 0.994) / 2 ≈ 0.994
  {
    const f32 = new Float32Array(inst.exports.memory.buffer);
    const qOff = 0; // query at byte 0
    const dOff = 32; // doc at byte 32 (after 8 f32 = 2 tokens × dim 4)
    f32[0] = 1; f32[1] = 0; f32[2] = 0; f32[3] = 0;   // q[0]
    f32[4] = 0; f32[5] = 1; f32[6] = 0; f32[7] = 0;   // q[1]
    f32[8] = 0.9; f32[9] = 0.1; f32[10] = 0; f32[11] = 0;  // d[0]
    f32[12] = 0.1; f32[13] = 0.9; f32[14] = 0; f32[15] = 0; // d[1]
    const msScore = inst.exports.maxsim_f32(qOff, dOff, 2, 2, 4);
    console.log(`maxsim_f32: ${msScore.toFixed(4)} (expect ~0.994)`);
  }

} catch (err) {
  console.error('FAILED:', err.message);
  process.exit(1);
}
