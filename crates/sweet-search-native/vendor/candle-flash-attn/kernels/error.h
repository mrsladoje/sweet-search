#pragma once

#include <cuda_runtime.h>

// sweet-search patch: upstream defines C10_CUDA_CHECK as a no-op, so a
// kernel that cannot launch (for example sm_80 SASS on sm_90+) leaves the
// output buffer uninitialised and nothing reports it. The check now keeps
// the first error of the current run_mha call; run_mha returns it.
extern thread_local cudaError_t flash_attn_first_error;

#define C10_CUDA_CHECK(EXPR)                                        \
  do {                                                              \
    const cudaError_t __err = EXPR;                                 \
    if (__err != cudaSuccess && flash_attn_first_error == cudaSuccess) \
      flash_attn_first_error = __err;                               \
  } while (0)

#define C10_CUDA_KERNEL_LAUNCH_CHECK() C10_CUDA_CHECK(cudaGetLastError())
