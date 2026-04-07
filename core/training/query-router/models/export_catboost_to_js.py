#!/usr/bin/env python3
"""
Export CatBoost model to pure JavaScript decision tree code.

CatBoost uses symmetric (oblivious) decision trees where:
- All nodes at the same depth use the same split feature/threshold
- This makes them very efficient to export as nested if/else

Usage:
    python export_catboost_to_js.py --model query_router.cbm --output catboost_router.js
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from catboost import CatBoostClassifier


# Label mapping (matches train_catboost.py LABEL_TO_INDEX)
# When model stores integer indices, map back to these strings
LABELS = ['LEXICAL', 'SEMANTIC', 'HYBRID']

FEATURE_NAMES = [
    # Base features (0-14)
    'hasCamelBoundary', 'hasUnderscoreWord', 'startsWithUppercase',
    'hasConsecutiveUppercase', 'isSingleToken', 'hasDotNotation',
    'hasParentheses', 'hasFileExtension', 'hasPathSeparator',
    'tokenCount', 'avgTokenLength', 'uppercaseRatio', 'digitRatio',
    'nonAsciiRatio', 'hasNonLatinScript',
    # Structural features (15-19)
    'hasCallerPattern', 'hasCalleePattern', 'hasImplementationPattern',
    'hasImpactPattern', 'hasIdentifierInQuery',
    # Semantic features (20-24)
    'startsWithQuestionWord', 'endsWithQuestionMark', 'hasSemanticConceptWord',
    'hasExplanationRequest', 'hasHowDoesWorkPattern',
    # Multilingual features (25-29)
    'hasNonAsciiIdentifier', 'hasMixedScriptToken', 'hasStructuralKeywordNonEn',
    'hasSemanticKeywordNonEn', 'hasCrossScriptConcept',
    # Discriminative features (30-33)
    'identifierAtStart', 'identifierAtEnd', 'hasExplicitStructuralKeyword',
    'hasUnknownTrailingContent',
    # Grammar features (34-37)
    'identifierIndex', 'hasActionVerb', 'hasQuestionIdentifier',
    'structuralKeywordCount',
    # Final Push features (38-42)
    'hasVerifiedAsciiIdentifier', 'structuralTemplateMatch',
    'hasNonEnglishConceptStem', 'pureNativeLanguageScore',
    'expandedStructuralKeywordPresence',
]


def load_model(model_path: str) -> CatBoostClassifier:
    """Load a trained CatBoost model."""
    model = CatBoostClassifier()
    model.load_model(model_path)
    return model


def export_to_json(model: CatBoostClassifier, output_path: str):
    """Export model to JSON format for inspection."""
    model.save_model(output_path, format='json')


def generate_js_from_model(model: CatBoostClassifier) -> str:
    """
    Generate pure JavaScript code from CatBoost model.

    CatBoost symmetric trees: each tree has depth d, with 2^d leaf values.
    The tree structure is defined by:
    - split_features: which feature to split on at each depth
    - split_conditions: threshold values for each split
    - leaf_values: output values for each leaf (for multi-class: num_leaves * num_classes)
    """
    # Get labels from model (CRITICAL: order matters!)
    # If model.classes_ returns integers, use our LABELS constant
    raw_classes = list(model.classes_)
    if all(isinstance(c, (int, np.integer)) for c in raw_classes):
        # Model trained with integer targets - map back to string labels
        labels = LABELS
        print(f"  Using LABELS constant (model has integer classes: {raw_classes})")
    else:
        labels = [str(c) for c in raw_classes]
        print(f"  Using model.classes_: {labels}")
    num_classes = len(labels)

    # Export to temporary JSON to get tree structure
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        temp_path = f.name
    model.save_model(temp_path, format='json')

    with open(temp_path, 'r') as f:
        model_data = json.load(f)

    Path(temp_path).unlink()  # Clean up

    # Extract tree info
    oblivious_trees = model_data.get('oblivious_trees', [])
    num_trees = len(oblivious_trees)

    # Generate JavaScript code with correct label order from model
    labels_json = json.dumps(labels)
    lines = [
        '/**',
        ' * CatBoost Query Router - Auto-generated from trained model',
        f' * Trees: {num_trees}',
        f' * Classes: {num_classes} ({", ".join(labels)})',
        ' * ',
        ' * This is pure JavaScript - no native dependencies required.',
        ' */',
        '',
        f'const LABELS = {labels_json};',
        '',
        '/**',
        ' * Route a query using the CatBoost model.',
        ' * @param {number[]} features - Array of 38 features',
        ' * @returns {{mode: string, confidence: number, scores: number[]}}',
        ' */',
        'function routeQueryCatBoost(features) {',
        '  // Accumulate scores across all trees',
        f'  const scores = new Array({num_classes}).fill(0);  // {", ".join(labels)}',
        '',
    ]

    # Generate code for each tree
    for tree_idx, tree in enumerate(oblivious_trees):
        splits = tree.get('splits', [])
        leaf_values = tree.get('leaf_values', [])

        if not splits or not leaf_values:
            continue

        depth = len(splits)
        num_leaves = 2 ** depth

        lines.append(f'  // Tree {tree_idx} (depth={depth})')
        lines.append('  {')

        # Build the leaf index calculation
        # For symmetric trees: leaf_idx = sum(bit_i * 2^i) where bit_i = (feature_i > threshold_i)
        index_parts = []
        for i, split in enumerate(splits):
            feature_idx = split.get('float_feature_index', split.get('feature_index', 0))
            threshold = split.get('border', split.get('threshold', 0))
            feature_name = FEATURE_NAMES[feature_idx] if feature_idx < len(FEATURE_NAMES) else f'f{feature_idx}'

            # CatBoost uses: go right if feature > threshold
            bit_shift = i
            index_parts.append(f'((features[{feature_idx}] > {threshold}) << {bit_shift})')

        lines.append(f'    const leafIdx = {" | ".join(index_parts)};')

        # Generate leaf value lookup
        # For multi-class, leaf_values is flat: [leaf0_class0, leaf0_class1, ..., leaf0_classN, leaf1_class0, ...]
        lines.append('    switch (leafIdx) {')

        for leaf_idx in range(num_leaves):
            # Extract values for this leaf
            start_idx = leaf_idx * num_classes
            values = leaf_values[start_idx:start_idx + num_classes]
            if len(values) == num_classes:
                score_updates = '; '.join(f'scores[{i}] += {values[i]:.6f}' for i in range(num_classes))
                lines.append(f'      case {leaf_idx}: {score_updates}; break;')

        lines.append('    }')
        lines.append('  }')
        lines.append('')

    # Add final classification logic
    lines.extend([
        '  // Find winning class',
        '  let maxIdx = 0;',
        '  let maxScore = scores[0];',
        f'  for (let i = 1; i < {num_classes}; i++) {{',
        '    if (scores[i] > maxScore) {',
        '      maxScore = scores[i];',
        '      maxIdx = i;',
        '    }',
        '  }',
        '',
        '  // Calculate confidence via softmax',
        '  const expScores = scores.map(s => Math.exp(s));',
        '  const sumExp = expScores.reduce((a, b) => a + b, 0);',
        '  const probs = expScores.map(e => e / sumExp);',
        '  const confidence = probs[maxIdx];',
        '',
        '  return {',
        '    mode: LABELS[maxIdx],',
        '    confidence,',
        '    scores,',
        '    probs,',
        '  };',
        '}',
        '',
        'export { routeQueryCatBoost, LABELS };',
    ])

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='Export CatBoost to JavaScript')
    parser.add_argument('--model', type=str, required=True, help='Input .cbm model file')
    parser.add_argument('--output', type=str, default='catboost_router.js', help='Output JS file')
    parser.add_argument('--json', type=str, help='Also export to JSON (for debugging)')

    args = parser.parse_args()

    print(f'Loading model from {args.model}...')
    model = load_model(args.model)

    print(f'Model info:')
    print(f'  Trees: {model.tree_count_}')
    print(f'  Classes: {model.classes_.tolist() if hasattr(model, "classes_") else "N/A"}')

    if args.json:
        print(f'Exporting to JSON: {args.json}')
        export_to_json(model, args.json)

    print(f'Generating JavaScript code...')
    js_code = generate_js_from_model(model)

    with open(args.output, 'w') as f:
        f.write(js_code)

    print(f'✓ Exported to {args.output}')
    print(f'  Lines of code: {len(js_code.splitlines())}')


if __name__ == '__main__':
    main()
