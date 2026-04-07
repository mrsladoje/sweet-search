/**
 * CRA-15: WebGPU Compute Shader Tier for MaxSim scoring.
 *
 * Tier 0 in the scoring hierarchy — GPU-accelerated 4-bit MaxSim scoring
 * using WebGPU compute shaders. Falls back gracefully when WebGPU is
 * unavailable (Node.js, unsupported browsers).
 *
 * The WGSL shader unpacks nibble-packed 4-bit data, performs fused
 * dequant + dot product, and computes max-reduce per query token.
 */

// WGSL compute shader for 4-bit MaxSim scoring
const MAXSIM_4BIT_WGSL = /* wgsl */`
struct Params {
  numQ: u32,
  numD: u32,
  dim: u32,
  packedDim: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> queryFlat: array<f32>;
@group(0) @binding(2) var<storage, read> packed: array<u32>;
@group(0) @binding(3) var<storage, read> minArray: array<f32>;
@group(0) @binding(4) var<storage, read> scaleArray: array<f32>;
@group(0) @binding(5) var<storage, read> docNorms: array<f32>;
@group(0) @binding(6) var<storage, read> queryNorms: array<f32>;
@group(0) @binding(7) var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn maxsim4bit(@builtin(global_invocation_id) gid: vec3<u32>) {
  let qi = gid.x;
  if (qi >= params.numQ) { return; }

  let dim = params.dim;
  let qOffset = qi * dim;
  let qNorm = queryNorms[qi];
  var best: f32 = -1.0;

  for (var di: u32 = 0u; di < params.numD; di = di + 1u) {
    let tmin = minArray[di];
    let tscale = scaleArray[di];
    let pOffset = di * params.packedDim;
    var dot: f32 = 0.0;

    // Fused unpack + dot — 2 dims per byte, 8 dims per u32 word.
    // Packing: byte[d/2] has dim d in low nibble (bits 0-3) and dim d+1
    // in high nibble (bits 4-7). Little-endian u32 read preserves byte order:
    // bits [0-7]=byte0, [8-15]=byte1, [16-23]=byte2, [24-31]=byte3.
    // So dim k within the u32 word is at shift = k * 4.
    for (var d: u32 = 0u; d < dim; d = d + 2u) {
      // Each byte holds 2 dims. u32 word index = byte_offset / 4.
      let byteIdx = d / 2u;
      let wordIdx = pOffset + byteIdx / 4u;
      let byteInWord = byteIdx % 4u;
      let word = packed[wordIdx];
      let lo = (word >> (byteInWord * 8u)) & 0xFu;
      let hi = (word >> (byteInWord * 8u + 4u)) & 0xFu;
      dot = dot + queryFlat[qOffset + d] * (f32(lo) * tscale + tmin);
      if (d + 1u < dim) {
        dot = dot + queryFlat[qOffset + d + 1u] * (f32(hi) * tscale + tmin);
      }
    }

    let dNorm = docNorms[di];
    let sim = dot / (qNorm * dNorm + 1e-8);
    if (sim > best) { best = sim; }
  }

  output[qi] = select(0.0, best, best > 0.0);
}
`;

let _device = null;
let _pipeline = null;
let _available = null;

/**
 * Check if WebGPU is available in the current environment.
 * @returns {boolean}
 */
export function isWebGPUAvailable() {
  if (_available !== null) return _available;
  _available = typeof globalThis !== 'undefined'
    && typeof globalThis.navigator !== 'undefined'
    && typeof globalThis.navigator.gpu !== 'undefined';
  return _available;
}

/**
 * Initialize the WebGPU device and compile the MaxSim compute pipeline.
 * No-op if WebGPU is unavailable. Safe to call multiple times.
 * @returns {Promise<boolean>} true if initialized successfully
 */
export async function initWebGPU() {
  if (_device) return true;
  if (!isWebGPUAvailable()) return false;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { _available = false; return false; }

    _device = await adapter.requestDevice();

    const shaderModule = _device.createShaderModule({ code: MAXSIM_4BIT_WGSL });

    _pipeline = _device.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'maxsim4bit' },
    });

    return true;
  } catch {
    _available = false;
    return false;
  }
}

/**
 * Score MaxSim directly from packed 4-bit data using WebGPU compute shader.
 *
 * @param {Float32Array} queryFlat - Flattened query token vectors
 * @param {Uint8Array} packed - Nibble-packed document tokens
 * @param {Float32Array} minArray - Per-token min values
 * @param {Float32Array} scaleArray - Per-token scale values
 * @param {Float32Array} docNorms - Pre-computed doc token norms
 * @param {number} numQ - Number of query tokens
 * @param {number} numD - Number of doc tokens
 * @param {number} dim - Token dimension
 * @returns {Promise<number|null>} MaxSim score, or null if WebGPU unavailable
 */
export async function webgpuMaxSim4Bit(queryFlat, packed, minArray, scaleArray, docNorms, numQ, numD, dim) {
  if (!_device || !_pipeline) {
    if (!await initWebGPU()) return null;
  }

  const packedDim = Math.ceil(dim / 2);

  // Compute query norms
  const queryNorms = new Float32Array(numQ);
  for (let qi = 0; qi < numQ; qi++) {
    let normSq = 0;
    for (let k = 0; k < dim; k++) {
      const v = queryFlat[qi * dim + k];
      normSq += v * v;
    }
    queryNorms[qi] = Math.sqrt(normSq);
  }

  // Create GPU buffers
  // packedDim in u32 words per token (each u32 holds 4 bytes = 8 nibbles = 8 dims)
  const packedDimU32 = Math.ceil(packedDim / 4);
  const paramsData = new Uint32Array([numQ, numD, dim, packedDimU32]);
  const paramsBuffer = createBuffer(_device, paramsData, GPUBufferUsage.UNIFORM);
  const queryBuffer = createBuffer(_device, queryFlat, GPUBufferUsage.STORAGE);
  const packedU32 = new Uint32Array(packed.buffer, packed.byteOffset, Math.ceil(packed.byteLength / 4));
  const packedBuffer = createBuffer(_device, packedU32, GPUBufferUsage.STORAGE);
  const minBuffer = createBuffer(_device, minArray, GPUBufferUsage.STORAGE);
  const scaleBuffer = createBuffer(_device, scaleArray, GPUBufferUsage.STORAGE);
  const normsBuffer = createBuffer(_device, docNorms, GPUBufferUsage.STORAGE);
  const qNormsBuffer = createBuffer(_device, queryNorms, GPUBufferUsage.STORAGE);

  const outputBuffer = _device.createBuffer({
    size: numQ * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const readBuffer = _device.createBuffer({
    size: numQ * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Bind group
  const bindGroup = _device.createBindGroup({
    layout: _pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: queryBuffer } },
      { binding: 2, resource: { buffer: packedBuffer } },
      { binding: 3, resource: { buffer: minBuffer } },
      { binding: 4, resource: { buffer: scaleBuffer } },
      { binding: 5, resource: { buffer: normsBuffer } },
      { binding: 6, resource: { buffer: qNormsBuffer } },
      { binding: 7, resource: { buffer: outputBuffer } },
    ],
  });

  // Dispatch
  const commandEncoder = _device.createCommandEncoder();
  const pass = commandEncoder.beginComputePass();
  pass.setPipeline(_pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(numQ / 64));
  pass.end();

  commandEncoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, numQ * 4);
  _device.queue.submit([commandEncoder.finish()]);

  // Read back results
  await readBuffer.mapAsync(GPUMapMode.READ);
  const results = new Float32Array(readBuffer.getMappedRange());
  let totalScore = 0;
  for (let qi = 0; qi < numQ; qi++) totalScore += results[qi];
  readBuffer.unmap();

  // Cleanup
  [paramsBuffer, queryBuffer, packedBuffer, minBuffer, scaleBuffer, normsBuffer, qNormsBuffer, outputBuffer, readBuffer]
    .forEach(b => b.destroy());

  return totalScore / numQ;
}

function createBuffer(device, data, usage) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: usage | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new data.constructor(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
