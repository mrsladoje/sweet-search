## (a) failed-READ requests (every call in the request is an error-bearing read-class call), per rollout
  solved-everywhere  codex        native: 0.03 failed-read requests/rollout, cost 0.000015 = 0.2% of 0.007591; resent 390 out 4
  solved-everywhere  codex        sweet : 0.06 failed-read requests/rollout, cost 0.000028 = 0.4% of 0.007335; resent 1,425 out 8
  solved-everywhere  opencode     native: 0.00 failed-read requests/rollout, cost 0.000000 = 0.0% of 0.005706; resent 0 out 0
  solved-everywhere  opencode     sweet : 0.00 failed-read requests/rollout, cost 0.000000 = 0.0% of 0.005497; resent 0 out 0
  solved-everywhere  claude-code  native: 1.39 failed-read requests/rollout, cost 0.000513 = 5.9% of 0.008626; resent 27,191 out 109
  solved-everywhere  claude-code  sweet : 0.42 failed-read requests/rollout, cost 0.000157 = 1.8% of 0.008808; resent 9,764 out 38
  all 22 tasks       codex        native: 0.05 failed-read requests/rollout, cost 0.000025 = 0.2% of 0.011192; resent 974 out 6
  all 22 tasks       codex        sweet : 0.26 failed-read requests/rollout, cost 0.000150 = 1.3% of 0.011228; resent 8,325 out 48
  all 22 tasks       opencode     native: 0.02 failed-read requests/rollout, cost 0.000015 = 0.2% of 0.008964; resent 331 out 10
  all 22 tasks       opencode     sweet : 0.02 failed-read requests/rollout, cost 0.000007 = 0.1% of 0.009260; resent 610 out 1
  all 22 tasks       claude-code  native: 1.52 failed-read requests/rollout, cost 0.000568 = 3.7% of 0.015329; resent 31,054 out 154
  all 22 tasks       claude-code  sweet : 0.52 failed-read requests/rollout, cost 0.000246 = 1.7% of 0.014739; resent 16,995 out 67

## (b) claude-code sidechain (subagent) requests attributed to the parent's phase, per rollout (solved-everywhere)
  native: subagent files 7 in 7/33 rollouts; requests by phase localize 2.67, understand 0.00, edit 0.00, verify 0.00, narrate 0.00, finalize 0.00; cost by phase localize 0.002070, understand 0.000000, edit 0.000000, verify 0.000000, narrate 0.000000, finalize 0.000000
  sweet: subagent files 2 in 2/33 rollouts; requests by phase localize 0.88, understand 0.00, edit 0.00, verify 0.00, narrate 0.00, finalize 0.00; cost by phase localize 0.000964, understand 0.000000, edit 0.000000, verify 0.000000, narrate 0.000000, finalize 0.000000

## (c) subset comparison (all-task JSON): per-task paired means (sweet - native) per rollout, solved-everywhere vs other tasks
  codex        solved-everywhere  tasks=12: requests N 14.58 S 14.72 (Δ +0.14); cost N 0.007591 S 0.007335 (Δ -0.000256 = -3.4%)
  codex        other tasks        tasks=10: requests N 23.97 S 25.47 (Δ +1.50); cost N 0.015513 S 0.015900 (Δ +0.000387 = +2.5%)
  codex        all 22 tasks      : cost N 0.011192 S 0.011228 (+0.3%)  [main thread, ideal price; brief: codex +0.3%, opencode +3.3%, claude -3.9% incl. sidechain]
  opencode     solved-everywhere  tasks=12: requests N 12.58 S 13.78 (Δ +1.19); cost N 0.005706 S 0.005497 (Δ -0.000209 = -3.7%)
  opencode     other tasks        tasks=10: requests N 20.80 S 26.80 (Δ +6.00); cost N 0.012875 S 0.013776 (Δ +0.000901 = +7.0%)
  opencode     all 22 tasks      : cost N 0.008964 S 0.009260 (+3.3%)  [main thread, ideal price; brief: codex +0.3%, opencode +3.3%, claude -3.9% incl. sidechain]
  claude-code  solved-everywhere  tasks=11: requests N 15.70 S 15.67 (Δ -0.03); cost N 0.008626 S 0.008808 (Δ +0.000183 = +2.1%)
  claude-code  other tasks        tasks=11: requests N 32.91 S 30.67 (Δ -2.24); cost N 0.022033 S 0.020669 (Δ -0.001364 = -6.2%)
  claude-code  all 22 tasks      : cost N 0.015329 S 0.014739 (-3.9%)  [main thread, ideal price; brief: codex +0.3%, opencode +3.3%, claude -3.9% incl. sidechain]

## (d) edit before any READ-tool read of the edited file (the agent edited from search output), share of rollouts
  solved-everywhere  codex        native: 2/36 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.36
  solved-everywhere  codex        sweet : 3/36 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.86
  solved-everywhere  opencode     native: 0/36 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 0.00
  solved-everywhere  opencode     sweet : 1/36 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.92
  solved-everywhere  claude-code  native: 0/33 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 0.64
  solved-everywhere  claude-code  sweet : 2/33 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.97
  all 22 tasks       codex        native: 3/66 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.83
  all 22 tasks       codex        sweet : 7/66 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 2.00
  all 22 tasks       opencode     native: 0/66 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 0.02
  all 22 tasks       opencode     sweet : 4/66 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.95
  all 22 tasks       claude-code  native: 1/66 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 0.85
  all 22 tasks       claude-code  sweet : 4/65 rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read 1.89

## (e) error-bearing requests per rollout by class (solved-everywhere)
  codex        native: read 0.03
  codex        sweet : search 0.11, read 0.06, edit 0.03
  opencode     native: read 0.11, edit 0.03
  opencode     sweet : 
  claude-code  native: read 1.48, edit 0.36, test 0.09, git 0.03, exec 0.03, search 0.03
  claude-code  sweet : edit 0.58, read 0.42, search 0.33, test 0.03
