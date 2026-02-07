#!/usr/bin/env python3
"""
v4.5 Grid Search with CatBoost (Proper Implementation)

For each depth 4-12:
1. Train CatBoost model with proper sample weights
2. Export to JS using symmetric tree export
3. Evaluate training/validation accuracy
4. Output model file and metrics

Usage:
    source .venv/bin/activate
    python grid-search-catboost.py
"""

import json
import sys
from pathlib import Path
import numpy as np
from catboost import CatBoostClassifier, Pool

# Add the models directory to path for imports
sys.path.insert(0, str(Path(__file__).parent / 'models'))
from train_catboost import (
    load_training_data,
    train_catboost,
    evaluate_model,
    LABELS,
    LABEL_TO_INDEX,
    FEATURE_NAMES,
)
from export_catboost_to_js import generate_js_from_model

# =============================================================================
# UTILITY-ALIGNED RELABELING (THE ACTUAL FIX - per CATBOOST_FIX_PLAN.md)
# =============================================================================

# Question words that indicate non-ambiguous semantic queries
QUESTION_WORDS = {
    'how', 'what', 'why', 'where', 'when', 'which', 'who',
    'can', 'does', 'is', 'are', 'should', 'would', 'could'
}

# Structural keywords that indicate structural queries
STRUCTURAL_KEYWORDS = {
    'calls', 'callers', 'uses', 'implements', 'extends',
    'dependencies', 'impact', 'references', 'inherits'
}


def utility_align_label(query_text: str, label: str) -> str:
    """
    Align training labels to match benchmark utility expectations.

    This function implements the relabeling rules from CATBOOST_FIX_PLAN.md
    to fix the 73% utility plateau caused by training on wrong ground truth.

    The benchmark expects ~64% HYBRID but training data had only ~22-25% HYBRID.
    Key fixes:
    1. Non-ASCII queries should prefer HYBRID (not LEXICAL/STRUCTURAL)
    2. Short ambiguous ASCII phrases should prefer HYBRID

    Args:
        query_text: The query string
        label: Original label (LEXICAL, SEMANTIC, STRUCTURAL, HYBRID)

    Returns:
        Utility-aligned label
    """
    # Rule 1: Non-ASCII present → prefer HYBRID
    has_non_ascii = any(ord(c) > 127 for c in query_text)

    if has_non_ascii:
        # Non-ASCII identifiers and structural queries should route to HYBRID
        # because they need translation/embedding to work properly
        if label in ('LEXICAL', 'STRUCTURAL'):
            return 'HYBRID'
        # SEMANTIC/HYBRID unchanged - they work with non-ASCII
        return label

    # Rule 2: Short ambiguous ASCII phrase → HYBRID
    tokens = query_text.lower().split()

    if 1 <= len(tokens) <= 4:
        # Check if all tokens are lowercase alpha only
        if all(t.isalpha() and t.islower() for t in tokens):
            # Not a question word start
            if tokens[0] not in QUESTION_WORDS:
                # Not containing structural keywords
                if not any(t in STRUCTURAL_KEYWORDS for t in tokens):
                    # Single token guard: only if length ≤ 6
                    # (prevents relabeling true identifiers like "getattribute")
                    if len(tokens) == 1 and len(tokens[0]) > 6:
                        return label  # Keep longer single tokens as-is

                    # Apply HYBRID preference for ambiguous queries
                    if label in ('SEMANTIC', 'LEXICAL'):
                        return 'HYBRID'

    return label


# =============================================================================
# DATA LOADING (v4.5 Clean Mix)
# =============================================================================

def load_v45_clean_data():
    """
    Load v4.5 SURGICAL BALANCE data mix:
    - Original LLM Labeled Data (4,311 samples, weight 1.0) - 75% baseline
    - Hard Negatives (330 samples, weight 2.0) - 11% edge case correction
    - Multilingual Structural Push (750 samples PRUNED, weight 1.0) - 13% linguistic expansion

    Total: ~5,391 samples with balanced effective weights

    Previous v4.5 had "Structural Gravity" problem:
    - STRUCTURAL was 52% of weighted dataset causing overfit
    - CatBoost learned "non-ASCII = STRUCTURAL" breaking evaluation

    This balanced mix targets 95%+ Utility Accuracy.
    """
    output_dir = Path(__file__).parent / 'output'

    all_samples = []

    # Track relabeling stats
    relabel_stats = {'total': 0, 'relabeled': 0, 'by_rule': {'non_ascii': 0, 'short_ambiguous': 0}}

    # 1. Original data (weight 1.0) - BASELINE INTELLIGENCE
    original_path = output_dir / 'llm_labeled_data.json'
    if original_path.exists():
        with open(original_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        samples = data.get('samples', data)
        for s in samples:
            original_label = s.get('originalLabel', s.get('label'))
            if original_label in LABELS:
                query = s['query']
                # Apply utility alignment (THE FIX)
                aligned_label = utility_align_label(query, original_label)
                relabel_stats['total'] += 1
                if aligned_label != original_label:
                    relabel_stats['relabeled'] += 1
                    if any(ord(c) > 127 for c in query):
                        relabel_stats['by_rule']['non_ascii'] += 1
                    else:
                        relabel_stats['by_rule']['short_ambiguous'] += 1

                all_samples.append({
                    'query': query,
                    'label': aligned_label,
                    'originalLabel': original_label,
                    'features': s.get('features'),
                    'weight': 1.0,
                })
        print(f"  Original: {len([s for s in all_samples if s['weight'] == 1.0])} samples (weight 1.0)")

    # 2. Hard negatives (weight 2.0 - reduced from 5.0) - EDGE CASE CORRECTION
    hard_neg_path = output_dir / 'hard_negatives.json'
    if hard_neg_path.exists():
        with open(hard_neg_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        queries = data.get('queries', [])
        count_before = len(all_samples)
        for q in queries:
            original_label = q.get('label')
            if original_label in LABELS:
                query = q['query']
                # Apply utility alignment (THE FIX)
                aligned_label = utility_align_label(query, original_label)
                relabel_stats['total'] += 1
                if aligned_label != original_label:
                    relabel_stats['relabeled'] += 1
                    if any(ord(c) > 127 for c in query):
                        relabel_stats['by_rule']['non_ascii'] += 1
                    else:
                        relabel_stats['by_rule']['short_ambiguous'] += 1

                all_samples.append({
                    'query': query,
                    'label': aligned_label,
                    'originalLabel': original_label,
                    'features': q.get('features'),
                    'weight': 2.0,  # Reduced from 5.0 to prevent over-indexing
                })
        print(f"  Hard Negatives: {len(all_samples) - count_before} samples (weight 2.0)")

    # 3. Multilingual Structural Push (weight 1.0, PRUNED to 750) - LINGUISTIC EXPANSION
    multilingual_path = output_dir / 'multilingual_structural_push.json'
    if multilingual_path.exists():
        with open(multilingual_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        queries = data.get('queries', [])

        # PRUNE: Take only 750 samples (50% of original 1,500)
        # Use deterministic sampling to ensure reproducibility and language balance
        pruned_queries = prune_multilingual_balanced(queries, target_count=750)

        count_before = len(all_samples)
        for q in pruned_queries:
            original_label = q.get('label')
            if original_label in LABELS:
                query = q['query']
                # Apply utility alignment (THE FIX)
                # This is CRITICAL: multilingual structural queries should become HYBRID
                aligned_label = utility_align_label(query, original_label)
                relabel_stats['total'] += 1
                if aligned_label != original_label:
                    relabel_stats['relabeled'] += 1
                    if any(ord(c) > 127 for c in query):
                        relabel_stats['by_rule']['non_ascii'] += 1
                    else:
                        relabel_stats['by_rule']['short_ambiguous'] += 1

                all_samples.append({
                    'query': query,
                    'label': aligned_label,
                    'originalLabel': original_label,
                    'features': q.get('features'),
                    'weight': 1.0,  # Reduced from 3.0 to prevent structural gravity
                })
        print(f"  Multilingual Structural: {len(all_samples) - count_before} samples (weight 1.0, pruned from {len(queries)})")

    print(f"  Total: {len(all_samples)} samples")

    # Print relabeling stats
    print(f"\n  Utility Alignment (THE FIX):")
    print(f"    Total samples: {relabel_stats['total']}")
    print(f"    Relabeled: {relabel_stats['relabeled']} ({relabel_stats['relabeled']/max(1,relabel_stats['total'])*100:.1f}%)")
    print(f"      - Non-ASCII → HYBRID: {relabel_stats['by_rule']['non_ascii']}")
    print(f"      - Short ambiguous → HYBRID: {relabel_stats['by_rule']['short_ambiguous']}")

    # Convert to numpy arrays
    return convert_samples_to_arrays(all_samples)


def prune_multilingual_balanced(queries, target_count=750):
    """
    Prune multilingual queries to target_count while maintaining language balance.

    Takes equal samples from each language group to prevent any single
    language from dominating the training signal.
    """
    # Group by language (detected from script)
    from collections import defaultdict

    language_groups = defaultdict(list)

    for q in queries:
        query_text = q.get('query', '')
        lang = detect_script_language(query_text)
        language_groups[lang].append(q)

    # Calculate per-language quota
    num_languages = len(language_groups)
    per_language = target_count // num_languages if num_languages > 0 else target_count

    print(f"    Pruning: {len(queries)} → {target_count} ({num_languages} languages, ~{per_language} each)")

    # Take balanced samples from each language
    pruned = []
    for lang, group in sorted(language_groups.items()):
        # Take first N samples (deterministic)
        take = min(per_language, len(group))
        pruned.extend(group[:take])
        print(f"      {lang}: {take} samples")

    # If we need more to reach target, round-robin from remaining
    remaining_needed = target_count - len(pruned)
    if remaining_needed > 0:
        all_remaining = []
        for lang, group in sorted(language_groups.items()):
            all_remaining.extend(group[per_language:])
        pruned.extend(all_remaining[:remaining_needed])

    return pruned[:target_count]


def detect_script_language(text):
    """Detect language from Unicode script ranges."""
    # Count characters in each script
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04FF')
    cjk = sum(1 for c in text if '\u4E00' <= c <= '\u9FFF')
    hiragana = sum(1 for c in text if '\u3040' <= c <= '\u309F')
    katakana = sum(1 for c in text if '\u30A0' <= c <= '\u30FF')
    german_special = sum(1 for c in text if c in 'äöüÄÖÜß')

    japanese = hiragana + katakana

    # Determine primary script
    if cyrillic > 3:
        return 'cyrillic'  # Serbian, Russian
    elif cjk > 2:
        return 'chinese'
    elif japanese > 2:
        return 'japanese'
    elif german_special > 0:
        return 'german'
    else:
        return 'latin'


def convert_samples_to_arrays(all_samples):
    """Convert sample list to numpy arrays for CatBoost training."""
    from train_catboost import extract_features

    X = []
    y = []
    weights = []

    for sample in all_samples:
        query = sample['query']
        label = sample['label']

        if label not in LABELS:
            continue

        # Use pre-extracted features if available
        if sample.get('features'):
            features = sample['features']
        else:
            features = extract_features(query)

        X.append(features)
        y.append(LABEL_TO_INDEX[label])
        weights.append(sample['weight'])

    return (
        np.array(X, dtype=np.float32),
        np.array(y, dtype=np.int32),
        np.array(weights, dtype=np.float32)
    )


# =============================================================================
# GRID SEARCH
# =============================================================================

def run_grid_search(depths=[4, 6, 8, 10]):
    """
    Run CatBoost training for each depth and collect metrics.

    CHANGES per CATBOOST_FIX_PLAN.md:
    - Default depths: [4, 6, 8, 10] to avoid OOM with depth 11/12
    - Class weights: HYBRID (index 3) weighted 3.0 to favor safe max-recall
    - Utility alignment: Labels are aligned before training
    """

    print("═" * 65)
    print("v4.5 UTILITY-ALIGNED - CATBOOST GRID SEARCH")
    print("═" * 65)
    print("  FIXES per CATBOOST_FIX_PLAN.md:")
    print("    1. Utility-aligned relabeling (non-ASCII + ambiguous → HYBRID)")
    print("    2. HYBRID bias via class_weights={3: 3.0}")
    print("    3. Depths limited to [4,6,8,10] (OOM protection)")
    print("  Target: ≥99% Utility Accuracy (315 queries)")
    print()

    # Load clean data (with utility alignment applied)
    print("Loading v4.5 data with utility alignment...")
    X, y, weights = load_v45_clean_data()

    # Label distribution with percentages (VERIFY: HYBRID should be ~64%)
    print("\nLabel distribution (after utility alignment):")
    total_samples = len(y)
    total_weighted = np.sum(weights)
    hybrid_count = 0

    for i, label in enumerate(LABELS):
        count = np.sum(y == i)
        weighted_count = np.sum(weights[y == i])
        pct = count / total_samples * 100
        wpct = weighted_count / total_weighted * 100
        marker = " ← TARGET ~64%" if label == 'HYBRID' else ""
        print(f"  {label}: {count} ({pct:.1f}%), weighted: {weighted_count:.0f} ({wpct:.1f}%){marker}")
        if label == 'HYBRID':
            hybrid_count = count

    # Verify HYBRID proportion
    hybrid_pct = hybrid_count / total_samples * 100
    if hybrid_pct >= 60:
        print(f"\n  ✅ HYBRID proportion {hybrid_pct:.1f}% is close to benchmark 64.1%")
    else:
        print(f"\n  ⚠️  HYBRID proportion {hybrid_pct:.1f}% may be too low (benchmark expects 64.1%)")

    # Weight distribution
    print("\nWeight distribution:")
    for w in sorted(np.unique(weights)):
        print(f"  {w:.1f}: {np.sum(weights == w)} samples")

    # Train/val split with deterministic shuffle
    print("\nSplitting data (80/20)...")
    def shuffle_with_seed(n, seed=42):
        indices = list(range(n))
        for i in range(n - 1, 0, -1):
            seed = (seed * 9301 + 49297) % 233280
            j = int((seed / 233280) * (i + 1))
            indices[i], indices[j] = indices[j], indices[i]
        return indices

    indices = shuffle_with_seed(len(X), seed=42)
    split_idx = int(len(X) * 0.8)

    train_idx, val_idx = indices[:split_idx], indices[split_idx:]
    X_train, X_val = X[train_idx], X[val_idx]
    y_train, y_val = y[train_idx], y[val_idx]
    w_train, w_val = weights[train_idx], weights[val_idx]

    print(f"  Training: {len(X_train)}, Validation: {len(X_val)}")

    # Output directory
    output_dir = Path(__file__).parent / 'output'
    output_dir.mkdir(exist_ok=True)

    # Grid search
    print("\n" + "═" * 65)
    print("TRAINING GRID SEARCH")
    print("═" * 65)

    results = []

    # Class weights: HYBRID bias per CATBOOST_FIX_PLAN.md
    # Index 0=LEXICAL, 1=SEMANTIC, 2=STRUCTURAL, 3=HYBRID
    # Weight HYBRID higher to favor safe max-recall routing
    # Increased from 3.0 to 5.0 to push more uncertain cases to HYBRID
    CLASS_WEIGHTS = {0: 1.0, 1: 1.0, 2: 1.0, 3: 5.0}
    print(f"\nClass weights: {CLASS_WEIGHTS}")
    print("  (HYBRID weighted 5.0 to strongly favor safe max-recall path)")

    for depth in depths:
        print(f"\n--- Depth {depth} ---")

        # Train CatBoost with sample weights AND class weights
        model = CatBoostClassifier(
            iterations=500,
            depth=depth,
            learning_rate=0.1,
            loss_function='MultiClass',
            classes_count=len(LABELS),
            class_weights=CLASS_WEIGHTS,  # HYBRID bias (THE FIX - Phase 2)
            l2_leaf_reg=3.0,
            early_stopping_rounds=50,
            thread_count=-1,
            random_seed=42,
            verbose=False,
        )

        train_pool = Pool(X_train, y_train, weight=w_train, feature_names=FEATURE_NAMES)
        val_pool = Pool(X_val, y_val, weight=w_val, feature_names=FEATURE_NAMES)

        model.fit(train_pool, eval_set=val_pool)

        # Evaluate
        train_preds = model.predict(X_train).flatten()
        val_preds = model.predict(X_val).flatten()

        train_acc = np.mean(train_preds == y_train)
        val_acc = np.mean(val_preds == y_val)

        # Save model
        model_path = output_dir / f'v45_depth{depth}.cbm'
        model.save_model(str(model_path))

        # Export to JS
        js_code = generate_js_from_model(model)
        js_path = output_dir / f'v45_router_d{depth}.js'
        with open(js_path, 'w') as f:
            f.write(js_code)

        # Get model info
        tree_count = model.tree_count_
        best_iteration = model.get_best_iteration() or tree_count

        # Feature importance (top 5)
        importance = model.get_feature_importance()
        top_features = sorted(zip(FEATURE_NAMES, importance), key=lambda x: -x[1])[:5]

        results.append({
            'depth': depth,
            'train_acc': train_acc,
            'val_acc': val_acc,
            'trees': tree_count,
            'best_iter': best_iteration,
            'model_path': str(model_path),
            'js_path': str(js_path),
            'js_lines': len(js_code.splitlines()),
        })

        print(f"  Train: {train_acc:.1%}, Val: {val_acc:.1%}")
        print(f"  Trees: {tree_count} (best iter: {best_iteration})")
        print(f"  Model: {model_path.name}")
        print(f"  JS: {js_path.name} ({results[-1]['js_lines']} lines)")
        print(f"  Top features: {', '.join(f[0] for f in top_features[:3])}")

    # Summary table
    print("\n\n" + "═" * 65)
    print("GRID SEARCH RESULTS")
    print("═" * 65)
    print()
    print("Depth | Train Acc | Val Acc  | Trees | JS Lines")
    print("------|-----------|----------|-------|----------")

    for r in results:
        print(
            f"  {r['depth']:2}  | "
            f"{r['train_acc']*100:8.1f}% | "
            f"{r['val_acc']*100:7.1f}% | "
            f"{r['trees']:5} | "
            f"{r['js_lines']:8}"
        )

    # Find best by validation accuracy
    best = max(results, key=lambda r: r['val_acc'])

    print("\n" + "═" * 65)
    print("RECOMMENDATION")
    print("═" * 65)
    print()
    print(f"🏆 Best Depth: {best['depth']}")
    print(f"   Validation Accuracy: {best['val_acc']:.1%}")
    print(f"   Training Accuracy: {best['train_acc']:.1%}")
    print(f"   Trees: {best['trees']}")
    print(f"   JS Export: {Path(best['js_path']).name}")

    # Save results
    results_path = output_dir / 'v45_grid_search_results.json'
    with open(results_path, 'w') as f:
        json.dump({
            'generated': __import__('datetime').datetime.now().isoformat(),
            'training_size': len(X_train),
            'validation_size': len(X_val),
            'results': results,
            'recommendation': {
                'depth': best['depth'],
                'val_acc': best['val_acc'],
                'train_acc': best['train_acc'],
            },
        }, f, indent=2)

    print(f"\n📊 Results saved to: {results_path.name}")
    print("\n⚠️  Next: Run benchmark evaluation on each depth:")
    print("   node evaluation/run-evaluation.js --router=output/v45_router_d<DEPTH>.js")

    return results


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--depths', type=str, default='4,6,8,10',
                        help='Comma-separated list of depths to train (e.g., "3,4,6,8,10")')
    args = parser.parse_args()
    depths = [int(d.strip()) for d in args.depths.split(',')]
    run_grid_search(depths=depths)
