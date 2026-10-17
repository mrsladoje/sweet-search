# Parallel callers (held-out agent-ho / gcsn-ho, previously examined)

Closed-loop saturation: N callers replay their share back to back; throughput in calls/s; per-request p50 / p99 ms. Open-loop: Poisson arrivals at the frozen common rates (25/50/75 % of the slowest shortlisted arm's dev saturation), latency includes queueing. Executor: threads = one process, N threads; procs = one process per caller.

## Intel — agent-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 11809 | 0.075 | 0.336 |
| `ours` | closed | threads | 4 |  | 10424 | 0.165 | 3.054 |
| `ours` | closed | threads | 16 |  | 8909 | 1.183 | 8.323 |
| `ours` | closed | procs | 1 |  | 11954 | 0.074 | 0.336 |
| `ours` | closed | procs | 4 |  | 13807 | 0.231 | 1.205 |
| `ours` | closed | procs | 16 |  | 11021 | 0.887 | 4.752 |
| `ours` | open | threads | 16 | 573 | 573 | 5.819 | 26.247 |
| `ours` | open | threads | 16 | 1146 | 1146 | 6.120 | 30.248 |
| `ours` | open | threads | 16 | 1719 | 1718 | 6.831 | 32.804 |
| `ours` | open | procs | 16 | 573 | 573 | 0.678 | 4.255 |
| `ours` | open | procs | 16 | 1146 | 1146 | 0.713 | 4.780 |
| `ours` | open | procs | 16 | 1719 | 1719 | 0.724 | 5.486 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 5084 | 0.179 | 0.585 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 7737 | 0.432 | 1.984 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 8303 | 1.222 | 10.202 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 4507 | 0.185 | 0.936 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 7019 | 0.443 | 2.237 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 7034 | 1.496 | 7.605 |
| `maxsim_cpu_variable` | open | threads | 16 | 573 | 573 | 9.945 | 20.930 |
| `maxsim_cpu_variable` | open | threads | 16 | 1146 | 1146 | 10.404 | 24.475 |
| `maxsim_cpu_variable` | open | threads | 16 | 1719 | 1716 | 14.085 | 37.153 |
| `maxsim_cpu_variable` | open | procs | 16 | 573 | 573 | 1.436 | 8.248 |
| `maxsim_cpu_variable` | open | procs | 16 | 1146 | 1146 | 1.369 | 10.114 |
| `maxsim_cpu_variable` | open | procs | 16 | 1719 | 1719 | 1.362 | 12.150 |
| `nextplaid` | closed | threads | 1 |  | 1793 | 0.525 | 2.461 |
| `nextplaid` | closed | threads | 4 |  | 2046 | 1.717 | 6.540 |
| `nextplaid` | closed | threads | 16 |  | 2078 | 4.144 | 52.378 |
| `nextplaid` | closed | procs | 1 |  | 1554 | 0.603 | 2.853 |
| `nextplaid` | closed | procs | 4 |  | 2059 | 1.037 | 12.006 |
| `nextplaid` | closed | procs | 16 |  | 1693 | 3.125 | 57.820 |
| `nextplaid` | open | threads | 16 | 573 | 573 | 9.740 | 22.030 |
| `nextplaid` | open | threads | 16 | 1146 | 1135 | 14.797 | 84.416 |
| `nextplaid` | open | threads | 16 | 1719 | 1388 | 450.838 | 650.085 |
| `nextplaid` | open | procs | 16 | 573 | 511 | 617.848 | 4856.147 |
| `nextplaid` | open | procs | 16 | 1146 | 882 | 990.904 | 2501.187 |
| `nextplaid` | open | procs | 16 | 1719 | 1247 | 217.514 | 1752.956 |
| `nextplaid@1` | closed | threads | 1 |  | 1647 | 0.566 | 2.876 |
| `nextplaid@1` | closed | threads | 4 |  | 1689 | 2.140 | 12.015 |
| `nextplaid@1` | closed | threads | 16 |  | 1627 | 8.572 | 48.698 |
| `nextplaid@1` | closed | procs | 1 |  | 1622 | 0.573 | 2.880 |
| `nextplaid@1` | closed | procs | 4 |  | 2157 | 1.163 | 9.554 |
| `nextplaid@1` | closed | procs | 16 |  | 1463 | 3.844 | 65.008 |
| `nextplaid@1` | open | threads | 16 | 573 | 484 | 2233.913 | 3650.472 |
| `nextplaid@1` | open | threads | 16 | 1146 | 765 | 1930.241 | 2445.101 |
| `nextplaid@1` | open | threads | 16 | 1719 | 965 | 1730.116 | 1803.109 |
| `nextplaid@1` | open | procs | 16 | 573 | 523 | 176.679 | 3532.975 |
| `nextplaid@1` | open | procs | 16 | 1146 | 907 | 724.692 | 2534.563 |
| `nextplaid@1` | open | procs | 16 | 1719 | 1221 | 412.022 | 2023.578 |
| `numkong_native_f16` | closed | threads | 1 |  | 21736 | 0.041 | 0.121 |
| `numkong_native_f16` | closed | threads | 4 |  | 33418 | 0.102 | 0.348 |
| `numkong_native_f16` | closed | threads | 16 |  | 31948 | 0.428 | 1.765 |
| `numkong_native_f16` | closed | procs | 1 |  | 20479 | 0.043 | 0.128 |
| `numkong_native_f16` | closed | procs | 4 |  | 29851 | 0.109 | 0.440 |
| `numkong_native_f16` | closed | procs | 16 |  | 43563 | 0.259 | 1.285 |
| `numkong_native_f16` | open | threads | 16 | 573 | 573 | 8.420 | 22.848 |
| `numkong_native_f16` | open | threads | 16 | 1146 | 1146 | 8.292 | 23.056 |
| `numkong_native_f16` | open | threads | 16 | 1719 | 1718 | 8.301 | 21.736 |
| `numkong_native_f16` | open | procs | 16 | 573 | 573 | 0.205 | 1.106 |
| `numkong_native_f16` | open | procs | 16 | 1146 | 1146 | 0.204 | 1.107 |
| `numkong_native_f16` | open | procs | 16 | 1719 | 1719 | 0.203 | 1.144 |
| `numkong_native_f16@1` | closed | threads | 1 |  | 6924 | 0.127 | 0.629 |
| `numkong_native_f16@1` | closed | threads | 4 |  | 22890 | 0.142 | 0.678 |
| `numkong_native_f16@1` | closed | threads | 16 |  | 36375 | 0.348 | 1.337 |
| `numkong_native_f16@1` | closed | procs | 1 |  | 6688 | 0.133 | 0.655 |
| `numkong_native_f16@1` | closed | procs | 4 |  | 22841 | 0.138 | 0.683 |
| `numkong_native_f16@1` | closed | procs | 16 |  | 44650 | 0.261 | 1.285 |
| `numkong_native_f16@1` | open | threads | 16 | 573 | 573 | 5.475 | 25.278 |
| `numkong_native_f16@1` | open | threads | 16 | 1146 | 1146 | 5.640 | 25.151 |
| `numkong_native_f16@1` | open | threads | 16 | 1719 | 1717 | 6.025 | 27.363 |
| `numkong_native_f16@1` | open | procs | 16 | 573 | 573 | 0.204 | 1.083 |
| `numkong_native_f16@1` | open | procs | 16 | 1146 | 1146 | 0.202 | 1.091 |
| `numkong_native_f16@1` | open | procs | 16 | 1719 | 1719 | 0.202 | 1.098 |
| `numpy_packed@8` | closed | threads | 1 |  | 5323 | 0.171 | 0.814 |
| `numpy_packed@8` | closed | threads | 4 |  | 5303 | 0.660 | 2.630 |
| `numpy_packed@8` | closed | threads | 16 |  | 4988 | 2.824 | 14.830 |
| `numpy_packed@8` | closed | procs | 1 |  | 3924 | 0.239 | 1.099 |
| `numpy_packed@8` | closed | procs | 4 |  | 711 | 5.978 | 12.053 |
| `numpy_packed@8` | closed | procs | 16 |  | 476 | 26.971 | 72.947 |
| `numpy_packed@8` | open | threads | 16 | 573 | 573 | 8.754 | 20.599 |
| `numpy_packed@8` | open | threads | 16 | 1146 | 1146 | 9.396 | 20.993 |
| `numpy_packed@8` | open | threads | 16 | 1719 | 1717 | 10.504 | 23.978 |
| `numpy_packed@8` | open | procs | 16 | 573 | 500 | 451.014 | 1302.099 |
| `numpy_packed@8` | open | procs | 16 | 1146 | 514 | 2002.810 | 4242.746 |
| `numpy_packed@8` | open | procs | 16 | 1719 | 529 | 2421.172 | 5131.073 |
| `torch_pad_bmm@8` | closed | threads | 1 |  | 4900 | 0.191 | 0.841 |
| `torch_pad_bmm@8` | closed | threads | 4 |  | 5559 | 0.625 | 2.615 |
| `torch_pad_bmm@8` | closed | threads | 16 |  | 3639 | 2.850 | 56.515 |
| `torch_pad_bmm@8` | closed | procs | 1 |  | 4730 | 0.193 | 0.820 |
| `torch_pad_bmm@8` | closed | procs | 4 |  | 345 | 11.998 | 18.011 |
| `torch_pad_bmm@8` | closed | procs | 16 |  | 210 | 72.008 | 104.994 |
| `torch_pad_bmm@8` | open | threads | 16 | 573 | 556 | 1074.219 | 1706.355 |
| `torch_pad_bmm@8` | open | threads | 16 | 1146 | 998 | 1279.435 | 2220.604 |
| `torch_pad_bmm@8` | open | threads | 16 | 1719 | 1367 | 1107.879 | 1734.352 |
| `torch_pad_bmm@8` | open | procs | 16 | 573 | 214 | 5775.415 | 11586.794 |
| `torch_pad_bmm@8` | open | procs | 16 | 1146 | 213 | 7610.692 | 15033.334 |
| `torch_pad_bmm@8` | open | procs | 16 | 1719 | 214 | 8244.199 | 16185.399 |

## Intel — gcsn-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 24845 | 0.038 | 0.083 |
| `ours` | closed | threads | 4 |  | 23223 | 0.073 | 1.216 |
| `ours` | closed | threads | 16 |  | 17163 | 0.594 | 4.628 |
| `ours` | closed | procs | 1 |  | 24852 | 0.037 | 0.083 |
| `ours` | closed | procs | 4 |  | 30994 | 0.088 | 0.272 |
| `ours` | closed | procs | 16 |  | 24694 | 0.329 | 1.237 |
| `ours` | open | threads | 16 | 1049 | 1061 | 5.274 | 26.921 |
| `ours` | open | threads | 16 | 2097 | 2121 | 6.977 | 31.543 |
| `ours` | open | threads | 16 | 3146 | 3178 | 18.334 | 53.912 |
| `ours` | open | procs | 16 | 1049 | 1061 | 0.283 | 0.785 |
| `ours` | open | procs | 16 | 2097 | 2122 | 0.290 | 0.887 |
| `ours` | open | procs | 16 | 3146 | 3183 | 0.297 | 0.934 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 7969 | 0.122 | 0.227 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 14823 | 0.236 | 0.736 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 17630 | 0.593 | 4.445 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 6581 | 0.131 | 0.728 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 13237 | 0.244 | 0.942 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 16460 | 0.731 | 2.565 |
| `maxsim_cpu_variable` | open | threads | 16 | 1049 | 1061 | 9.659 | 22.361 |
| `maxsim_cpu_variable` | open | threads | 16 | 2097 | 2113 | 24.980 | 83.593 |
| `maxsim_cpu_variable` | open | threads | 16 | 3146 | 2999 | 275.103 | 495.271 |
| `maxsim_cpu_variable` | open | procs | 16 | 1049 | 1061 | 0.568 | 4.036 |
| `maxsim_cpu_variable` | open | procs | 16 | 2097 | 2122 | 0.576 | 3.781 |
| `maxsim_cpu_variable` | open | procs | 16 | 3146 | 3183 | 0.585 | 5.081 |
| `nextplaid` | closed | threads | 1 |  | 4150 | 0.227 | 0.563 |
| `nextplaid` | closed | threads | 4 |  | 5268 | 0.713 | 1.858 |
| `nextplaid` | closed | threads | 16 |  | 5415 | 1.803 | 20.238 |
| `nextplaid` | closed | procs | 1 |  | 3708 | 0.257 | 0.583 |
| `nextplaid` | closed | procs | 4 |  | 4345 | 0.586 | 1.965 |
| `nextplaid` | closed | procs | 16 |  | 3131 | 2.001 | 30.535 |
| `nextplaid` | open | threads | 16 | 1049 | 1061 | 9.305 | 17.698 |
| `nextplaid` | open | threads | 16 | 2097 | 1922 | 337.776 | 595.703 |
| `nextplaid` | open | threads | 16 | 3146 | 2453 | 543.482 | 766.836 |
| `nextplaid` | open | procs | 16 | 1049 | 980 | 84.442 | 1564.624 |
| `nextplaid` | open | procs | 16 | 2097 | 1693 | 201.220 | 1320.001 |
| `nextplaid` | open | procs | 16 | 3146 | 2323 | 162.772 | 827.690 |
| `nextplaid@1` | closed | threads | 1 |  | 2867 | 0.341 | 0.606 |
| `nextplaid@1` | closed | threads | 4 |  | 2968 | 1.238 | 3.318 |
| `nextplaid@1` | closed | threads | 16 |  | 2888 | 5.019 | 13.645 |
| `nextplaid@1` | closed | procs | 1 |  | 2749 | 0.356 | 0.634 |
| `nextplaid@1` | closed | procs | 4 |  | 3190 | 0.635 | 6.737 |
| `nextplaid@1` | closed | procs | 16 |  | 3819 | 1.747 | 25.947 |
| `nextplaid@1` | open | threads | 16 | 1049 | 910 | 1072.048 | 1962.206 |
| `nextplaid@1` | open | threads | 16 | 2097 | 1347 | 1438.918 | 1704.128 |
| `nextplaid@1` | open | threads | 16 | 3146 | 1649 | 1271.589 | 1388.976 |
| `nextplaid@1` | open | procs | 16 | 1049 | 985 | 85.658 | 1792.061 |
| `nextplaid@1` | open | procs | 16 | 2097 | 1730 | 152.995 | 1017.576 |
| `nextplaid@1` | open | procs | 16 | 3146 | 2351 | 191.353 | 830.737 |
| `numkong_native_f16` | closed | threads | 1 |  | 31460 | 0.031 | 0.051 |
| `numkong_native_f16` | closed | threads | 4 |  | 50232 | 0.072 | 0.166 |
| `numkong_native_f16` | closed | threads | 16 |  | 45366 | 0.332 | 1.004 |
| `numkong_native_f16` | closed | procs | 1 |  | 31320 | 0.030 | 0.051 |
| `numkong_native_f16` | closed | procs | 4 |  | 42933 | 0.086 | 0.163 |
| `numkong_native_f16` | closed | procs | 16 |  | 105660 | 0.132 | 0.260 |
| `numkong_native_f16` | open | threads | 16 | 1049 | 1061 | 8.151 | 22.973 |
| `numkong_native_f16` | open | threads | 16 | 2097 | 2120 | 8.578 | 23.309 |
| `numkong_native_f16` | open | threads | 16 | 3146 | 3175 | 20.891 | 39.639 |
| `numkong_native_f16` | open | procs | 16 | 1049 | 1061 | 0.107 | 0.200 |
| `numkong_native_f16` | open | procs | 16 | 2097 | 2122 | 0.106 | 0.200 |
| `numkong_native_f16` | open | procs | 16 | 3146 | 3184 | 0.106 | 0.205 |
| `numkong_native_f16@1` | closed | threads | 1 |  | 13834 | 0.068 | 0.131 |
| `numkong_native_f16@1` | closed | threads | 4 |  | 43942 | 0.084 | 0.165 |
| `numkong_native_f16@1` | closed | threads | 16 |  | 44658 | 0.314 | 1.280 |
| `numkong_native_f16@1` | closed | procs | 1 |  | 13530 | 0.069 | 0.132 |
| `numkong_native_f16@1` | closed | procs | 4 |  | 50159 | 0.072 | 0.139 |
| `numkong_native_f16@1` | closed | procs | 16 |  | 106308 | 0.132 | 0.254 |
| `numkong_native_f16@1` | open | threads | 16 | 1049 | 1061 | 5.378 | 25.050 |
| `numkong_native_f16@1` | open | threads | 16 | 2097 | 2120 | 6.214 | 30.041 |
| `numkong_native_f16@1` | open | threads | 16 | 3146 | 3177 | 12.296 | 43.893 |
| `numkong_native_f16@1` | open | procs | 16 | 1049 | 1061 | 0.107 | 0.197 |
| `numkong_native_f16@1` | open | procs | 16 | 2097 | 2122 | 0.107 | 0.206 |
| `numkong_native_f16@1` | open | procs | 16 | 3146 | 3184 | 0.106 | 0.205 |
| `numpy_packed@8` | closed | threads | 1 |  | 11148 | 0.087 | 0.159 |
| `numpy_packed@8` | closed | threads | 4 |  | 11139 | 0.351 | 0.569 |
| `numpy_packed@8` | closed | threads | 16 |  | 10517 | 1.490 | 3.214 |
| `numpy_packed@8` | closed | procs | 1 |  | 8204 | 0.118 | 0.251 |
| `numpy_packed@8` | closed | procs | 4 |  | 821 | 5.989 | 11.971 |
| `numpy_packed@8` | closed | procs | 16 |  | 494 | 24.009 | 66.022 |
| `numpy_packed@8` | open | threads | 16 | 1049 | 1061 | 8.386 | 19.789 |
| `numpy_packed@8` | open | threads | 16 | 2097 | 2120 | 9.515 | 21.198 |
| `numpy_packed@8` | open | threads | 16 | 3146 | 3013 | 127.548 | 260.096 |
| `numpy_packed@8` | open | procs | 16 | 1049 | 518 | 2222.954 | 4661.647 |
| `numpy_packed@8` | open | procs | 16 | 2097 | 517 | 3346.364 | 6865.227 |
| `numpy_packed@8` | open | procs | 16 | 3146 | 519 | 3776.907 | 7544.470 |
| `torch_pad_bmm@8` | closed | threads | 1 |  | 6917 | 0.139 | 0.254 |
| `torch_pad_bmm@8` | closed | threads | 4 |  | 7415 | 0.509 | 0.970 |
| `torch_pad_bmm@8` | closed | threads | 16 |  | 5396 | 2.195 | 21.106 |
| `torch_pad_bmm@8` | closed | procs | 1 |  | 7435 | 0.134 | 0.215 |
| `torch_pad_bmm@8` | closed | procs | 4 |  | 323 | 11.999 | 24.003 |
| `torch_pad_bmm@8` | closed | procs | 16 |  | 206 | 72.013 | 103.004 |
| `torch_pad_bmm@8` | open | threads | 16 | 1049 | 988 | 733.722 | 1898.658 |
| `torch_pad_bmm@8` | open | threads | 16 | 2097 | 1835 | 457.321 | 1028.753 |
| `torch_pad_bmm@8` | open | threads | 16 | 3146 | 2234 | 927.320 | 1291.770 |
| `torch_pad_bmm@8` | open | procs | 16 | 1049 | 209 | 9125.432 | 17950.599 |
| `torch_pad_bmm@8` | open | procs | 16 | 2097 | 209 | 10239.955 | 20277.361 |
| `torch_pad_bmm@8` | open | procs | 16 | 3146 | 208 | 10604.804 | 21083.405 |

## AMD — agent-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 26822 | 0.034 | 0.126 |
| `ours` | closed | threads | 4 |  | 21976 | 0.068 | 1.796 |
| `ours` | closed | threads | 16 |  | 13964 | 0.779 | 5.121 |
| `ours` | closed | procs | 1 |  | 27472 | 0.032 | 0.127 |
| `ours` | closed | procs | 4 |  | 33323 | 0.089 | 0.467 |
| `ours` | closed | procs | 16 |  | 25586 | 0.319 | 3.441 |
| `ours` | open | threads | 16 | 745 | 745 | 7.820 | 24.119 |
| `ours` | open | threads | 16 | 1491 | 1490 | 8.638 | 33.229 |
| `ours` | open | threads | 16 | 2236 | 2235 | 10.445 | 31.999 |
| `ours` | open | procs | 16 | 745 | 745 | 0.297 | 2.369 |
| `ours` | open | procs | 16 | 1491 | 1491 | 0.302 | 1.944 |
| `ours` | open | procs | 16 | 2236 | 2236 | 0.305 | 1.926 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 7646 | 0.120 | 0.398 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 11797 | 0.288 | 1.137 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 12240 | 0.727 | 8.134 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 6902 | 0.123 | 0.564 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 9749 | 0.303 | 1.693 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 10342 | 0.959 | 5.550 |
| `maxsim_cpu_variable` | open | threads | 16 | 745 | 745 | 9.063 | 18.723 |
| `maxsim_cpu_variable` | open | threads | 16 | 1491 | 1490 | 9.612 | 21.935 |
| `maxsim_cpu_variable` | open | threads | 16 | 2236 | 2201 | 81.075 | 138.595 |
| `maxsim_cpu_variable` | open | procs | 16 | 745 | 745 | 0.926 | 6.779 |
| `maxsim_cpu_variable` | open | procs | 16 | 1491 | 1490 | 1.026 | 10.868 |
| `maxsim_cpu_variable` | open | procs | 16 | 2236 | 2235 | 0.917 | 9.413 |
| `nextplaid` | closed | threads | 1 |  | 8055 | 0.116 | 0.352 |
| `nextplaid` | closed | threads | 4 |  | 13017 | 0.271 | 0.924 |
| `nextplaid` | closed | threads | 16 |  | 14123 | 0.580 | 8.092 |
| `nextplaid` | closed | procs | 1 |  | 1841 | 0.509 | 2.371 |
| `nextplaid` | closed | procs | 4 |  | 2639 | 0.980 | 7.049 |
| `nextplaid` | closed | procs | 16 |  | 2951 | 2.135 | 43.578 |
| `nextplaid` | open | threads | 16 | 745 | 745 | 8.790 | 17.421 |
| `nextplaid` | open | threads | 16 | 1491 | 1490 | 9.106 | 19.721 |
| `nextplaid` | open | threads | 16 | 2236 | 2226 | 23.894 | 57.772 |
| `nextplaid` | open | procs | 16 | 745 | 684 | 294.454 | 2717.512 |
| `nextplaid` | open | procs | 16 | 1491 | 1206 | 551.337 | 1756.121 |
| `nextplaid` | open | procs | 16 | 2236 | 1762 | 173.618 | 635.166 |
| `nextplaid@1` | closed | threads | 1 |  | 2169 | 0.424 | 2.127 |
| `nextplaid@1` | closed | threads | 4 |  | 2195 | 1.668 | 9.733 |
| `nextplaid@1` | closed | threads | 16 |  | 2242 | 6.395 | 37.015 |
| `nextplaid@1` | closed | procs | 1 |  | 2262 | 0.405 | 2.151 |
| `nextplaid@1` | closed | procs | 4 |  | 2691 | 0.788 | 9.206 |
| `nextplaid@1` | closed | procs | 16 |  | 2721 | 2.551 | 47.165 |
| `nextplaid@1` | open | threads | 16 | 745 | 649 | 1349.165 | 2304.594 |
| `nextplaid@1` | open | threads | 16 | 1491 | 993 | 1598.498 | 2032.811 |
| `nextplaid@1` | open | threads | 16 | 2236 | 1228 | 1462.511 | 1511.289 |
| `nextplaid@1` | open | procs | 16 | 745 | 684 | 315.783 | 2976.231 |
| `nextplaid@1` | open | procs | 16 | 1491 | 1201 | 555.365 | 2068.163 |
| `nextplaid@1` | open | procs | 16 | 2236 | 1668 | 196.424 | 1203.393 |
| `numkong_native_f16` | closed | threads | 1 |  | 21632 | 0.041 | 0.124 |
| `numkong_native_f16` | closed | threads | 4 |  | 35085 | 0.097 | 0.351 |
| `numkong_native_f16` | closed | threads | 16 |  | 39831 | 0.232 | 2.565 |
| `numkong_native_f16` | closed | procs | 1 |  | 20853 | 0.041 | 0.124 |
| `numkong_native_f16` | closed | procs | 4 |  | 30448 | 0.091 | 0.427 |
| `numkong_native_f16` | closed | procs | 16 |  | 24201 | 0.230 | 3.334 |
| `numkong_native_f16` | open | threads | 16 | 745 | 745 | 8.569 | 19.541 |
| `numkong_native_f16` | open | threads | 16 | 1491 | 1490 | 8.766 | 19.933 |
| `numkong_native_f16` | open | threads | 16 | 2236 | 2233 | 13.510 | 57.927 |
| `numkong_native_f16` | open | procs | 16 | 745 | 745 | 0.192 | 1.010 |
| `numkong_native_f16` | open | procs | 16 | 1491 | 1491 | 0.198 | 1.150 |
| `numkong_native_f16` | open | procs | 16 | 2236 | 2236 | 0.197 | 1.142 |
| `numpy_packed` | closed | threads | 1 |  | 2698 | 0.327 | 1.605 |
| `numpy_packed` | closed | threads | 4 |  | 8434 | 0.355 | 2.080 |
| `numpy_packed` | closed | threads | 16 |  | 15512 | 0.772 | 4.167 |
| `numpy_packed` | closed | procs | 1 |  | 4529 | 0.216 | 0.676 |
| `numpy_packed` | closed | procs | 4 |  | 12030 | 0.276 | 1.974 |
| `numpy_packed` | closed | procs | 16 |  | 9812 | 0.616 | 9.007 |
| `numpy_packed` | open | threads | 16 | 745 | 745 | 8.509 | 20.089 |
| `numpy_packed` | open | threads | 16 | 1491 | 1490 | 8.636 | 22.105 |
| `numpy_packed` | open | threads | 16 | 2236 | 2234 | 11.102 | 26.825 |
| `numpy_packed` | open | procs | 16 | 745 | 745 | 0.385 | 2.213 |
| `numpy_packed` | open | procs | 16 | 1491 | 1491 | 0.397 | 2.260 |
| `numpy_packed` | open | procs | 16 | 2236 | 2236 | 0.409 | 2.600 |
| `numpy_packed_t` | closed | threads | 1 |  | 1716 | 0.517 | 2.669 |
| `numpy_packed_t` | closed | threads | 4 |  | 5647 | 0.537 | 3.025 |
| `numpy_packed_t` | closed | threads | 16 |  | 10967 | 0.939 | 9.296 |
| `numpy_packed_t` | closed | procs | 1 |  | 5195 | 0.169 | 0.817 |
| `numpy_packed_t` | closed | procs | 4 |  | 11155 | 0.250 | 2.823 |
| `numpy_packed_t` | closed | procs | 16 |  | 12546 | 0.715 | 5.095 |
| `numpy_packed_t` | open | threads | 16 | 745 | 745 | 8.966 | 21.112 |
| `numpy_packed_t` | open | threads | 16 | 1491 | 1490 | 9.563 | 25.471 |
| `numpy_packed_t` | open | threads | 16 | 2236 | 2230 | 19.195 | 38.692 |
| `numpy_packed_t` | open | procs | 16 | 745 | 745 | 0.558 | 3.697 |
| `numpy_packed_t` | open | procs | 16 | 1491 | 1491 | 0.588 | 3.919 |
| `numpy_packed_t` | open | procs | 16 | 2236 | 2236 | 0.591 | 4.575 |
| `torch_pad_bmm` | closed | threads | 1 |  | 5491 | 0.177 | 0.505 |
| `torch_pad_bmm` | closed | threads | 4 |  | 6502 | 0.519 | 3.384 |
| `torch_pad_bmm` | closed | threads | 16 |  | 5741 | 2.134 | 10.684 |
| `torch_pad_bmm` | closed | procs | 1 |  | 6841 | 0.131 | 0.499 |
| `torch_pad_bmm` | closed | procs | 4 |  | 10431 | 0.318 | 1.462 |
| `torch_pad_bmm` | closed | procs | 16 |  | 9616 | 0.948 | 6.606 |
| `torch_pad_bmm` | open | threads | 16 | 745 | 705 | 1444.434 | 2590.258 |
| `torch_pad_bmm` | open | threads | 16 | 1491 | 1276 | 1134.264 | 1942.281 |
| `torch_pad_bmm` | open | threads | 16 | 2236 | 1744 | 924.092 | 1436.570 |
| `torch_pad_bmm` | open | procs | 16 | 745 | 745 | 0.799 | 5.041 |
| `torch_pad_bmm` | open | procs | 16 | 1491 | 1490 | 0.806 | 5.980 |
| `torch_pad_bmm` | open | procs | 16 | 2236 | 2235 | 0.824 | 8.254 |

## AMD — gcsn-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 45566 | 0.021 | 0.040 |
| `ours` | closed | threads | 4 |  | 49307 | 0.045 | 0.351 |
| `ours` | closed | threads | 16 |  | 20576 | 0.373 | 4.666 |
| `ours` | closed | procs | 1 |  | 45927 | 0.020 | 0.042 |
| `ours` | closed | procs | 4 |  | 78817 | 0.045 | 0.117 |
| `ours` | closed | procs | 16 |  | 59423 | 0.138 | 0.456 |
| `ours` | open | threads | 16 | 1472 | 1489 | 7.651 | 27.298 |
| `ours` | open | threads | 16 | 2943 | 2973 | 14.680 | 54.524 |
| `ours` | open | threads | 16 | 4415 | 4357 | 131.118 | 243.384 |
| `ours` | open | procs | 16 | 1472 | 1489 | 0.136 | 0.364 |
| `ours` | open | procs | 16 | 2943 | 2979 | 0.136 | 1.404 |
| `ours` | open | procs | 16 | 4415 | 4468 | 0.132 | 0.364 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 11267 | 0.087 | 0.152 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 21492 | 0.171 | 0.452 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 23762 | 0.383 | 4.250 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 9790 | 0.089 | 0.423 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 16371 | 0.188 | 0.688 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 21748 | 0.483 | 1.898 |
| `maxsim_cpu_variable` | open | threads | 16 | 1472 | 1489 | 9.160 | 19.497 |
| `maxsim_cpu_variable` | open | threads | 16 | 2943 | 2883 | 216.953 | 418.579 |
| `maxsim_cpu_variable` | open | threads | 16 | 4415 | 4093 | 301.196 | 539.762 |
| `maxsim_cpu_variable` | open | procs | 16 | 1472 | 1488 | 0.427 | 4.705 |
| `maxsim_cpu_variable` | open | procs | 16 | 2943 | 2978 | 0.426 | 3.218 |
| `maxsim_cpu_variable` | open | procs | 16 | 4415 | 4467 | 0.445 | 5.959 |
| `nextplaid` | closed | threads | 1 |  | 10836 | 0.091 | 0.141 |
| `nextplaid` | closed | threads | 4 |  | 22526 | 0.167 | 0.379 |
| `nextplaid` | closed | threads | 16 |  | 26401 | 0.305 | 4.413 |
| `nextplaid` | closed | procs | 1 |  | 5177 | 0.181 | 0.452 |
| `nextplaid` | closed | procs | 4 |  | 5821 | 0.401 | 1.554 |
| `nextplaid` | closed | procs | 16 |  | 4446 | 1.100 | 22.697 |
| `nextplaid` | open | threads | 16 | 1472 | 1489 | 9.293 | 19.669 |
| `nextplaid` | open | threads | 16 | 2943 | 2898 | 201.085 | 377.558 |
| `nextplaid` | open | threads | 16 | 4415 | 4136 | 274.428 | 510.112 |
| `nextplaid` | open | procs | 16 | 1472 | 1368 | 135.534 | 980.333 |
| `nextplaid` | open | procs | 16 | 2943 | 2359 | 290.613 | 1089.843 |
| `nextplaid` | open | procs | 16 | 4415 | 3369 | 103.094 | 561.638 |
| `nextplaid@1` | closed | threads | 1 |  | 4125 | 0.233 | 0.486 |
| `nextplaid@1` | closed | threads | 4 |  | 4146 | 0.904 | 2.333 |
| `nextplaid@1` | closed | threads | 16 |  | 4444 | 3.252 | 9.186 |
| `nextplaid@1` | closed | procs | 1 |  | 4113 | 0.233 | 0.483 |
| `nextplaid@1` | closed | procs | 4 |  | 5615 | 0.359 | 1.936 |
| `nextplaid@1` | closed | procs | 16 |  | 4551 | 1.210 | 21.658 |
| `nextplaid@1` | open | threads | 16 | 1472 | 1277 | 940.149 | 1439.303 |
| `nextplaid@1` | open | threads | 16 | 2943 | 1926 | 1013.338 | 1239.751 |
| `nextplaid@1` | open | threads | 16 | 4415 | 2399 | 894.195 | 920.892 |
| `nextplaid@1` | open | procs | 16 | 1472 | 1308 | 170.168 | 1484.549 |
| `nextplaid@1` | open | procs | 16 | 2943 | 2384 | 172.872 | 863.332 |
| `nextplaid@1` | open | procs | 16 | 4415 | 3202 | 60.416 | 512.075 |
| `numkong_native_f16` | closed | threads | 1 |  | 34061 | 0.027 | 0.058 |
| `numkong_native_f16` | closed | threads | 4 |  | 54798 | 0.068 | 0.160 |
| `numkong_native_f16` | closed | threads | 16 |  | 62572 | 0.173 | 1.145 |
| `numkong_native_f16` | closed | procs | 1 |  | 33889 | 0.027 | 0.065 |
| `numkong_native_f16` | closed | procs | 4 |  | 53934 | 0.066 | 0.155 |
| `numkong_native_f16` | closed | procs | 16 |  | 57473 | 0.124 | 3.187 |
| `numkong_native_f16` | open | threads | 16 | 1472 | 1489 | 8.418 | 20.091 |
| `numkong_native_f16` | open | threads | 16 | 2943 | 2970 | 47.586 | 95.297 |
| `numkong_native_f16` | open | threads | 16 | 4415 | 4359 | 144.588 | 354.321 |
| `numkong_native_f16` | open | procs | 16 | 1472 | 1489 | 0.103 | 0.661 |
| `numkong_native_f16` | open | procs | 16 | 2943 | 2979 | 0.102 | 0.222 |
| `numkong_native_f16` | open | procs | 16 | 4415 | 4468 | 0.103 | 1.735 |
| `numpy_packed` | closed | threads | 1 |  | 6307 | 0.150 | 0.318 |
| `numpy_packed` | closed | threads | 4 |  | 20627 | 0.179 | 0.381 |
| `numpy_packed` | closed | threads | 16 |  | 37591 | 0.388 | 0.913 |
| `numpy_packed` | closed | procs | 1 |  | 6237 | 0.161 | 0.349 |
| `numpy_packed` | closed | procs | 4 |  | 25987 | 0.123 | 0.299 |
| `numpy_packed` | closed | procs | 16 |  | 26759 | 0.271 | 3.643 |
| `numpy_packed` | open | threads | 16 | 1472 | 1489 | 7.588 | 23.129 |
| `numpy_packed` | open | threads | 16 | 2943 | 2970 | 16.607 | 40.842 |
| `numpy_packed` | open | threads | 16 | 4415 | 4291 | 162.049 | 323.854 |
| `numpy_packed` | open | procs | 16 | 1472 | 1489 | 0.175 | 0.839 |
| `numpy_packed` | open | procs | 16 | 2943 | 2979 | 0.177 | 0.456 |
| `numpy_packed` | open | procs | 16 | 4415 | 4468 | 0.176 | 0.444 |
| `numpy_packed_t` | closed | threads | 1 |  | 4228 | 0.223 | 0.456 |
| `numpy_packed_t` | closed | threads | 4 |  | 15454 | 0.242 | 0.487 |
| `numpy_packed_t` | closed | threads | 16 |  | 26693 | 0.550 | 1.383 |
| `numpy_packed_t` | closed | procs | 1 |  | 8491 | 0.104 | 0.247 |
| `numpy_packed_t` | closed | procs | 4 |  | 19278 | 0.099 | 0.271 |
| `numpy_packed_t` | closed | procs | 16 |  | 44500 | 0.321 | 0.672 |
| `numpy_packed_t` | open | threads | 16 | 1472 | 1489 | 8.459 | 22.245 |
| `numpy_packed_t` | open | threads | 16 | 2943 | 2944 | 82.257 | 148.936 |
| `numpy_packed_t` | open | threads | 16 | 4415 | 4195 | 184.271 | 377.019 |
| `numpy_packed_t` | open | procs | 16 | 1472 | 1489 | 0.249 | 0.609 |
| `numpy_packed_t` | open | procs | 16 | 2943 | 2979 | 0.252 | 2.441 |
| `numpy_packed_t` | open | procs | 16 | 4415 | 4468 | 0.252 | 1.738 |
| `torch_pad_bmm` | closed | threads | 1 |  | 6509 | 0.151 | 0.258 |
| `torch_pad_bmm` | closed | threads | 4 |  | 8599 | 0.432 | 0.882 |
| `torch_pad_bmm` | closed | threads | 16 |  | 8159 | 1.688 | 5.210 |
| `torch_pad_bmm` | closed | procs | 1 |  | 8262 | 0.107 | 0.235 |
| `torch_pad_bmm` | closed | procs | 4 |  | 17434 | 0.208 | 0.467 |
| `torch_pad_bmm` | closed | procs | 16 |  | 16001 | 0.693 | 6.742 |
| `torch_pad_bmm` | open | threads | 16 | 1472 | 1318 | 1272.428 | 2298.586 |
| `torch_pad_bmm` | open | threads | 16 | 2943 | 2276 | 905.179 | 1379.397 |
| `torch_pad_bmm` | open | threads | 16 | 4415 | 3005 | 708.921 | 952.826 |
| `torch_pad_bmm` | open | procs | 16 | 1472 | 1489 | 0.564 | 1.348 |
| `torch_pad_bmm` | open | procs | 16 | 2943 | 2978 | 0.578 | 1.479 |
| `torch_pad_bmm` | open | procs | 16 | 4415 | 4466 | 0.594 | 1.643 |

## Graviton4 — agent-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 14449 | 0.061 | 0.274 |
| `ours` | closed | threads | 4 |  | 10552 | 0.123 | 3.231 |
| `ours` | closed | threads | 16 |  | 8106 | 1.259 | 8.640 |
| `ours` | closed | procs | 1 |  | 14414 | 0.061 | 0.284 |
| `ours` | closed | procs | 4 |  | 15034 | 0.208 | 1.057 |
| `ours` | closed | procs | 16 |  | 12592 | 0.808 | 4.218 |
| `ours` | open | threads | 16 | 987 | 987 | 8.673 | 21.498 |
| `ours` | open | threads | 16 | 1975 | 1974 | 9.725 | 27.998 |
| `ours` | open | threads | 16 | 2962 | 2779 | 141.903 | 281.821 |
| `ours` | open | procs | 16 | 987 | 987 | 0.701 | 4.377 |
| `ours` | open | procs | 16 | 1975 | 1974 | 0.718 | 5.721 |
| `ours` | open | procs | 16 | 2962 | 2961 | 0.727 | 7.985 |
| `nextplaid` | closed | threads | 1 |  | 7012 | 0.129 | 0.382 |
| `nextplaid` | closed | threads | 4 |  | 10775 | 0.309 | 1.197 |
| `nextplaid` | closed | threads | 16 |  | 11590 | 0.782 | 7.775 |
| `nextplaid` | closed | procs | 1 |  | 6864 | 0.130 | 0.429 |
| `nextplaid` | closed | procs | 4 |  | 9610 | 0.320 | 1.646 |
| `nextplaid` | closed | procs | 16 |  | 11158 | 0.968 | 5.091 |
| `nextplaid` | open | threads | 16 | 987 | 987 | 9.495 | 19.388 |
| `nextplaid` | open | threads | 16 | 1975 | 1969 | 15.887 | 43.235 |
| `nextplaid` | open | threads | 16 | 2962 | 2741 | 218.038 | 407.692 |
| `nextplaid` | open | procs | 16 | 987 | 987 | 0.786 | 4.440 |
| `nextplaid` | open | procs | 16 | 1975 | 1974 | 0.814 | 6.100 |
| `nextplaid` | open | procs | 16 | 2962 | 2961 | 0.845 | 10.013 |
| `numkong_native_f16` | closed | threads | 1 |  | 18689 | 0.047 | 0.139 |
| `numkong_native_f16` | closed | threads | 4 |  | 30581 | 0.111 | 0.428 |
| `numkong_native_f16` | closed | threads | 16 |  | 29460 | 0.422 | 2.231 |
| `numkong_native_f16` | closed | procs | 1 |  | 16364 | 0.051 | 0.170 |
| `numkong_native_f16` | closed | procs | 4 |  | 23575 | 0.129 | 0.579 |
| `numkong_native_f16` | closed | procs | 16 |  | 33489 | 0.308 | 1.574 |
| `numkong_native_f16` | open | threads | 16 | 987 | 987 | 8.673 | 18.612 |
| `numkong_native_f16` | open | threads | 16 | 1975 | 1974 | 9.711 | 21.496 |
| `numkong_native_f16` | open | threads | 16 | 2962 | 2906 | 144.513 | 268.885 |
| `numkong_native_f16` | open | procs | 16 | 987 | 987 | 0.278 | 1.626 |
| `numkong_native_f16` | open | procs | 16 | 1975 | 1975 | 0.280 | 1.463 |
| `numkong_native_f16` | open | procs | 16 | 2962 | 2962 | 0.282 | 1.708 |
| `numpy_packed` | closed | threads | 1 |  | 8505 | 0.104 | 0.452 |
| `numpy_packed` | closed | threads | 4 |  | 8000 | 0.106 | 9.153 |
| `numpy_packed` | closed | threads | 16 |  | 6261 | 0.108 | 50.990 |
| `numpy_packed` | closed | procs | 1 |  | 4541 | 0.218 | 0.689 |
| `numpy_packed` | closed | procs | 4 |  | 9038 | 0.356 | 1.697 |
| `numpy_packed` | closed | procs | 16 |  | 8789 | 1.183 | 6.187 |
| `numpy_packed` | open | threads | 16 | 987 | 956 | 795.620 | 1137.639 |
| `numpy_packed` | open | threads | 16 | 1975 | 1694 | 846.721 | 1268.875 |
| `numpy_packed` | open | threads | 16 | 2962 | 2219 | 751.595 | 1106.470 |
| `numpy_packed` | open | procs | 16 | 987 | 987 | 0.971 | 6.743 |
| `numpy_packed` | open | procs | 16 | 1975 | 1974 | 1.017 | 10.725 |
| `numpy_packed` | open | procs | 16 | 2962 | 2944 | 1.093 | 18.624 |
| `torch_pad_flat` | closed | threads | 1 |  | 2494 | 0.371 | 0.960 |
| `torch_pad_flat` | closed | threads | 4 |  | 4418 | 0.792 | 2.857 |
| `torch_pad_flat` | closed | threads | 16 |  | 4338 | 3.347 | 10.233 |
| `torch_pad_flat` | closed | procs | 1 |  | 4686 | 0.180 | 0.747 |
| `torch_pad_flat` | closed | procs | 4 |  | 1738 | 2.157 | 4.563 |
| `torch_pad_flat` | closed | procs | 16 |  | 2727 | 4.679 | 16.574 |
| `torch_pad_flat` | open | threads | 16 | 987 | 847 | 1761.660 | 3021.571 |
| `torch_pad_flat` | open | threads | 16 | 1975 | 1423 | 1221.389 | 1759.037 |
| `torch_pad_flat` | open | threads | 16 | 2962 | 1866 | 961.946 | 1194.983 |
| `torch_pad_flat` | open | procs | 16 | 987 | 987 | 3.679 | 15.412 |
| `torch_pad_flat` | open | procs | 16 | 1975 | 1968 | 5.668 | 56.559 |
| `torch_pad_flat` | open | procs | 16 | 2962 | 2838 | 12.628 | 83.125 |

## Graviton4 — gcsn-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 29195 | 0.032 | 0.076 |
| `ours` | closed | threads | 4 |  | 25415 | 0.067 | 1.765 |
| `ours` | closed | threads | 16 |  | 16290 | 0.680 | 4.836 |
| `ours` | closed | procs | 1 |  | 28948 | 0.032 | 0.074 |
| `ours` | closed | procs | 4 |  | 38393 | 0.093 | 0.246 |
| `ours` | closed | procs | 16 |  | 31006 | 0.342 | 1.005 |
| `ours` | open | threads | 16 | 859 | 869 | 8.129 | 19.459 |
| `ours` | open | threads | 16 | 1718 | 1738 | 8.214 | 25.903 |
| `ours` | open | threads | 16 | 2577 | 2605 | 14.225 | 36.342 |
| `ours` | open | procs | 16 | 859 | 869 | 0.301 | 0.811 |
| `ours` | open | procs | 16 | 1718 | 1739 | 0.303 | 0.803 |
| `ours` | open | procs | 16 | 2577 | 2608 | 0.304 | 0.829 |
| `nextplaid` | closed | threads | 1 |  | 10786 | 0.089 | 0.171 |
| `nextplaid` | closed | threads | 4 |  | 19803 | 0.183 | 0.478 |
| `nextplaid` | closed | threads | 16 |  | 22114 | 0.460 | 3.490 |
| `nextplaid` | closed | procs | 1 |  | 9949 | 0.097 | 0.185 |
| `nextplaid` | closed | procs | 4 |  | 18410 | 0.183 | 0.506 |
| `nextplaid` | closed | procs | 16 |  | 32049 | 0.436 | 1.009 |
| `nextplaid` | open | threads | 16 | 859 | 869 | 9.360 | 18.386 |
| `nextplaid` | open | threads | 16 | 1718 | 1738 | 10.681 | 22.865 |
| `nextplaid` | open | threads | 16 | 2577 | 2554 | 133.547 | 317.305 |
| `nextplaid` | open | procs | 16 | 859 | 869 | 0.365 | 0.817 |
| `nextplaid` | open | procs | 16 | 1718 | 1739 | 0.362 | 0.887 |
| `nextplaid` | open | procs | 16 | 2577 | 2608 | 0.364 | 0.925 |
| `numkong_native_f16` | closed | threads | 1 |  | 32704 | 0.029 | 0.074 |
| `numkong_native_f16` | closed | threads | 4 |  | 53623 | 0.069 | 0.165 |
| `numkong_native_f16` | closed | threads | 16 |  | 56243 | 0.235 | 0.932 |
| `numkong_native_f16` | closed | procs | 1 |  | 32291 | 0.029 | 0.081 |
| `numkong_native_f16` | closed | procs | 4 |  | 40984 | 0.077 | 0.213 |
| `numkong_native_f16` | closed | procs | 16 |  | 52046 | 0.140 | 0.428 |
| `numkong_native_f16` | open | threads | 16 | 859 | 869 | 8.397 | 20.688 |
| `numkong_native_f16` | open | threads | 16 | 1718 | 1738 | 8.553 | 21.066 |
| `numkong_native_f16` | open | threads | 16 | 2577 | 2606 | 11.934 | 27.468 |
| `numkong_native_f16` | open | procs | 16 | 859 | 869 | 0.126 | 0.294 |
| `numkong_native_f16` | open | procs | 16 | 1718 | 1739 | 0.127 | 0.293 |
| `numkong_native_f16` | open | procs | 16 | 2577 | 2608 | 0.128 | 0.300 |
| `numpy_packed` | closed | threads | 1 |  | 15590 | 0.062 | 0.113 |
| `numpy_packed` | closed | threads | 4 |  | 13374 | 0.064 | 6.157 |
| `numpy_packed` | closed | threads | 16 |  | 8140 | 0.064 | 52.243 |
| `numpy_packed` | closed | procs | 1 |  | 7567 | 0.128 | 0.337 |
| `numpy_packed` | closed | procs | 4 |  | 19263 | 0.175 | 0.545 |
| `numpy_packed` | closed | procs | 16 |  | 26541 | 0.500 | 1.441 |
| `numpy_packed` | open | threads | 16 | 859 | 869 | 4.417 | 161.925 |
| `numpy_packed` | open | threads | 16 | 1718 | 1664 | 305.005 | 876.191 |
| `numpy_packed` | open | threads | 16 | 2577 | 2535 | 92.730 | 203.937 |
| `numpy_packed` | open | procs | 16 | 859 | 869 | 0.411 | 1.053 |
| `numpy_packed` | open | procs | 16 | 1718 | 1739 | 0.414 | 1.104 |
| `numpy_packed` | open | procs | 16 | 2577 | 2608 | 0.421 | 1.181 |
| `torch_pad_flat` | closed | threads | 1 |  | 2632 | 0.389 | 0.618 |
| `torch_pad_flat` | closed | threads | 4 |  | 5284 | 0.701 | 1.513 |
| `torch_pad_flat` | closed | threads | 16 |  | 5065 | 2.944 | 7.259 |
| `torch_pad_flat` | closed | procs | 1 |  | 4785 | 0.183 | 0.453 |
| `torch_pad_flat` | closed | procs | 4 |  | 1965 | 2.034 | 3.640 |
| `torch_pad_flat` | closed | procs | 16 |  | 3752 | 4.338 | 7.545 |
| `torch_pad_flat` | open | threads | 16 | 859 | 778 | 2096.654 | 3747.455 |
| `torch_pad_flat` | open | threads | 16 | 1718 | 1359 | 1444.527 | 2259.746 |
| `torch_pad_flat` | open | threads | 16 | 2577 | 1805 | 1189.762 | 1637.016 |
| `torch_pad_flat` | open | procs | 16 | 859 | 869 | 2.691 | 8.387 |
| `torch_pad_flat` | open | procs | 16 | 1718 | 1735 | 3.725 | 12.308 |
| `torch_pad_flat` | open | procs | 16 | 2577 | 2586 | 5.490 | 22.193 |

## M3 Max — agent-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 7141 | 0.116 | 0.604 |
| `ours` | closed | threads | 4 |  | 7325 | 0.288 | 2.785 |
| `ours` | closed | threads | 16 |  | 6082 | 1.043 | 15.376 |
| `ours` | closed | procs | 1 |  | 13754 | 0.056 | 0.317 |
| `ours` | closed | procs | 4 |  | 20763 | 0.137 | 0.793 |
| `ours` | closed | procs | 16 |  | 8319 | 0.692 | 4.292 |
| `ours` | open | threads | 16 | 3908 | 3488 | 132.383 | 273.532 |
| `ours` | open | threads | 16 | 7816 | 4866 | 282.772 | 341.330 |
| `ours` | open | threads | 16 | 11724 | 5168 | 277.796 | 431.808 |
| `ours` | open | procs | 16 | 3908 | 3659 | 2.136 | 86.345 |
| `ours` | open | procs | 16 | 7816 | 6448 | 6.298 | 64.357 |
| `ours` | open | procs | 16 | 11724 | 7405 | 6.762 | 105.979 |
| `maxsim_cpu_variable@1` | closed | threads | 1 |  | 2870 | 0.329 | 1.668 |
| `maxsim_cpu_variable@1` | closed | threads | 4 |  | 4164 | 0.867 | 3.601 |
| `maxsim_cpu_variable@1` | closed | threads | 16 |  | 3844 | 3.800 | 11.305 |
| `maxsim_cpu_variable@1` | closed | procs | 1 |  | 2360 | 0.394 | 2.047 |
| `maxsim_cpu_variable@1` | closed | procs | 4 |  | 6167 | 0.523 | 2.797 |
| `maxsim_cpu_variable@1` | closed | procs | 16 |  | 7799 | 1.355 | 5.619 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 3908 | 2652 | 453.518 | 490.736 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 7816 | 3032 | 503.297 | 804.335 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 11724 | 3367 | 500.755 | 842.989 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 3908 | 3719 | 7.109 | 88.569 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 7816 | 5104 | 82.586 | 300.603 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 11724 | 5629 | 43.811 | 350.669 |
| `nextplaid` | closed | threads | 1 |  | 4676 | 0.193 | 0.586 |
| `nextplaid` | closed | threads | 4 |  | 4276 | 0.646 | 4.092 |
| `nextplaid` | closed | threads | 16 |  | 5199 | 1.038 | 30.365 |
| `nextplaid` | closed | procs | 1 |  | 4982 | 0.186 | 0.506 |
| `nextplaid` | closed | procs | 4 |  | 6993 | 0.432 | 1.990 |
| `nextplaid` | closed | procs | 16 |  | 8675 | 1.038 | 5.937 |
| `nextplaid` | open | threads | 16 | 3908 | 2752 | 397.159 | 518.335 |
| `nextplaid` | open | threads | 16 | 7816 | 3344 | 406.237 | 684.824 |
| `nextplaid` | open | threads | 16 | 11724 | 3664 | 424.821 | 747.187 |
| `nextplaid` | open | procs | 16 | 3908 | 3614 | 5.043 | 88.693 |
| `nextplaid` | open | procs | 16 | 7816 | 4243 | 89.626 | 362.227 |
| `nextplaid` | open | procs | 16 | 11724 | 4761 | 38.410 | 405.082 |
| `numkong_native_f16` | closed | threads | 1 |  | 11172 | 0.079 | 0.229 |
| `numkong_native_f16` | closed | threads | 4 |  | 25002 | 0.131 | 0.479 |
| `numkong_native_f16` | closed | threads | 16 |  | 30685 | 0.198 | 4.508 |
| `numkong_native_f16` | closed | procs | 1 |  | 10776 | 0.084 | 0.228 |
| `numkong_native_f16` | closed | procs | 4 |  | 29548 | 0.114 | 0.364 |
| `numkong_native_f16` | closed | procs | 16 |  | 4594 | 0.586 | 23.623 |
| `numkong_native_f16` | open | threads | 16 | 3908 | 3703 | 254.041 | 464.034 |
| `numkong_native_f16` | open | threads | 16 | 7816 | 6724 | 222.151 | 374.195 |
| `numkong_native_f16` | open | threads | 16 | 11724 | 9211 | 179.227 | 279.650 |
| `numkong_native_f16` | open | procs | 16 | 3908 | 3894 | 0.696 | 45.801 |
| `numkong_native_f16` | open | procs | 16 | 7816 | 7420 | 0.267 | 8.767 |
| `numkong_native_f16` | open | procs | 16 | 11724 | 11538 | 0.219 | 4.787 |
| `numkong_native_f16@1` | closed | threads | 1 |  | 6328 | 0.137 | 0.712 |
| `numkong_native_f16@1` | closed | threads | 4 |  | 21127 | 0.144 | 0.745 |
| `numkong_native_f16@1` | closed | threads | 16 |  | 47591 | 0.245 | 0.980 |
| `numkong_native_f16@1` | closed | procs | 1 |  | 5135 | 0.168 | 0.893 |
| `numkong_native_f16@1` | closed | procs | 4 |  | 16855 | 0.177 | 0.901 |
| `numkong_native_f16@1` | closed | procs | 16 |  | 44899 | 0.216 | 1.584 |
| `numkong_native_f16@1` | open | threads | 16 | 3908 | 3775 | 208.486 | 396.229 |
| `numkong_native_f16@1` | open | threads | 16 | 7816 | 7465 | 76.395 | 178.083 |
| `numkong_native_f16@1` | open | threads | 16 | 11724 | 9810 | 158.848 | 269.904 |
| `numkong_native_f16@1` | open | procs | 16 | 3908 | 3904 | 0.383 | 5.537 |
| `numkong_native_f16@1` | open | procs | 16 | 7816 | 7590 | 0.344 | 7.372 |
| `numkong_native_f16@1` | open | procs | 16 | 11724 | 11369 | 0.307 | 7.110 |
| `numpy_packed@1` | closed | threads | 1 |  | 7048 | 0.133 | 0.608 |
| `numpy_packed@1` | closed | threads | 4 |  | 10605 | 0.284 | 1.401 |
| `numpy_packed@1` | closed | threads | 16 |  | 9387 | 1.264 | 5.615 |
| `numpy_packed@1` | closed | procs | 1 |  | 4615 | 0.201 | 0.942 |
| `numpy_packed@1` | closed | procs | 4 |  | 6301 | 0.360 | 1.856 |
| `numpy_packed@1` | closed | procs | 16 |  | 4133 | 1.401 | 12.432 |
| `numpy_packed@1` | open | threads | 16 | 3908 | 3251 | 309.931 | 496.197 |
| `numpy_packed@1` | open | threads | 16 | 7816 | 3603 | 364.050 | 600.735 |
| `numpy_packed@1` | open | threads | 16 | 11724 | 4091 | 322.251 | 633.516 |
| `numpy_packed@1` | open | procs | 16 | 3908 | 3811 | 14.421 | 342.745 |
| `numpy_packed@1` | open | procs | 16 | 7816 | 4578 | 182.873 | 372.221 |
| `numpy_packed@1` | open | procs | 16 | 11724 | 5207 | 22.245 | 425.186 |
| `torch_pad_bmm@1` | closed | threads | 1 |  | 3778 | 0.261 | 1.235 |
| `torch_pad_bmm@1` | closed | threads | 4 |  | 6311 | 0.461 | 2.389 |
| `torch_pad_bmm@1` | closed | threads | 16 |  | 7964 | 1.591 | 5.402 |
| `torch_pad_bmm@1` | closed | procs | 1 |  | 2895 | 0.326 | 1.610 |
| `torch_pad_bmm@1` | closed | procs | 4 |  | 5737 | 0.390 | 2.332 |
| `torch_pad_bmm@1` | closed | procs | 16 |  | 5341 | 1.295 | 9.398 |
| `torch_pad_bmm@1` | open | threads | 16 | 3908 | 2629 | 651.179 | 950.622 |
| `torch_pad_bmm@1` | open | threads | 16 | 7816 | 3216 | 458.444 | 718.545 |
| `torch_pad_bmm@1` | open | threads | 16 | 11724 | 3672 | 355.941 | 721.231 |
| `torch_pad_bmm@1` | open | procs | 16 | 3908 | 3745 | 19.029 | 306.568 |
| `torch_pad_bmm@1` | open | procs | 16 | 7816 | 4808 | 216.268 | 411.882 |
| `torch_pad_bmm@1` | open | procs | 16 | 11724 | 5158 | 295.631 | 468.311 |
| `torch_segment_reduce` | closed | threads | 1 |  | 2934 | 0.303 | 1.692 |
| `torch_segment_reduce` | closed | threads | 4 |  | 7798 | 0.390 | 2.104 |
| `torch_segment_reduce` | closed | threads | 16 |  | 8828 | 1.583 | 4.750 |
| `torch_segment_reduce` | closed | procs | 1 |  | 2527 | 0.357 | 1.850 |
| `torch_segment_reduce` | closed | procs | 4 |  | 5489 | 0.421 | 2.513 |
| `torch_segment_reduce` | closed | procs | 16 |  | 8999 | 1.130 | 9.590 |
| `torch_segment_reduce` | open | threads | 16 | 3908 | 2760 | 668.924 | 959.359 |
| `torch_segment_reduce` | open | threads | 16 | 7816 | 4157 | 460.752 | 497.160 |
| `torch_segment_reduce` | open | threads | 16 | 11724 | 5035 | 383.753 | 446.557 |
| `torch_segment_reduce` | open | procs | 16 | 3908 | 3887 | 0.955 | 13.761 |
| `torch_segment_reduce` | open | procs | 16 | 7816 | 7100 | 1.355 | 36.751 |
| `torch_segment_reduce` | open | procs | 16 | 11724 | 9397 | 15.224 | 182.492 |

## M3 Max — gcsn-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 39651 | 0.023 | 0.060 |
| `ours` | closed | threads | 4 |  | 40323 | 0.058 | 0.640 |
| `ours` | closed | threads | 16 |  | 38625 | 0.230 | 1.938 |
| `ours` | closed | procs | 1 |  | 32464 | 0.025 | 0.209 |
| `ours` | closed | procs | 4 |  | 53376 | 0.062 | 0.245 |
| `ours` | closed | procs | 16 |  | 49343 | 0.195 | 0.893 |
| `ours` | open | threads | 16 | 3052 | 3035 | 95.111 | 214.481 |
| `ours` | open | threads | 16 | 6105 | 5655 | 244.732 | 431.651 |
| `ours` | open | threads | 16 | 9157 | 7929 | 209.858 | 366.284 |
| `ours` | open | procs | 16 | 3052 | 3088 | 0.345 | 2.908 |
| `ours` | open | procs | 16 | 6105 | 6176 | 0.348 | 4.655 |
| `ours` | open | procs | 16 | 9157 | 9260 | 0.311 | 1.885 |
| `maxsim_cpu_variable@1` | closed | threads | 1 |  | 5755 | 0.168 | 0.293 |
| `maxsim_cpu_variable@1` | closed | threads | 4 |  | 9406 | 0.413 | 0.703 |
| `maxsim_cpu_variable@1` | closed | threads | 16 |  | 9507 | 1.655 | 2.579 |
| `maxsim_cpu_variable@1` | closed | procs | 1 |  | 5694 | 0.169 | 0.296 |
| `maxsim_cpu_variable@1` | closed | procs | 4 |  | 16092 | 0.238 | 0.388 |
| `maxsim_cpu_variable@1` | closed | procs | 16 |  | 23079 | 0.639 | 1.063 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 3052 | 2757 | 311.222 | 549.395 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 6105 | 4272 | 404.714 | 524.107 |
| `maxsim_cpu_variable@1` | open | threads | 16 | 9157 | 5143 | 399.560 | 412.423 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 3052 | 3087 | 0.851 | 3.605 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 6105 | 6172 | 0.783 | 2.726 |
| `maxsim_cpu_variable@1` | open | procs | 16 | 9157 | 9233 | 0.786 | 2.790 |
| `nextplaid` | closed | threads | 1 |  | 7696 | 0.121 | 0.254 |
| `nextplaid` | closed | threads | 4 |  | 15636 | 0.219 | 0.674 |
| `nextplaid` | closed | threads | 16 |  | 16663 | 0.355 | 8.526 |
| `nextplaid` | closed | procs | 1 |  | 7718 | 0.119 | 0.258 |
| `nextplaid` | closed | procs | 4 |  | 21758 | 0.169 | 0.317 |
| `nextplaid` | closed | procs | 16 |  | 30293 | 0.378 | 1.543 |
| `nextplaid` | open | threads | 16 | 3052 | 2893 | 304.327 | 578.600 |
| `nextplaid` | open | threads | 16 | 6105 | 5008 | 325.932 | 520.747 |
| `nextplaid` | open | threads | 16 | 9157 | 6581 | 291.056 | 403.255 |
| `nextplaid` | open | procs | 16 | 3052 | 3088 | 0.529 | 3.582 |
| `nextplaid` | open | procs | 16 | 6105 | 6174 | 0.537 | 3.185 |
| `nextplaid` | open | procs | 16 | 9157 | 9234 | 0.513 | 3.914 |
| `numkong_native_f16` | closed | threads | 1 |  | 14802 | 0.059 | 0.182 |
| `numkong_native_f16` | closed | threads | 4 |  | 37746 | 0.092 | 0.272 |
| `numkong_native_f16` | closed | threads | 16 |  | 45805 | 0.158 | 2.806 |
| `numkong_native_f16` | closed | procs | 1 |  | 14708 | 0.060 | 0.169 |
| `numkong_native_f16` | closed | procs | 4 |  | 49384 | 0.070 | 0.167 |
| `numkong_native_f16` | closed | procs | 16 |  | 88955 | 0.105 | 0.425 |
| `numkong_native_f16` | open | threads | 16 | 3052 | 3030 | 221.653 | 451.349 |
| `numkong_native_f16` | open | threads | 16 | 6105 | 5710 | 266.560 | 464.804 |
| `numkong_native_f16` | open | threads | 16 | 9157 | 8027 | 227.002 | 394.812 |
| `numkong_native_f16` | open | procs | 16 | 3052 | 3089 | 0.133 | 2.014 |
| `numkong_native_f16` | open | procs | 16 | 6105 | 6177 | 0.120 | 1.704 |
| `numkong_native_f16` | open | procs | 16 | 9157 | 9262 | 0.110 | 1.246 |
| `numkong_native_f16@1` | closed | threads | 1 |  | 13478 | 0.069 | 0.160 |
| `numkong_native_f16@1` | closed | threads | 4 |  | 48134 | 0.076 | 0.171 |
| `numkong_native_f16@1` | closed | threads | 16 |  | 77606 | 0.181 | 0.641 |
| `numkong_native_f16@1` | closed | procs | 1 |  | 12779 | 0.072 | 0.164 |
| `numkong_native_f16@1` | closed | procs | 4 |  | 41404 | 0.078 | 0.190 |
| `numkong_native_f16@1` | closed | procs | 16 |  | 85537 | 0.108 | 0.462 |
| `numkong_native_f16@1` | open | threads | 16 | 3052 | 3077 | 61.576 | 131.177 |
| `numkong_native_f16@1` | open | threads | 16 | 6105 | 5922 | 170.426 | 374.387 |
| `numkong_native_f16@1` | open | threads | 16 | 9157 | 8540 | 178.517 | 334.806 |
| `numkong_native_f16@1` | open | procs | 16 | 3052 | 3089 | 0.119 | 1.253 |
| `numkong_native_f16@1` | open | procs | 16 | 6105 | 6176 | 0.110 | 1.293 |
| `numkong_native_f16@1` | open | procs | 16 | 9157 | 9263 | 0.102 | 1.323 |
| `numpy_packed@1` | closed | threads | 1 |  | 16197 | 0.058 | 0.116 |
| `numpy_packed@1` | closed | threads | 4 |  | 29682 | 0.114 | 0.309 |
| `numpy_packed@1` | closed | threads | 16 |  | 26657 | 0.553 | 1.412 |
| `numpy_packed@1` | closed | procs | 1 |  | 12486 | 0.073 | 0.179 |
| `numpy_packed@1` | closed | procs | 4 |  | 22876 | 0.097 | 0.511 |
| `numpy_packed@1` | closed | procs | 16 |  | 25317 | 0.389 | 2.912 |
| `numpy_packed@1` | open | threads | 16 | 3052 | 3009 | 164.525 | 337.885 |
| `numpy_packed@1` | open | threads | 16 | 6105 | 5372 | 281.877 | 493.699 |
| `numpy_packed@1` | open | threads | 16 | 9157 | 7450 | 225.063 | 364.068 |
| `numpy_packed@1` | open | procs | 16 | 3052 | 3089 | 0.133 | 1.801 |
| `numpy_packed@1` | open | procs | 16 | 6105 | 6178 | 0.134 | 1.369 |
| `numpy_packed@1` | open | procs | 16 | 9157 | 9263 | 0.134 | 1.367 |
| `torch_pad_bmm@1` | closed | threads | 1 |  | 5338 | 0.190 | 0.259 |
| `torch_pad_bmm@1` | closed | threads | 4 |  | 11834 | 0.285 | 0.948 |
| `torch_pad_bmm@1` | closed | threads | 16 |  | 12920 | 1.188 | 2.265 |
| `torch_pad_bmm@1` | closed | procs | 1 |  | 4532 | 0.217 | 0.350 |
| `torch_pad_bmm@1` | closed | procs | 4 |  | 9392 | 0.270 | 0.863 |
| `torch_pad_bmm@1` | closed | procs | 16 |  | 17117 | 0.637 | 3.333 |
| `torch_pad_bmm@1` | open | threads | 16 | 3052 | 2535 | 846.468 | 1387.478 |
| `torch_pad_bmm@1` | open | threads | 16 | 6105 | 4225 | 534.519 | 738.187 |
| `torch_pad_bmm@1` | open | threads | 16 | 9157 | 5422 | 424.926 | 501.444 |
| `torch_pad_bmm@1` | open | procs | 16 | 3052 | 3088 | 0.358 | 4.197 |
| `torch_pad_bmm@1` | open | procs | 16 | 6105 | 6156 | 0.367 | 2.534 |
| `torch_pad_bmm@1` | open | procs | 16 | 9157 | 9229 | 0.386 | 3.845 |
| `torch_segment_reduce` | closed | threads | 1 |  | 7147 | 0.129 | 0.322 |
| `torch_segment_reduce` | closed | threads | 4 |  | 17091 | 0.196 | 0.672 |
| `torch_segment_reduce` | closed | threads | 16 |  | 12915 | 1.183 | 2.335 |
| `torch_segment_reduce` | closed | procs | 1 |  | 6752 | 0.136 | 0.346 |
| `torch_segment_reduce` | closed | procs | 4 |  | 15237 | 0.163 | 0.668 |
| `torch_segment_reduce` | closed | procs | 16 |  | 20182 | 0.397 | 3.012 |
| `torch_segment_reduce` | open | threads | 16 | 3052 | 2521 | 859.701 | 1402.411 |
| `torch_segment_reduce` | open | threads | 16 | 6105 | 4233 | 531.524 | 734.526 |
| `torch_segment_reduce` | open | threads | 16 | 9157 | 5440 | 421.679 | 499.367 |
| `torch_segment_reduce` | open | procs | 16 | 3052 | 3088 | 0.258 | 2.624 |
| `torch_segment_reduce` | open | procs | 16 | 6105 | 6173 | 0.254 | 2.106 |
| `torch_segment_reduce` | open | procs | 16 | 9157 | 9243 | 0.246 | 2.625 |

## EPYC — agent-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 7847 | 0.110 | 0.606 |
| `ours` | closed | threads | 4 |  | 5974 | 0.314 | 4.329 |
| `ours` | closed | threads | 16 |  | 3261 | 2.254 | 30.919 |
| `ours` | closed | procs | 1 |  | 7328 | 0.110 | 0.636 |
| `ours` | closed | procs | 4 |  | 7674 | 0.382 | 2.233 |
| `ours` | closed | procs | 16 |  | 6673 | 0.787 | 11.061 |
| `ours` | open | threads | 16 | 364 | 364 | 8.780 | 28.069 |
| `ours` | open | threads | 16 | 728 | 728 | 10.432 | 40.342 |
| `ours` | open | threads | 16 | 1093 | 1092 | 10.895 | 39.920 |
| `ours` | open | procs | 16 | 364 | 364 | 1.327 | 9.668 |
| `ours` | open | procs | 16 | 728 | 728 | 1.473 | 10.203 |
| `ours` | open | procs | 16 | 1093 | 1093 | 1.473 | 13.512 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 3274 | 0.272 | 1.239 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 3931 | 0.828 | 3.803 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 3956 | 1.478 | 32.314 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 2949 | 0.279 | 1.606 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 3598 | 0.824 | 4.479 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 2706 | 2.937 | 19.587 |
| `maxsim_cpu_variable` | open | threads | 16 | 364 | 364 | 11.058 | 25.061 |
| `maxsim_cpu_variable` | open | threads | 16 | 728 | 728 | 12.316 | 33.211 |
| `maxsim_cpu_variable` | open | threads | 16 | 1093 | 1092 | 14.332 | 37.399 |
| `maxsim_cpu_variable` | open | procs | 16 | 364 | 364 | 5.389 | 28.856 |
| `maxsim_cpu_variable` | open | procs | 16 | 728 | 727 | 5.476 | 46.150 |
| `maxsim_cpu_variable` | open | procs | 16 | 1093 | 1082 | 5.760 | 86.368 |
| `nextplaid` | closed | threads | 1 |  | 1456 | 0.502 | 5.193 |
| `nextplaid` | closed | threads | 4 |  | 1600 | 1.840 | 13.988 |
| `nextplaid` | closed | threads | 16 |  | 1606 | 3.036 | 99.644 |
| `nextplaid` | closed | procs | 1 |  | 1390 | 0.536 | 5.513 |
| `nextplaid` | closed | procs | 4 |  | 183 | 3.937 | 228.138 |
| `nextplaid` | closed | procs | 16 |  | 50 | 110.292 | 2212.385 |
| `nextplaid` | open | threads | 16 | 364 | 359 | 15.710 | 2634.868 |
| `nextplaid` | open | threads | 16 | 728 | 707 | 19.708 | 455.697 |
| `nextplaid` | open | threads | 16 | 1093 | 902 | 1040.294 | 1255.493 |
| `nextplaid` | open | procs | 16 | 364 | 49 | 40432.146 | 71676.348 |
| `nextplaid` | open | procs | 16 | 728 | 48 | 44148.275 | 77437.559 |
| `nextplaid` | open | procs | 16 | 1093 | 47 | 43753.097 | 81675.020 |
| `nextplaid@4` | closed | threads | 1 |  | 1424 | 0.527 | 4.352 |
| `nextplaid@4` | closed | threads | 4 |  | 1455 | 1.716 | 17.085 |
| `nextplaid@4` | closed | threads | 16 |  | 1552 | 3.985 | 92.491 |
| `nextplaid@4` | closed | procs | 1 |  | 1547 | 0.518 | 4.171 |
| `nextplaid@4` | closed | procs | 4 |  | 112 | 6.613 | 266.186 |
| `nextplaid@4` | closed | procs | 16 |  | 42 | 219.272 | 2078.327 |
| `nextplaid@4` | open | threads | 16 | 364 | 360 | 11.071 | 1137.601 |
| `nextplaid@4` | open | threads | 16 | 728 | 707 | 14.030 | 458.552 |
| `nextplaid@4` | open | threads | 16 | 1093 | 986 | 558.793 | 686.422 |
| `nextplaid@4` | open | procs | 16 | 364 | 41 | 47432.612 | 86624.330 |
| `nextplaid@4` | open | procs | 16 | 728 | 41 | 51476.734 | 92793.018 |
| `nextplaid@4` | open | procs | 16 | 1093 | 41 | 52329.050 | 93744.215 |
| `numkong_native_f16` | closed | threads | 1 |  | 9453 | 0.091 | 0.383 |
| `numkong_native_f16` | closed | threads | 4 |  | 11685 | 0.281 | 1.243 |
| `numkong_native_f16` | closed | threads | 16 |  | 11926 | 0.559 | 11.000 |
| `numkong_native_f16` | closed | procs | 1 |  | 8262 | 0.093 | 0.407 |
| `numkong_native_f16` | closed | procs | 4 |  | 9026 | 0.289 | 1.929 |
| `numkong_native_f16` | closed | procs | 16 |  | 8397 | 0.475 | 10.359 |
| `numkong_native_f16` | open | threads | 16 | 364 | 364 | 9.618 | 22.054 |
| `numkong_native_f16` | open | threads | 16 | 728 | 728 | 9.901 | 26.088 |
| `numkong_native_f16` | open | threads | 16 | 1093 | 1092 | 10.681 | 27.060 |
| `numkong_native_f16` | open | procs | 16 | 364 | 364 | 0.951 | 7.513 |
| `numkong_native_f16` | open | procs | 16 | 728 | 728 | 1.039 | 7.988 |
| `numkong_native_f16` | open | procs | 16 | 1093 | 1092 | 0.966 | 7.964 |
| `numpy_packed` | closed | threads | 1 |  | 4865 | 0.188 | 0.795 |
| `numpy_packed` | closed | threads | 4 |  | 4338 | 0.198 | 11.111 |
| `numpy_packed` | closed | threads | 16 |  | 4276 | 0.201 | 50.330 |
| `numpy_packed` | closed | procs | 1 |  | 2348 | 0.256 | 1.684 |
| `numpy_packed` | closed | procs | 4 |  | 3599 | 0.562 | 3.254 |
| `numpy_packed` | closed | procs | 16 |  | 3158 | 1.048 | 13.020 |
| `numpy_packed` | open | threads | 16 | 364 | 364 | 13.604 | 176.496 |
| `numpy_packed` | open | threads | 16 | 728 | 678 | 1442.773 | 2457.224 |
| `numpy_packed` | open | threads | 16 | 1093 | 998 | 833.274 | 1466.306 |
| `numpy_packed` | open | procs | 16 | 364 | 364 | 1.557 | 15.055 |
| `numpy_packed` | open | procs | 16 | 728 | 728 | 1.682 | 12.968 |
| `numpy_packed` | open | procs | 16 | 1093 | 1092 | 1.817 | 34.090 |
| `torch_pad_bmm` | closed | threads | 1 |  | 3109 | 0.295 | 1.388 |
| `torch_pad_bmm` | closed | threads | 4 |  | 3805 | 0.892 | 3.728 |
| `torch_pad_bmm` | closed | threads | 16 |  | 4273 | 3.094 | 15.378 |
| `torch_pad_bmm` | closed | procs | 1 |  | 2172 | 0.325 | 7.090 |
| `torch_pad_bmm` | closed | procs | 4 |  | 3671 | 0.742 | 6.986 |
| `torch_pad_bmm` | closed | procs | 16 |  | 2661 | 1.593 | 18.309 |
| `torch_pad_bmm` | open | threads | 16 | 364 | 364 | 87.195 | 228.328 |
| `torch_pad_bmm` | open | threads | 16 | 728 | 283 | 1706.398 | 3093.596 |
| `torch_pad_bmm` | open | threads | 16 | 1093 | 926 | 1468.287 | 2469.334 |
| `torch_pad_bmm` | open | procs | 16 | 364 | 364 | 2.441 | 20.280 |
| `torch_pad_bmm` | open | procs | 16 | 728 | 728 | 2.444 | 30.103 |
| `torch_pad_bmm` | open | procs | 16 | 1093 | 1091 | 2.564 | 65.916 |
| `torch_pad_bmm@4` | closed | threads | 1 |  | 3178 | 0.294 | 1.345 |
| `torch_pad_bmm@4` | closed | threads | 4 |  | 3875 | 0.888 | 4.059 |
| `torch_pad_bmm@4` | closed | threads | 16 |  | 4222 | 2.714 | 15.894 |
| `torch_pad_bmm@4` | closed | procs | 1 |  | 2987 | 0.299 | 1.353 |
| `torch_pad_bmm@4` | closed | procs | 4 |  | 860 | 0.466 | 20.319 |
| `torch_pad_bmm@4` | closed | procs | 16 |  | 233 | 67.463 | 117.976 |
| `torch_pad_bmm@4` | open | threads | 16 | 364 | 362 | 518.643 | 655.185 |
| `torch_pad_bmm@4` | open | threads | 16 | 728 | 668 | 1455.529 | 2684.426 |
| `torch_pad_bmm@4` | open | threads | 16 | 1093 | 932 | 1373.832 | 2340.071 |
| `torch_pad_bmm@4` | open | procs | 16 | 364 | 238 | 2608.298 | 5615.922 |
| `torch_pad_bmm@4` | open | procs | 16 | 728 | 244 | 5339.289 | 10704.069 |
| `torch_pad_bmm@4` | open | procs | 16 | 1093 | 241 | 6388.323 | 12793.990 |

## EPYC — gcsn-ho

| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |
|---|---|---|--:|--:|--:|--:|--:|
| `ours` | closed | threads | 1 |  | 17205 | 0.052 | 0.143 |
| `ours` | closed | threads | 4 |  | 13832 | 0.085 | 4.319 |
| `ours` | closed | threads | 16 |  | 6664 | 0.292 | 17.837 |
| `ours` | closed | procs | 1 |  | 15431 | 0.053 | 0.195 |
| `ours` | closed | procs | 4 |  | 18248 | 0.187 | 0.611 |
| `ours` | closed | procs | 16 |  | 13554 | 0.335 | 8.351 |
| `ours` | open | threads | 16 | 930 | 941 | 8.106 | 34.595 |
| `ours` | open | threads | 16 | 1860 | 1878 | 11.532 | 47.354 |
| `ours` | open | threads | 16 | 2790 | 2816 | 16.216 | 51.642 |
| `ours` | open | procs | 16 | 930 | 940 | 0.657 | 6.361 |
| `ours` | open | procs | 16 | 1860 | 1879 | 0.805 | 6.412 |
| `ours` | open | procs | 16 | 2790 | 2821 | 0.762 | 6.540 |
| `maxsim_cpu_variable` | closed | threads | 1 |  | 6427 | 0.147 | 0.358 |
| `maxsim_cpu_variable` | closed | threads | 4 |  | 8603 | 0.418 | 1.348 |
| `maxsim_cpu_variable` | closed | threads | 16 |  | 8868 | 0.736 | 17.843 |
| `maxsim_cpu_variable` | closed | procs | 1 |  | 5271 | 0.155 | 0.991 |
| `maxsim_cpu_variable` | closed | procs | 4 |  | 7954 | 0.385 | 1.879 |
| `maxsim_cpu_variable` | closed | procs | 16 |  | 5727 | 1.689 | 6.540 |
| `maxsim_cpu_variable` | open | threads | 16 | 930 | 941 | 11.164 | 25.797 |
| `maxsim_cpu_variable` | open | threads | 16 | 1860 | 1822 | 131.742 | 306.738 |
| `maxsim_cpu_variable` | open | threads | 16 | 2790 | 2474 | 392.061 | 671.883 |
| `maxsim_cpu_variable` | open | procs | 16 | 930 | 938 | 4.230 | 17.430 |
| `maxsim_cpu_variable` | open | procs | 16 | 1860 | 1875 | 4.403 | 21.285 |
| `maxsim_cpu_variable` | open | procs | 16 | 2790 | 2799 | 4.671 | 41.035 |
| `nextplaid` | closed | threads | 1 |  | 2980 | 0.196 | 3.024 |
| `nextplaid` | closed | threads | 4 |  | 3451 | 0.675 | 10.009 |
| `nextplaid` | closed | threads | 16 |  | 3319 | 1.993 | 44.275 |
| `nextplaid` | closed | procs | 1 |  | 2593 | 0.215 | 4.805 |
| `nextplaid` | closed | procs | 4 |  | 371 | 0.432 | 139.081 |
| `nextplaid` | closed | procs | 16 |  | 208 | 10.959 | 713.981 |
| `nextplaid` | open | threads | 16 | 930 | 910 | 292.792 | 495.108 |
| `nextplaid` | open | threads | 16 | 1860 | 1325 | 1112.280 | 1387.386 |
| `nextplaid` | open | threads | 16 | 2790 | 1537 | 1252.253 | 1427.348 |
| `nextplaid` | open | procs | 16 | 930 | 203 | 8501.265 | 18720.433 |
| `nextplaid` | open | procs | 16 | 1860 | 201 | 9723.191 | 21210.807 |
| `nextplaid` | open | procs | 16 | 2790 | 201 | 10986.325 | 22000.527 |
| `nextplaid@4` | closed | threads | 1 |  | 3166 | 0.197 | 2.067 |
| `nextplaid@4` | closed | threads | 4 |  | 3812 | 0.606 | 9.339 |
| `nextplaid@4` | closed | threads | 16 |  | 3494 | 1.778 | 52.964 |
| `nextplaid@4` | closed | procs | 1 |  | 3394 | 0.237 | 1.002 |
| `nextplaid@4` | closed | procs | 4 |  | 327 | 0.503 | 139.898 |
| `nextplaid@4` | closed | procs | 16 |  | 159 | 42.013 | 727.019 |
| `nextplaid@4` | open | threads | 16 | 930 | 910 | 154.575 | 426.624 |
| `nextplaid@4` | open | threads | 16 | 1860 | 1350 | 1094.062 | 1339.665 |
| `nextplaid@4` | open | threads | 16 | 2790 | 1572 | 1261.005 | 1355.863 |
| `nextplaid@4` | open | procs | 16 | 930 | 160 | 12241.183 | 24729.495 |
| `nextplaid@4` | open | procs | 16 | 1860 | 160 | 13232.541 | 27300.650 |
| `nextplaid@4` | open | procs | 16 | 2790 | 161 | 13532.807 | 27878.609 |
| `numkong_native_f16` | closed | threads | 1 |  | 17005 | 0.053 | 0.157 |
| `numkong_native_f16` | closed | threads | 4 |  | 21913 | 0.163 | 0.502 |
| `numkong_native_f16` | closed | threads | 16 |  | 24138 | 0.304 | 5.185 |
| `numkong_native_f16` | closed | procs | 1 |  | 14179 | 0.057 | 0.208 |
| `numkong_native_f16` | closed | procs | 4 |  | 18306 | 0.159 | 0.727 |
| `numkong_native_f16` | closed | procs | 16 |  | 18896 | 0.233 | 6.402 |
| `numkong_native_f16` | open | threads | 16 | 930 | 941 | 9.365 | 24.204 |
| `numkong_native_f16` | open | threads | 16 | 1860 | 1880 | 13.200 | 35.037 |
| `numkong_native_f16` | open | threads | 16 | 2790 | 2718 | 186.671 | 388.581 |
| `numkong_native_f16` | open | procs | 16 | 930 | 941 | 0.530 | 6.221 |
| `numkong_native_f16` | open | procs | 16 | 1860 | 1880 | 0.513 | 7.183 |
| `numkong_native_f16` | open | procs | 16 | 2790 | 2819 | 0.569 | 6.716 |
| `numpy_packed` | closed | threads | 1 |  | 8507 | 0.091 | 0.259 |
| `numpy_packed` | closed | threads | 4 |  | 8646 | 0.094 | 9.023 |
| `numpy_packed` | closed | threads | 16 |  | 7788 | 0.097 | 41.873 |
| `numpy_packed` | closed | procs | 1 |  | 6969 | 0.132 | 0.364 |
| `numpy_packed` | closed | procs | 4 |  | 12383 | 0.271 | 0.922 |
| `numpy_packed` | closed | procs | 16 |  | 10505 | 0.433 | 9.359 |
| `numpy_packed` | open | threads | 16 | 930 | 912 | 555.011 | 1248.761 |
| `numpy_packed` | open | threads | 16 | 1860 | 1691 | 530.473 | 1299.239 |
| `numpy_packed` | open | threads | 16 | 2790 | 2649 | 306.155 | 456.378 |
| `numpy_packed` | open | procs | 16 | 930 | 941 | 0.888 | 6.362 |
| `numpy_packed` | open | procs | 16 | 1860 | 1880 | 0.961 | 6.940 |
| `numpy_packed` | open | procs | 16 | 2790 | 2815 | 0.847 | 7.264 |
| `torch_pad_bmm` | closed | threads | 1 |  | 4447 | 0.218 | 0.469 |
| `torch_pad_bmm` | closed | threads | 4 |  | 5635 | 0.674 | 1.551 |
| `torch_pad_bmm` | closed | threads | 16 |  | 6288 | 2.280 | 6.122 |
| `torch_pad_bmm` | closed | procs | 1 |  | 2196 | 0.205 | 11.993 |
| `torch_pad_bmm` | closed | procs | 4 |  | 6718 | 0.542 | 1.513 |
| `torch_pad_bmm` | closed | procs | 16 |  | 5448 | 1.100 | 9.301 |
| `torch_pad_bmm` | open | threads | 16 | 930 | 861 | 1617.013 | 2954.399 |
| `torch_pad_bmm` | open | threads | 16 | 1860 | 1514 | 1261.289 | 2017.112 |
| `torch_pad_bmm` | open | threads | 16 | 2790 | 2017 | 1029.835 | 1452.378 |
| `torch_pad_bmm` | open | procs | 16 | 930 | 940 | 2.206 | 10.678 |
| `torch_pad_bmm` | open | procs | 16 | 1860 | 1880 | 2.183 | 9.301 |
| `torch_pad_bmm` | open | procs | 16 | 2790 | 2815 | 2.501 | 13.025 |
| `torch_pad_bmm@4` | closed | threads | 1 |  | 4873 | 0.203 | 0.372 |
| `torch_pad_bmm@4` | closed | threads | 4 |  | 5722 | 0.669 | 1.357 |
| `torch_pad_bmm@4` | closed | threads | 16 |  | 6297 | 2.359 | 5.916 |
| `torch_pad_bmm@4` | closed | procs | 1 |  | 4704 | 0.200 | 0.615 |
| `torch_pad_bmm@4` | closed | procs | 4 |  | 765 | 0.360 | 25.002 |
| `torch_pad_bmm@4` | closed | procs | 16 |  | 218 | 69.041 | 121.584 |
| `torch_pad_bmm@4` | open | threads | 16 | 930 | 862 | 1638.545 | 2953.798 |
| `torch_pad_bmm@4` | open | threads | 16 | 1860 | 1519 | 1243.747 | 1999.612 |
| `torch_pad_bmm@4` | open | threads | 16 | 2790 | 2037 | 1007.384 | 1429.593 |
| `torch_pad_bmm@4` | open | procs | 16 | 930 | 233 | 7709.853 | 15062.400 |
| `torch_pad_bmm@4` | open | procs | 16 | 1860 | 232 | 9227.785 | 17697.814 |
| `torch_pad_bmm@4` | open | procs | 16 | 2790 | 231 | 9553.975 | 18611.108 |

