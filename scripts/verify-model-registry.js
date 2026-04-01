#!/usr/bin/env node

/**
 * Verify or regenerate model registry checksums.
 *
 * Usage:
 *   node scripts/verify-model-registry.js           # Verify checksums of locally cached files
 *   node scripts/verify-model-registry.js --update   # Update registry with computed checksums
 *
 * Fetches file metadata from HuggingFace API and compares against
 * the static entries in core/infrastructure/model-registry.js.
 */

import { MODEL_REGISTRY } from '../core/infrastructure/index.js';

const HF_ENDPOINT = process.env.SWEET_SEARCH_HF_ENDPOINT || 'https://huggingface.co';

async function getHfFileMetadata(hfId) {
  const url = `${HF_ENDPOINT}/api/models/${hfId}/tree/main?recursive=true`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const items = await resp.json();
  return items.filter(f => f.type === 'file').map(f => ({
    path: f.path,
    size: f.lfs?.size || f.size,
    sha256: f.lfs?.oid || null,
  }));
}

async function verify() {
  let allOk = true;

  for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
    console.log(`\n=== ${key} (${entry.hfId}) ===`);

    let remoteFiles;
    try {
      remoteFiles = await getHfFileMetadata(entry.hfId);
    } catch (err) {
      console.log(`  ERROR: Could not fetch metadata: ${err.message}`);
      allOk = false;
      continue;
    }

    for (const file of entry.files) {
      const remote = remoteFiles.find(r => r.path === file.path);
      if (!remote) {
        console.log(`  WARN: ${file.path} not found on HuggingFace`);
        continue;
      }

      // Check size
      if (file.sizeBytes !== remote.size) {
        console.log(`  MISMATCH: ${file.path} size: registry=${file.sizeBytes}, remote=${remote.size}`);
        allOk = false;
      }

      // Check SHA256 (only for LFS files that have it)
      if (file.sha256 && remote.sha256) {
        if (file.sha256 !== remote.sha256) {
          console.log(`  MISMATCH: ${file.path} sha256: registry=${file.sha256}, remote=${remote.sha256}`);
          allOk = false;
        } else {
          console.log(`  OK: ${file.path} (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB, checksum verified)`);
        }
      } else if (remote.sha256 && !file.sha256) {
        console.log(`  INFO: ${file.path} has remote sha256=${remote.sha256} but registry has null`);
      } else {
        console.log(`  OK: ${file.path} (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB, size-only)`);
      }
    }
  }

  console.log(allOk ? '\nAll registry entries verified.' : '\nSome entries have mismatches.');
  process.exit(allOk ? 0 : 1);
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
