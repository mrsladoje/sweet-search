# Contract effects (float64 reference vs float64 reference; held-out sets)

| set group | effect | calls (pool ≥ 2) | max abs score difference | top-1 agreement | mean top-10 overlap |
|---|---|--:|--:|--:|--:|
| agent-ho | epsilon placement (S vs S-pre, no clamp) | 1982 | 4.4e-16 | 100.00% | 100.00% |
| agent-ho | clamp (S with vs without max(0, .)) | 1982 | 5.4e-02 | 99.90% | 99.95% |
| agent-ho | S vs C (NumKong contract) | 1982 | 5.5e-02 | 97.58% | 99.21% |
| agent-ho | PyLate zero padding (S-pre-pad0 vs S-pre) | 1982 | 4.1e-02 | 99.90% | 99.95% |
| agent-ho | f32 pre-scaling of rival inputs | 1982 | 4.1e-08 | 100.00% | 100.00% |
| agent-ho | bf16 cast of rival inputs | 1982 | 9.0e-04 | 99.85% | 99.92% |
| agent-ho | f16 cast of rival inputs | 1982 | 9.5e-05 | 99.95% | 99.99% |
| gcsn-ho | epsilon placement (S vs S-pre, no clamp) | 2378 | 4.4e-16 | 100.00% | 100.00% |
| gcsn-ho | clamp (S with vs without max(0, .)) | 2378 | 3.4e-02 | 99.96% | 99.95% |
| gcsn-ho | S vs C (NumKong contract) | 2378 | 3.4e-02 | 98.82% | 98.99% |
| gcsn-ho | PyLate zero padding (S-pre-pad0 vs S-pre) | 2378 | 3.4e-02 | 99.96% | 99.95% |
| gcsn-ho | f32 pre-scaling of rival inputs | 2378 | 3.8e-08 | 100.00% | 100.00% |
| gcsn-ho | bf16 cast of rival inputs | 2378 | 9.4e-04 | 99.92% | 99.92% |
| gcsn-ho | f16 cast of rival inputs | 2378 | 1.2e-04 | 99.96% | 99.99% |
| beir (20 sets) | epsilon placement (S vs S-pre, no clamp) | 6230 | 4.4e-16 | 100.00% | 100.00% |
| beir (20 sets) | clamp (S with vs without max(0, .)) | 6230 | 7.6e-02 | 100.00% | 100.00% |
| beir (20 sets) | S vs C (NumKong contract) | 6230 | 7.5e-02 | 78.51% | 84.58% |
| beir (20 sets) | PyLate zero padding (S-pre-pad0 vs S-pre) | 6230 | 7.6e-02 | 100.00% | 100.00% |
| beir (20 sets) | f32 pre-scaling of rival inputs | 6230 | 9.2e-08 | 100.00% | 100.00% |
| beir (20 sets) | bf16 cast of rival inputs | 6230 | 1.6e-03 | 98.59% | 98.78% |
| beir (20 sets) | f16 cast of rival inputs | 6230 | 2.2e-04 | 99.65% | 99.82% |
