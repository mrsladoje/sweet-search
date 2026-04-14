//
//  coreml_shim.m
//
//  Thin Objective-C wrapper around Apple's CoreML framework, exposed to
//  Rust via a plain C ABI. The Rust crate does NOT use objc2-core-ml —
//  instead it calls these symbols through `extern "C"` in coreml_shim.rs.
//
//  Design goals:
//    - Load a .mlpackage file and cache it with compute_units pinned to
//      CPU_AND_NE (ANE only + CPU fallback). The CoreML Metal GPU path
//      miscompiles our attention/MLP/normalisation chain and silently
//      produces garbage — verified on both NomicBERT embed and ModernBERT
//      LI in scripts/spike-coreml/test_coreml_*_parity.py. We NEVER want
//      to risk CoreML dispatching to the GPU, so we hard-pin compute_units
//      at load time.
//    - Accept int32 input_ids + int32 attention_mask (both [batch, seq])
//      and return float32 output. The only output shapes we care about
//      are:
//         embed: [batch, hidden]           (2D)
//         LI:    [batch, seq, token_dim]   (3D)
//      To keep the C ABI simple we expose a single `predict` call that
//      takes the expected output element count and a destination buffer;
//      the caller is responsible for interpreting the layout.
//    - No threads, no async. CoreML's synchronous `predictionFromFeatures`
//      is called directly. Caller (the Rust napi task) is already on a
//      libuv worker thread and the process-wide metal_lock mutex is
//      shared with the candle path.
//    - All errors are written to a caller-supplied buffer as NUL-terminated
//      UTF-8 for straightforward surfacing through napi::Error::from_reason.
//
//  This file uses ARC (-fobjc-arc) — NSStrings and NSArrays are autoreleased
//  automatically. Manual retain/release is never called here. The
//  CoremlHandle* that Rust holds contains bridged-retained references to
//  Obj-C objects so their lifetimes extend beyond the load call; the
//  handle is freed in sweet_coreml_free() which bridges the references
//  back and lets ARC release them.

#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

//==============================================================================
//  Public C ABI — declared here, used from Rust via extern "C" in coreml_shim.rs
//==============================================================================

typedef struct CoremlHandle CoremlHandle;

// Load an .mlpackage, pin compute_units to CPU_AND_NE, record input/output
// names and expected shapes, return a handle (or NULL on error).
//
// Error path: writes a NUL-terminated error message to error_out (up to
// error_out_len bytes including the terminator) and returns NULL.
//
// Ownership: on success returns a CoremlHandle* that must be freed with
// sweet_coreml_free(). On failure returns NULL and writes the error.
CoremlHandle* sweet_coreml_load(
    const char* mlpackage_path,
    const char* input_name_ids,
    const char* input_name_mask,
    const char* output_name,
    long batch,
    long seq,
    long output_dim0,  // for embed: hidden_size (768). for LI: seq length (same as seq).
    long output_dim1,  // for embed: 0 (unused, output is 2D). for LI: token_dim (128).
    char* error_out,
    size_t error_out_len
);

// Run a prediction. Returns 0 on success, non-zero on error with a message
// written to error_out.
//
// Input buffers:
//   ids_data    — batch*seq int32 values, row-major
//   mask_data   — batch*seq int32 values, row-major
// Output buffer:
//   output_data — batch*output_dim0*max(output_dim1,1) float32 values
//                 (caller pre-allocates; sizing must match what was
//                 reported at load time)
int sweet_coreml_predict(
    CoremlHandle* handle,
    const int32_t* ids_data,
    const int32_t* mask_data,
    float* output_data,
    char* error_out,
    size_t error_out_len
);

// Free a handle. Safe to call with NULL.
void sweet_coreml_free(CoremlHandle* handle);

//==============================================================================
//  Internal handle layout
//==============================================================================

// CoremlHandle is declared opaquely to the outside world. Internally it
// holds the retained MLModel and cached NSString input/output names (so
// we don't allocate a fresh NSString on every prediction), plus the
// shapes we need to size the input MLMultiArrays and interpret the
// output. The retained Obj-C objects are held as __strong ivars — under
// ARC this keeps them alive for the lifetime of the handle.

struct CoremlHandle {
    MLModel* __strong model;
    NSString* __strong input_name_ids;
    NSString* __strong input_name_mask;
    NSString* __strong output_name;
    long batch;
    long seq;
    long output_dim0;
    long output_dim1;  // 0 means 2D output, non-zero means 3D
    long output_elements;  // total f32 count the caller must provide
};

//==============================================================================
//  Helpers
//==============================================================================

// Copy an NSError description into the caller's error buffer, truncating
// safely. Used from every error branch in the public functions.
static void copy_error(NSError* err, const char* context, char* out, size_t out_len) {
    if (!out || out_len == 0) return;
    NSString* msg = err ? [NSString stringWithFormat:@"%s: %@", context, [err localizedDescription]]
                        : [NSString stringWithFormat:@"%s", context];
    const char* utf8 = [msg UTF8String];
    if (!utf8) utf8 = context;
    strncpy(out, utf8, out_len - 1);
    out[out_len - 1] = '\0';
}

// Copy a plain C string into the caller's error buffer.
static void copy_errstr(const char* ctx, char* out, size_t out_len) {
    if (!out || out_len == 0) return;
    strncpy(out, ctx, out_len - 1);
    out[out_len - 1] = '\0';
}

// Build an NSArray<NSNumber*>* from a C array of longs. Used for
// MLMultiArray shape + strides construction.
static NSArray<NSNumber*>* shape_array(const long* dims, size_t n) {
    NSMutableArray* arr = [NSMutableArray arrayWithCapacity:n];
    for (size_t i = 0; i < n; i++) {
        [arr addObject:@(dims[i])];
    }
    return arr;
}

// Row-major strides for a given shape. E.g. shape [32, 512] → strides [512, 1].
static NSArray<NSNumber*>* row_major_strides(const long* dims, size_t n) {
    NSMutableArray* arr = [NSMutableArray arrayWithCapacity:n];
    long running = 1;
    for (ssize_t i = (ssize_t)n - 1; i >= 0; i--) {
        [arr insertObject:@(running) atIndex:0];
        running *= dims[i];
    }
    return arr;
}

// Build an MLMultiArray of int32 by allocating a fresh buffer and
// copying `count` int32 values into it. Returns nil on error with the
// error written to `err`.
//
// We allocate + copy rather than wrapping the caller's pointer because
// CoreML's prediction may outlive the synchronous call (autorelease
// pools, batching, etc.) and the caller's buffer is not guaranteed
// stable past the return. For int32 inputs at batch×seq sizes this is
// kilobytes, not megabytes — the copy cost is negligible compared to
// the Metal compute.
static MLMultiArray* make_int32_input(const int32_t* src, long batch, long seq, NSError** err) {
    long dims[2] = { batch, seq };
    NSArray* shape = shape_array(dims, 2);
    // Use the 3-arg init which computes row-major strides automatically.
    // The 4-arg `initWithShape:dataType:strides:error:` doesn't exist —
    // strides is only exposed via initWithDataPointer: which we don't
    // want here (requires a pre-allocated external buffer).
    MLMultiArray* arr = [[MLMultiArray alloc] initWithShape:shape
                                                    dataType:MLMultiArrayDataTypeInt32
                                                       error:err];
    if (!arr) return nil;
    // Bulk fill via getMutableBytesWithHandler. The block gives us the
    // MLMultiArray's raw backing buffer for the duration of the call,
    // which lets us memcpy directly without any per-element boxing.
    __block BOOL ok = YES;
    [arr getMutableBytesWithHandler:^(void* mutableBytes, NSInteger sz, NSArray<NSNumber*>* mstrides) {
        if ((NSInteger)(batch * seq * sizeof(int32_t)) != sz) {
            ok = NO;
            return;
        }
        memcpy(mutableBytes, src, sz);
    }];
    return ok ? arr : nil;
}

//==============================================================================
//  sweet_coreml_load
//==============================================================================

CoremlHandle* sweet_coreml_load(
    const char* mlpackage_path,
    const char* input_name_ids,
    const char* input_name_mask,
    const char* output_name,
    long batch,
    long seq,
    long output_dim0,
    long output_dim1,
    char* error_out,
    size_t error_out_len
) {
    @autoreleasepool {
        if (!mlpackage_path || !input_name_ids || !input_name_mask || !output_name) {
            copy_errstr("sweet_coreml_load: null string argument", error_out, error_out_len);
            return NULL;
        }

        NSString* pathStr = [NSString stringWithUTF8String:mlpackage_path];
        NSURL* url = [NSURL fileURLWithPath:pathStr];

        // MLModel modelWithContentsOfURL: requires a COMPILED .mlmodelc
        // directory, not the raw .mlpackage source bundle. If we were
        // handed a path ending in .mlpackage we have to compile it
        // first via [MLModel compileModelAtURL:error:]. For .mlmodelc
        // paths (already compiled) we can load directly.
        //
        // compileModelAtURL returns a file URL in a system-managed
        // temp directory. macOS cleans it up automatically at some
        // unspecified future point, which is fine for our use case
        // because the compiled bundle is tiny (just metadata + index;
        // the weights live in the .mlpackage itself). Production code
        // may want to cache the compiled URL next to the .mlpackage
        // for faster subsequent loads, but that's a premature
        // optimisation for now.
        NSURL* loadUrl = url;
        NSError* err = nil;
        if ([pathStr hasSuffix:@".mlpackage"] || [pathStr hasSuffix:@".mlpackage/"]) {
            NSURL* compiledUrl = [MLModel compileModelAtURL:url error:&err];
            if (!compiledUrl) {
                copy_error(err, "MLModel compileModelAtURL failed", error_out, error_out_len);
                return NULL;
            }
            loadUrl = compiledUrl;
        }

        MLModelConfiguration* config = [[MLModelConfiguration alloc] init];
        // Hardcode CPU_AND_NE — the GPU path miscompiles our models. See
        // scripts/spike-coreml/test_coreml_*_parity.py for the broken
        // GPU results (NomicBERT embed: 0.56 cosine; ModernBERT LI: 0.40).
        config.computeUnits = MLComputeUnitsCPUAndNeuralEngine;

        MLModel* model = [MLModel modelWithContentsOfURL:loadUrl configuration:config error:&err];
        if (!model) {
            copy_error(err, "MLModel modelWithContentsOfURL failed", error_out, error_out_len);
            return NULL;
        }

        CoremlHandle* h = (CoremlHandle*)calloc(1, sizeof(CoremlHandle));
        if (!h) {
            copy_errstr("calloc CoremlHandle failed", error_out, error_out_len);
            return NULL;
        }
        // Transfer +1 retained references into the handle's __strong ivars.
        // Under ARC we just assign and the compiler emits the retain.
        h->model = model;
        h->input_name_ids = [NSString stringWithUTF8String:input_name_ids];
        h->input_name_mask = [NSString stringWithUTF8String:input_name_mask];
        h->output_name = [NSString stringWithUTF8String:output_name];
        h->batch = batch;
        h->seq = seq;
        h->output_dim0 = output_dim0;
        h->output_dim1 = output_dim1;
        // Embed output: [batch, output_dim0]  → batch*output_dim0 floats
        // LI output:    [batch, output_dim0, output_dim1] → batch*output_dim0*output_dim1 floats
        h->output_elements = (output_dim1 > 0)
            ? (batch * output_dim0 * output_dim1)
            : (batch * output_dim0);
        return h;
    }
}

//==============================================================================
//  sweet_coreml_predict
//==============================================================================

int sweet_coreml_predict(
    CoremlHandle* h,
    const int32_t* ids_data,
    const int32_t* mask_data,
    float* output_data,
    char* error_out,
    size_t error_out_len
) {
    @autoreleasepool {
        if (!h || !ids_data || !mask_data || !output_data) {
            copy_errstr("sweet_coreml_predict: null argument", error_out, error_out_len);
            return 1;
        }

        NSError* err = nil;

        // Build the two int32 input MLMultiArrays.
        MLMultiArray* ids_arr = make_int32_input(ids_data, h->batch, h->seq, &err);
        if (!ids_arr) {
            copy_error(err, "make_int32_input (ids)", error_out, error_out_len);
            return 2;
        }
        MLMultiArray* mask_arr = make_int32_input(mask_data, h->batch, h->seq, &err);
        if (!mask_arr) {
            copy_error(err, "make_int32_input (mask)", error_out, error_out_len);
            return 3;
        }

        // Wrap inputs in a MLDictionaryFeatureProvider.
        NSDictionary<NSString*, MLFeatureValue*>* featDict = @{
            h->input_name_ids:  [MLFeatureValue featureValueWithMultiArray:ids_arr],
            h->input_name_mask: [MLFeatureValue featureValueWithMultiArray:mask_arr],
        };
        MLDictionaryFeatureProvider* inputs =
            [[MLDictionaryFeatureProvider alloc] initWithDictionary:featDict error:&err];
        if (!inputs) {
            copy_error(err, "MLDictionaryFeatureProvider init", error_out, error_out_len);
            return 4;
        }

        id<MLFeatureProvider> outputs = [h->model predictionFromFeatures:inputs error:&err];
        if (!outputs) {
            copy_error(err, "MLModel predictionFromFeatures", error_out, error_out_len);
            return 5;
        }

        MLFeatureValue* outFeat = [outputs featureValueForName:h->output_name];
        if (!outFeat || outFeat.type != MLFeatureTypeMultiArray) {
            copy_errstr("output feature missing or wrong type", error_out, error_out_len);
            return 6;
        }
        MLMultiArray* outArr = outFeat.multiArrayValue;
        if (!outArr) {
            copy_errstr("outFeat.multiArrayValue was nil", error_out, error_out_len);
            return 7;
        }

        // Verify element count matches what the caller allocated for.
        long element_count = 1;
        for (NSNumber* d in outArr.shape) {
            element_count *= (long)[d longValue];
        }
        if (element_count != h->output_elements) {
            NSString* msg = [NSString stringWithFormat:
                @"output element count mismatch: expected %ld, got %ld (shape %@)",
                h->output_elements, element_count, outArr.shape];
            copy_errstr([msg UTF8String], error_out, error_out_len);
            return 8;
        }

        // Copy output. We expect the .mlpackage to emit Float32 per
        // convert_*.py (outputs=[ct.TensorType(name="...", dtype=np.float32)]).
        // getBytesWithHandler is the ARC-safe way to touch the raw
        // underlying buffer for a bulk read.
        __block BOOL ok = YES;
        __block NSString* shape_err = nil;
        if (outArr.dataType == MLMultiArrayDataTypeFloat32) {
            [outArr getBytesWithHandler:^(const void* bytes, NSInteger sz) {
                if ((NSInteger)(element_count * sizeof(float)) != sz) {
                    ok = NO;
                    return;
                }
                memcpy(output_data, bytes, sz);
            }];
        } else if (outArr.dataType == MLMultiArrayDataTypeFloat16) {
            // CoreML sometimes emits F16 even when the .mlpackage was
            // converted with dtype=np.float32 — happens when the model
            // runs entirely in FP16 on ANE and the output type hint is
            // not respected. Convert F16→F32 element by element. For our
            // target shapes (up to 32*2048*128 ≈ 8M floats) the per-call
            // copy is ~40 MB of memory — fast but not free.
            [outArr getBytesWithHandler:^(const void* bytes, NSInteger sz) {
                if ((NSInteger)(element_count * 2) != sz) {
                    ok = NO;
                    return;
                }
                const uint16_t* src = (const uint16_t*)bytes;
                // macOS provides __fp16 (IEEE half) as a built-in type.
                // We use a C-level conversion rather than vImage/Accelerate
                // to keep the shim free of extra framework deps.
                for (long i = 0; i < element_count; i++) {
                    __fp16 half;
                    memcpy(&half, &src[i], sizeof(uint16_t));
                    output_data[i] = (float)half;
                }
            }];
        } else {
            shape_err = [NSString stringWithFormat:@"unexpected output dtype: %ld", (long)outArr.dataType];
            ok = NO;
        }

        if (!ok) {
            if (shape_err) {
                copy_errstr([shape_err UTF8String], error_out, error_out_len);
            } else {
                copy_errstr("output extraction mismatch", error_out, error_out_len);
            }
            return 9;
        }

        return 0;
    }
}

//==============================================================================
//  sweet_coreml_free
//==============================================================================

void sweet_coreml_free(CoremlHandle* h) {
    if (!h) return;
    @autoreleasepool {
        // Null out the __strong ivars so ARC releases the retained objects.
        // Without this, the objects would leak because we're about to
        // free() the struct without running any destructor.
        h->model = nil;
        h->input_name_ids = nil;
        h->input_name_mask = nil;
        h->output_name = nil;
    }
    free(h);
}
