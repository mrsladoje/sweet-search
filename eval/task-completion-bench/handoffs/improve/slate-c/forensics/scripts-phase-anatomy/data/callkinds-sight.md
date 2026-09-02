
# codex -- tool CALLS per rollout by phase and kind (native / sweet), boundary=sight, rollouts 36/36
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | all |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.03/0.08 | · | · | 0.39/0.14 | 0.31/0.50 | · | 0.03/0.06 | 1.00/1.06 | · | 1.75/1.83 |
| understand | · | 0.97/0.92 | 0.03/0.00 | · | 3.22/1.50 | 0.08/1.39 | · | 0.28/0.31 | 1.19/1.14 | · | 5.78/5.25 |
| edit | 1.19/1.22 | · | · | · | · | · | · | · | · | · | 1.19/1.22 |
| verify | · | 1.25/1.33 | · | · | 0.94/0.50 | 0.06/0.50 | 0.39/0.72 | 0.36/0.42 | 1.86/1.92 | 0.00/0.03 | 4.86/5.42 |
| narrate | · | · | · | · | · | · | · | · | · | · | · |
| finalize | · | · | · | · | · | · | · | · | · | · | · |
| TOTAL | 1.19/1.22 | 2.25/2.33 | 0.03/0.00 | 0.00/0.00 | 4.56/2.14 | 0.44/2.39 | 0.39/0.72 | 0.67/0.78 | 4.06/4.11 | 0.00/0.03 | 13.58/13.72 |

error-bearing CALLS per rollout by kind (native / sweet):
  edit: 0.00 / 0.03
  read: 0.03 / 0.06
  search: 0.00 / 0.11
tool-result BYTES per rollout by kind (native / sweet):
  edit: 247 / 423
  test: 7,203 / 7,213
  exec: 284 / 0
  read: 32,673 / 11,377
  search: 2,329 / 8,552
  git: 614 / 732
  poll: 3,818 / 4,034
  plan: 49 / 49
  other: 0 / 3

# opencode -- tool CALLS per rollout by phase and kind (native / sweet), boundary=sight, rollouts 36/36
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | all |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.11/0.14 | · | · | 0.64/0.00 | 2.94/0.31 | 0.17/0.00 | · | 1.06/1.00 | · | 4.92/1.44 |
| understand | · | 0.89/0.86 | · | · | 4.00/2.31 | 0.89/2.25 | 0.06/0.06 | · | 1.06/0.83 | · | 6.89/6.31 |
| edit | 1.11/1.19 | · | · | · | · | · | · | · | · | · | 1.11/1.19 |
| verify | · | 1.17/1.22 | 0.00/0.03 | · | 0.36/0.53 | 0.44/0.33 | 1.39/1.56 | · | 2.00/2.00 | 0.00/0.03 | 5.36/5.69 |
| narrate | · | · | · | · | · | · | · | · | · | · | · |
| finalize | · | · | · | · | · | · | · | · | · | · | · |
| TOTAL | 1.11/1.19 | 2.17/2.22 | 0.00/0.03 | 0.00/0.00 | 5.00/2.83 | 4.28/2.89 | 1.61/1.61 | 0.00/0.00 | 4.11/3.83 | 0.00/0.03 | 18.28/14.64 |

error-bearing CALLS per rollout by kind (native / sweet):
  edit: 0.03 / 0.00
  read: 0.11 / 0.00
tool-result BYTES per rollout by kind (native / sweet):
  edit: 93 / 88
  test: 10,077 / 10,594
  exec: 0 / 3
  read: 26,191 / 18,265
  search: 11,435 / 8,863
  git: 1,033 / 1,234
  plan: 2,041 / 1,851
  other: 0 / 0

# claude-code -- tool CALLS per rollout by phase and kind (native / sweet), boundary=sight, rollouts 33/33
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | all |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.73/0.55 | · | 0.18/0.06 | 0.70/0.09 | 0.45/0.30 | · | · | 0.88/0.85 | · | 2.94/1.85 |
| understand | · | 0.27/0.45 | · | 0.03/0.00 | 5.73/2.42 | 0.45/2.33 | · | · | 0.03/0.03 | · | 6.52/5.24 |
| edit | 2.64/2.30 | · | · | · | · | · | · | · | · | · | 2.64/2.30 |
| verify | · | 1.36/1.39 | 0.03/0.00 | · | 0.88/0.61 | 0.15/1.61 | 0.91/0.64 | 0.06/0.00 | 0.88/1.00 | 0.00/0.03 | 4.27/5.27 |
| narrate | · | · | · | · | · | · | · | · | · | · | · |
| finalize | · | · | · | · | · | · | · | · | · | · | · |
| TOTAL | 2.64/2.30 | 2.36/2.39 | 0.03/0.00 | 0.21/0.06 | 7.30/3.12 | 1.06/4.24 | 0.91/0.64 | 0.06/0.00 | 1.79/1.88 | 0.00/0.03 | 16.36/14.67 |

error-bearing CALLS per rollout by kind (native / sweet):
  edit: 0.36 / 0.58
  test: 0.06 / 0.03
  exec: 0.03 / 0.00
  read: 2.09 / 0.42
  search: 0.06 / 0.33
  git: 0.03 / 0.00
tool-result BYTES per rollout by kind (native / sweet):
  edit: 482 / 464
  test: 10,325 / 10,434
  exec: 20 / 0
  delegate: 493 / 64
  read: 26,874 / 12,238
  search: 3,580 / 14,542
  git: 1,049 / 616
  poll: 981 / 0
  plan: 71 / 80
  other: 0 / 0
