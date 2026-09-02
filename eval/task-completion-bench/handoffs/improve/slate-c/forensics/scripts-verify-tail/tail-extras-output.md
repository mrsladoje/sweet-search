## 1. Head (through last edit) vs tail cost per rollout
| cell | rollout $ | head $ | tail $ | head req | tail req |
| codex/native | 0.012287 | 0.009565 | 0.002723 | 13.98 | 4.86 |
| codex/sweet | 0.012330 | 0.009633 | 0.002697 | 14.56 | 5.05 |
| opencode/native | 0.008969 | 0.006616 | 0.002352 | 11.11 | 5.21 |
| opencode/sweet | 0.009265 | 0.007312 | 0.001953 | 14.92 | 4.77 |
| claude-code/native | 0.016542 | 0.014067 | 0.002475 | 19.92 | 4.38 |
| claude-code/sweet | 0.016500 | 0.014057 | 0.002444 | 19.22 | 4.23 |

## 2. Plan-tool requests
| cell | plan calls | plan-only requests | per rollout | share of requests | attributed $ share | counterfactual saving/req | saving/rollout | share of rollout $ | first-request plan | in tail | plan->plan consecutive |
| codex/native | 273 | 273 | 4.14 | 21.9% | 28.0% | $0.000390 | $0.001615 | 13.1% | 63 | 99 | 0 |
| codex/sweet | 259 | 259 | 3.92 | 20.0% | 27.4% | $0.000374 | $0.001469 | 11.9% | 66 | 111 | 0 |
| opencode/native | 259 | 259 | 3.92 | 24.0% | 26.5% | $0.000289 | $0.001132 | 12.6% | 66 | 118 | 0 |
| opencode/sweet | 250 | 250 | 3.79 | 19.2% | 23.2% | $0.000266 | $0.001006 | 10.9% | 66 | 108 | 0 |
| claude-code/native | 135 | 135 | 2.05 | 8.4% | 12.4% | $0.000296 | $0.000605 | 3.7% | 40 | 52 | 28 |
| claude-code/sweet | 126 | 126 | 1.91 | 8.2% | 15.6% | $0.000318 | $0.000606 | 3.7% | 47 | 54 | 14 |

Predecessor class of plan-only requests and edit->plan adjacency:
  codex/native: predecessors [('native_read', 68), ('edit', 59), ('git_diff_status', 37), ('run_tests', 34), ('rt_poll', 11), ('direct_test', 1)] ; edit requests 130, followed by a plan-only request 59 (45%)
  codex/sweet: predecessors [('edit', 61), ('ss_read_other', 44), ('git_diff_status', 38), ('run_tests', 22), ('ss_search', 17), ('rt_poll', 9)] ; edit requests 119, followed by a plan-only request 61 (51%)
  opencode/native: predecessors [('edit', 63), ('native_read', 53), ('git_diff_status', 44), ('run_tests', 26), ('native_find', 4), ('reread_edited', 3)] ; edit requests 125, followed by a plan-only request 63 (50%)
  opencode/sweet: predecessors [('edit', 65), ('git_diff_status', 42), ('ss_read_other', 41), ('run_tests', 25), ('ss_search', 8), ('native_read', 2)] ; edit requests 130, followed by a plan-only request 65 (50%)
  claude-code/native: predecessors [('plan', 28), ('git_diff_status', 23), ('edit', 19), ('run_tests', 14), ('native_read', 5), ('native_find', 3)] ; edit requests 321, followed by a plan-only request 19 (6%)
  claude-code/sweet: predecessors [('git_diff_status', 18), ('run_tests', 15), ('plan', 14), ('edit', 13), ('ss_read_other', 11), ('ss_search', 6)] ; edit requests 255, followed by a plan-only request 13 (5%)

## 3. Post-edit retrieval prevalence
| cell | rollouts with tail retrieval | mean tail retrieval req | solved mean | unsolved mean | tail retrieval $/rollout |
| codex/native | 17/66 | 0.33 | 0.34 | 0.32 | $0.000231 |
| codex/sweet | 9/66 | 0.29 | 0.31 | 0.26 | $0.000181 |
| opencode/native | 14/66 | 0.42 | 0.27 | 0.68 | $0.000209 |
| opencode/sweet | 7/66 | 0.20 | 0.22 | 0.16 | $0.000092 |
| claude-code/native | 21/66 | 0.50 | 0.47 | 0.57 | $0.000290 |
| claude-code/sweet | 19/65 | 0.72 | 0.88 | 0.48 | $0.000412 |

aws-actions__configure-aws-credentials-42 per rollout (tail req, tail $, retrieval req in tail, calls naming dist/ in tail, edited files):
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/native/r0 solved=True n_req=14 tail=5 tail$=0.002072 rollout$=0.007719 retrieval=0 dist_calls=0 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/native/r1 solved=True n_req=18 tail=4 tail$=0.001859 rollout$=0.009426 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/native/r2 solved=True n_req=16 tail=3 tail$=0.001344 rollout$=0.008125 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0 solved=True n_req=22 tail=11 tail$=0.005501 rollout$=0.011004 retrieval=5 dist_calls=4 edited=['action.yml', 'index.js']
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1 solved=True n_req=25 tail=3 tail$=0.001466 rollout$=0.012374 retrieval=0 dist_calls=0 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r2 solved=True n_req=19 tail=4 tail$=0.002188 rollout$=0.010023 retrieval=0 dist_calls=0 edited=['action.yml', 'index.js']
  fp-opencode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r0 solved=True n_req=13 tail=5 tail$=0.001853 rollout$=0.005832 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-opencode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r1 solved=True n_req=11 tail=5 tail$=0.001790 rollout$=0.004875 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-opencode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r2 solved=True n_req=12 tail=6 tail$=0.002166 rollout$=0.005627 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r0 solved=True n_req=21 tail=13 tail$=0.004949 rollout$=0.007748 retrieval=5 dist_calls=6 edited=['action.yml', 'index.js']
  rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r1 solved=True n_req=24 tail=5 tail$=0.003209 rollout$=0.012928 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r2 solved=True n_req=28 tail=5 tail$=0.001824 rollout$=0.011124 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r0 solved=True n_req=18 tail=4 tail$=0.001697 rollout$=0.009725 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r1 solved=True n_req=29 tail=4 tail$=0.001770 rollout$=0.013239 retrieval=0 dist_calls=1 edited=['action.yml', 'dist/index.js', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r2 solved=True n_req=28 tail=2 tail$=0.001019 rollout$=0.016490 retrieval=0 dist_calls=0 edited=['README.md', 'action.yml', 'dist/index.js', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0 solved=True n_req=25 tail=7 tail$=0.003044 rollout$=0.012193 retrieval=2 dist_calls=0 edited=['action.yml', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1 solved=True n_req=24 tail=14 tail$=0.005467 rollout$=0.011523 retrieval=8 dist_calls=9 edited=['action.yml', 'index.js']
  fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r2 solved=True n_req=17 tail=9 tail$=0.003220 rollout$=0.008598 retrieval=4 dist_calls=1 edited=['action.yml', 'index.js']

ss-grep/ss-read/ss-semantic calls naming dist/index.js in sweet rollouts, with the output head:
  codex aws-actions__configure-aws-credentials-42/r0 req13 tail :: 'ss-grep "AWS_ACCESS_KEY_ID" --in dist/index.js -k 10' -> '# ss-grep: 0 total match(es) for /AWS_ACCESS_KEY_ID/ (scope: --in dist/index.js)\n(no matches)\n'
  codex aws-actions__configure-aws-credentials-42/r0 req14 tail :: 'ss-read dist/index.js 1 20' -> '# ss-read dist/index.js (lines 1-20 of 35000)\n```\n1\tmodule.exports =\n2\t/******/ (function(modules, runtime) { '
  codex aws-actions__configure-aws-credentials-42/r0 req15 tail :: 'ss-semantic dist/index.js "run reads optional AWS access key ID and secret access key and ' -> '# ss-semantic dist/index.js | "run reads optional AWS access key ID and secret access key and exports credenti'
  codex aws-actions__configure-aws-credentials-42/r0 req17 tail :: 'ss-grep "aws-access-key-id|getInput|exportCredentials" --in dist/index.js -k 20' -> '# ss-grep: 0 total match(es) for /aws-access-key-id|getInput|exportCredentials/ (scope: --in dist/index.js)\n(n'
  codex aws-actions__configure-aws-credentials-42/r1 req8 head :: "ss-grep 'dist/index.js|ncc|build' -k 20 && ss-read package.json 1 120" -> '# ss-grep: 3 total match(es) for /dist/index.js|ncc|build/ across 2 files\naction.yml:45: dist/index.js\npackage'
  codex aws-actions__configure-aws-credentials-42/r1 req16 head :: 'ss-semantic dist/index.js "export AWS access key and secret credentials and validate actio' -> '# ss-semantic dist/index.js | "export AWS access key and secret credentials and validate action inputs" | span'
  codex aws-actions__configure-aws-credentials-42/r1 req19 head :: 'rg -n -F -C 8 "AWS_ACCESS_KEY_ID" dist/index.js | head -80' -> '214-  return nameTruncated\n215-}\n216-\n217-function exportCredentials(params){\n218-  // Configure the AWS CLI a'
  codex aws-actions__configure-aws-credentials-42/r1 req20 head :: 'rg -n -F -C 10 "core.getInput(\'aws-access-key-id\'" dist/index.js' -> '261-  return new aws.STS({\n262-    region,\n263-    endpoint,\n264-    customUserAgent: USER_AGENT\n265-  });\n266'
  opencode aws-actions__configure-aws-credentials-42/r0 req15 tail :: 'ss-read dist/index.js 1 5' -> '# ss-read dist/index.js (lines 1-5 of 35000)\n```\nmodule.exports =\n/******/ (function(modules, runtime) { // we'
  opencode aws-actions__configure-aws-credentials-42/r0 req16 tail :: 'ss-semantic dist/index.js "run function reads aws access key id and secret access key then' -> '# ss-semantic dist/index.js | "run function reads aws access key id and secret access key then exports credent'
  opencode aws-actions__configure-aws-credentials-42/r0 req17 tail :: 'ss-read dist/index.js 34500 35000' -> '...output truncated...\n\nFull output saved to: /root/.local/share/opencode/tool-output/tool_0449743ea001Nc4DVM9'
  opencode aws-actions__configure-aws-credentials-42/r0 req18 tail :: 'ss-read dist/index.js 500 850' -> '# ss-read dist/index.js (lines 500-850 of 35000)\n```\n500\t      var ename = escape(name);\n501\t      var result '
  opencode aws-actions__configure-aws-credentials-42/r1 req13 head :: 'ss-read dist/index.js 1 20' -> '# ss-read dist/index.js (lines 1-20 of 35000)\n```\n1\tmodule.exports =\n2\t/******/ (function(modules, runtime) { '
  opencode aws-actions__configure-aws-credentials-42/r1 req14 head :: 'ss-semantic dist/index.js "exportCredentials function conditional AWS access key secret ac' -> '# ss-semantic dist/index.js | "exportCredentials function conditional AWS access key secret access key input r'
  opencode aws-actions__configure-aws-credentials-42/r1 req15 head :: 'ss-read dist/index.js 34400 35000' -> '...output truncated...\n\nFull output saved to: /root/.local/share/opencode/tool-output/tool_04498a269001k9qq9Q7'
  opencode aws-actions__configure-aws-credentials-42/r1 req16 head :: 'ss-read dist/index.js 1000 3000' -> '...output truncated...\n\nFull output saved to: /root/.local/share/opencode/tool-output/tool_04498b462001iCfRL5b'
  opencode aws-actions__configure-aws-credentials-42/r1 req17 head :: 'ss-read dist/index.js 1 1000' -> '...output truncated...\n\nFull output saved to: /root/.local/share/opencode/tool-output/tool_04498c172001vT43lYL'
  opencode aws-actions__configure-aws-credentials-42/r2 req14 head :: 'ss-read dist/index.js 1 12' -> '# ss-read dist/index.js (lines 1-12 of 35000)\n```\nmodule.exports =\n/******/ (function(modules, runtime) { // w'
  opencode aws-actions__configure-aws-credentials-42/r2 req15 head :: 'ss-semantic dist/index.js "export AWS access key ID and secret access key only when creden' -> '# ss-semantic dist/index.js | "export AWS access key ID and secret access key only when credentials are provid'
  opencode aws-actions__configure-aws-credentials-42/r2 req19 head :: 'rg -n -F "AWS_ACCESS_KEY_ID" "dist/index.js"' -> "222:  // AWS_ACCESS_KEY_ID:\n224:  core.exportVariable('AWS_ACCESS_KEY_ID', accessKeyId);\n3135: *     AWS_ACCES"
  opencode aws-actions__configure-aws-credentials-42/r2 req20 head :: 'ss-read dist/index.js 210 245' -> '# ss-read dist/index.js (lines 210-245 of 35000)\n```\n210\t  // This replaces anything not conforming to the tag'
  opencode aws-actions__configure-aws-credentials-42/r2 req21 head :: 'ss-read dist/index.js 260 300' -> "# ss-read dist/index.js (lines 260-300 of 35000)\n```\n260\t  const endpoint = util.format('https://sts.%s.amazon"
  claude-code aws-actions__configure-aws-credentials-42/r0 req14 head :: 'ss-grep "ncc build index.js|runs:|dist/index.js" -k 20' -> '# ss-grep: 3 total match(es) for /ncc build index.js|runs:|dist/index.js/ across 2 files\naction.yml:43: runs:\n'
  claude-code aws-actions__configure-aws-credentials-42/r1 req7 head :: 'ss-grep "AWS_ACCESS_KEY_ID|aws-access-key-id|function exportCredentials" --in dist/index.j' -> '# ss-grep: 0 total match(es) for /AWS_ACCESS_KEY_ID|aws-access-key-id|function exportCredentials/ (scope: --in'
  claude-code aws-actions__configure-aws-credentials-42/r1 req10 tail :: 'ss-read dist/index.js 1 8' -> '# ss-read dist/index.js (lines 1-8 of 35000)\n```\nmodule.exports =\n/******/ (function(modules, runtime) { // we'
  claude-code aws-actions__configure-aws-credentials-42/r1 req11 tail :: 'ss-grep "Specifies an AWS access key associated|core.getInput(\'aws-access-key-id\'|AWS_SECR' -> 'Exit code 1\nBinaryHNSW: Loaded 71 vectors from /root/.ss-eval/runs/r1-33/.sweet-search/codebase-binary-hnsw.id'
  claude-code aws-actions__configure-aws-credentials-42/r1 req12 tail :: 'ss-grep "AWS_ACCESS_KEY_ID" --in dist/index.js -k 10' -> '# ss-grep: 0 total match(es) for /AWS_ACCESS_KEY_ID/ (scope: --in dist/index.js)\n(no matches)'
  claude-code aws-actions__configure-aws-credentials-42/r1 req13 tail :: 'ss-grep "accessKeyId" --in dist/index.js -k 10' -> '# ss-grep: 0 total match(es) for /accessKeyId/ (scope: --in dist/index.js)\n(no matches)'
  claude-code aws-actions__configure-aws-credentials-42/r1 req14 tail :: 'ss-grep "Missing required input when assuming|aws-region|configure-aws-credentials" --in d' -> '# ss-grep: 0 total match(es) for /Missing required input when assuming|aws-region|configure-aws-credentials/ ('
  claude-code aws-actions__configure-aws-credentials-42/r1 req18 tail :: 'ss-grep "Access Key ID|Secret Access Key|aws-access" --in dist/index.js -k 20' -> '# ss-grep: 0 total match(es) for /Access Key ID|Secret Access Key|aws-access/ (scope: --in dist/index.js)\n(no '
  claude-code aws-actions__configure-aws-credentials-42/r1 req20 tail :: 'ss-read dist/index.js 34500 35000' -> '<persisted-output>\nOutput too large (71.1KB). Full output saved to: /root/.claude/projects/-root--ss-eval-runs'
  claude-code aws-actions__configure-aws-credentials-42/r1 req21 tail :: 'ss-grep "getInput" --in dist/index.js -k 20' -> '# ss-grep: 0 total match(es) for /getInput/ (scope: --in dist/index.js)\n(no matches)'

## 4. Rollouts whose LAST edit is never followed by a run_tests
  codex/native: 0 (solved 0; rtEndedUnverified flag set on 0): 
  codex/sweet: 1 (solved 0; rtEndedUnverified flag set on 0): fp-codex-tab-20260826/devlooped__moq-1262/sweet/r0
  opencode/native: 1 (solved 0; rtEndedUnverified flag set on 0): fp-opencode-tab-20260826/gitbookio__markup-it-56/native/r2
  opencode/sweet: 1 (solved 0; rtEndedUnverified flag set on 0): rp-oc-tab-20260827/bfgroup__b2-113/sweet/r2
  claude-code/native: 4 (solved 4; rtEndedUnverified flag set on 0): fp-claudecode-tab-20260826/accenture__sfmc-devtools-1974/native/r1; fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/native/r2; fp-claudecode-tab-20260826/awslabs__aws-embedded-metrics-node-21/native/r1; fp-claudecode-tab-20260826/mathnet__mathnet-numerics-1072/native/r1
  claude-code/sweet: 5 (solved 1; rtEndedUnverified flag set on 0): fp-claudecode-tab-20260826/aio-libs__aiohttp-8038/sweet/r1; fp-claudecode-tab-20260826/devlooped__moq-1262/sweet/r0; fp-claudecode-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r2; fp-claudecode-tab-20260826/protofire__solhint-224/sweet/r0; fp-claudecode-tab-20260826/protofire__solhint-224/sweet/r1

run_tests calls in the tail per rollout (distribution):
  codex/native: {0: 4, 1: 56, 2: 6}
  codex/sweet: {0: 4, 1: 50, 2: 9, 3: 3}
  opencode/native: {0: 1, 1: 57, 2: 7, 3: 1}
  opencode/sweet: {0: 1, 1: 59, 2: 6}
  claude-code/native: {0: 4, 1: 54, 2: 6, 3: 2}
  claude-code/sweet: {0: 5, 1: 55, 2: 3, 3: 2}

## 5. Text-only requests in the tail beyond the final answer
  fp-claudecode-tab-20260826/awslabs__aws-embedded-metrics-node-21/native/r2 text_only in tail=3 resolved=False heads=['Implemented the source fix in `src/serializers/LogSerializer', 'The implementation is complete and matches the requirement w', 'Acknowledged. The source-only implementation remains complet']
  fp-claudecode-tab-20260826/mirumee__ariadne-codegen-218/native/r1 text_only in tail=2 resolved=True heads=['Implemented the source fix for nullable fields using `@skip`', 'The background exploration agent was stopped after the relev']
  fp-claudecode-tab-20260826/final-form__final-form-64/sweet/r2 text_only in tail=4 resolved=True heads=['Implemented the fix in `src/FinalForm.js:570`.\n\nWhen `form.s', 'The teammate’s analysis confirms the same issue and fix that', 'The teammate identified an important documentation nuance: t', 'The background analysis confirms the semantic distinction:\n\n']
