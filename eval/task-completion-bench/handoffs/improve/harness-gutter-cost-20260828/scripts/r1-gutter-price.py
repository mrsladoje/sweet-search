#!/usr/bin/env python3
"""r1 — what the gutter actually costs per rollout, in dollars.

Inputs are all [M] measured elsewhere and named here so the arithmetic is
checkable:

  numbered lines per rollout : GUTTER-MECHANISM-INVESTIGATION.md section 5.1,
     13-task sweet runs (13 tasks x 3 reps = 39 rollouts per harness):
     codex 15,360 / opencode 18,632 / claude-code 20,146 numbered lines.
  tokens per line, per form  : r1-gutter-tokens.py, o200k_base, 5 golden files.
  price                      : harness/ideal-cost.mjs MODEL_PRICES —
     $0.10/M newly-sent input, $0.01/M cached (re-sent prefix) input,
     $0.60/M output.
  turns per rollout          : FRESH-POOL-RESULTS.md section 3 tool calls per
     rollout, sweet TAB: codex 12.5, opencode 21.8, claude-code 29.9.
  $/rollout observed         : FRESH-POOL-RESULTS.md section 1.

The gutter token is billed ONCE at the new-input price and then re-sent as a
cached prefix on every later turn of the same rollout. `resend` below is the
mean number of later turns a read survives; the default assumes a read lands on
average halfway through the rollout.
"""
NEW = 0.10 / 1e6
CACHED = 0.01 / 1e6

PER_LINE = {          # from r1-gutter-tokens.py, aggregate over 5 golden files
    "none": 8.516, "tab": 9.997, "pipe": 10.913, "colon_space": 10.913,
    "colon": 10.703, "space": 9.913, "pipe_nosp": 10.741, "sp_pipe": 10.754,
    "pad5_tab": 11.771, "pad5_2sp": 11.774,
    "sparse5": 8.816, "sparse10": 8.663, "landmark": 8.582,
}
BASE = PER_LINE["none"]

HARNESS = {   # numbered lines/rollout, turns/rollout, observed $/rollout (TAB)
    "codex":       (15360 / 39, 12.5, 0.012330),
    "opencode":    (18632 / 39, 21.8, 0.009265),
    "claude-code": (20146 / 39, 29.9, 0.020727),
}


def cost_of(tokens, turns, resend_frac=0.5):
    """Dollars for `tokens` gutter tokens sent once new + re-sent cached."""
    resends = max(0.0, (turns - 1) * resend_frac)
    return tokens * NEW + tokens * resends * CACHED


print("=" * 96)
print("What the line-number gutter costs per rollout [M inputs, I arithmetic]")
print(f"  price: ${NEW*1e6:.2f}/M new input, ${CACHED*1e6:.2f}/M cached re-send")
print("  assumption: a read is re-sent as cached prefix on half the remaining turns")
print("=" * 96)

for h, (lines, turns, obs) in HARNESS.items():
    print(f"\n{h}: {lines:.0f} numbered lines/rollout, {turns} turns, "
          f"observed ${obs:.6f}/rollout")
    print(f"  {'form':<13} {'tok/roll':>9} {'gutter tok':>11} {'$ gutter':>11} "
          f"{'% of rollout':>13} {'Δ$ vs tab':>11} {'Δ% vs tab':>10}")
    tab_c = None
    for form in ["none", "tab", "space", "colon", "pipe_nosp", "sp_pipe",
                 "colon_space", "pipe", "pad5_tab", "pad5_2sp",
                 "sparse5", "sparse10", "landmark"]:
        tot = PER_LINE[form] * lines
        gut = (PER_LINE[form] - BASE) * lines
        c = cost_of(gut, turns)
        if form == "tab":
            tab_c = c
        d = c - (tab_c if tab_c is not None else 0)
        print(f"  {form:<13} {tot:>9.0f} {gut:>11.0f} {c:>11.6f} "
              f"{100*c/obs:>12.2f}% {d:>+11.6f} {100*d/obs:>+9.2f}%")

print("\n" + "=" * 96)
print("Sensitivity: the same table for codex under resend_frac 0 (read on the")
print("last turn only) and 1.0 (read on turn 1, re-sent every turn after).")
print("=" * 96)
lines, turns, obs = HARNESS["codex"]
for rf in (0.0, 0.5, 1.0):
    gt = (PER_LINE["tab"] - BASE) * lines
    gp = (PER_LINE["pipe"] - BASE) * lines
    ct, cp = cost_of(gt, turns, rf), cost_of(gp, turns, rf)
    print(f"  resend_frac={rf:<4} tab ${ct:.6f} ({100*ct/obs:.2f}% of rollout)   "
          f"pipe ${cp:.6f} ({100*cp/obs:.2f}%)   pipe-tab {100*(cp-ct)/obs:+.2f}%")
print("\n  measured codex PIPE vs TAB in FRESH-POOL-RESULTS.md section 1: "
      "$0.012754 vs $0.012330 = +3.44%")
print("  token arithmetic explains at most the figure above; the remainder is")
print("  behavioural (turn count), not the gutter's own bytes.")
