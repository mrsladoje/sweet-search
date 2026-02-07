#!/bin/bash

# =============================================================================
# RESOURCE-CONSTRAINED BENCHMARK RUNNER
# =============================================================================
#
# Runs benchmarks under various resource constraints to simulate lower-end
# hardware and identify performance bottlenecks.
#
# Usage:
#   ./benchmark-constrained.sh                    # Show help
#   ./benchmark-constrained.sh budget             # 4 cores, 8GB RAM
#   ./benchmark-constrained.sh midrange           # 8 cores, 16GB RAM
#   ./benchmark-constrained.sh memory-limited     # 4GB RAM limit
#   ./benchmark-constrained.sh cpu-limited        # 2 cores at 50%
#   ./benchmark-constrained.sh custom 4 8192     # Custom: 4 cores, 8GB
#
# Requirements:
#   - Linux with cgroups v1 or v2
#   - sudo access for cgroup operations
#   - Node.js 18+
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RESULTS_DIR="$PROJECT_ROOT/.claude/benchmarks/results"
INDEXER="$SCRIPT_DIR/index-codebase-v21.js"
HARNESS="$SCRIPT_DIR/benchmark-harness.js"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

log() {
  echo -e "${CYAN}[benchmark]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[benchmark]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[benchmark]${NC} $1"
}

log_error() {
  echo -e "${RED}[benchmark]${NC} $1"
}

check_cgroups() {
  if [ -d /sys/fs/cgroup/cpu ]; then
    CGROUP_VERSION="v1"
    return 0
  elif [ -f /sys/fs/cgroup/cgroup.controllers ]; then
    CGROUP_VERSION="v2"
    return 0
  else
    log_error "cgroups not available on this system"
    return 1
  fi
}

check_sudo() {
  if ! sudo -n true 2>/dev/null; then
    log_warn "sudo required for cgroup operations"
    log "Please enter password:"
    sudo true
  fi
}

# =============================================================================
# CGROUP MANAGEMENT (V1)
# =============================================================================

create_cgroup_v1() {
  local name=$1
  local cores=$2
  local memory_mb=$3

  log "Creating cgroup v1: $name (cores=$cores, memory=${memory_mb}MB)"

  # Create cgroups
  sudo cgcreate -g cpu,memory:$name 2>/dev/null || true

  # Set CPU quota (100000 = 100% of one core)
  local period=100000
  local quota=$((period * cores))
  echo $period | sudo tee /sys/fs/cgroup/cpu/$name/cpu.cfs_period_us > /dev/null
  echo $quota | sudo tee /sys/fs/cgroup/cpu/$name/cpu.cfs_quota_us > /dev/null

  # Set memory limit
  local memory_bytes=$((memory_mb * 1024 * 1024))
  echo $memory_bytes | sudo tee /sys/fs/cgroup/memory/$name/memory.limit_in_bytes > /dev/null

  log_success "cgroup $name created"
}

run_in_cgroup_v1() {
  local name=$1
  shift
  sudo cgexec -g cpu,memory:$name "$@"
}

cleanup_cgroup_v1() {
  local name=$1
  sudo cgdelete cpu,memory:$name 2>/dev/null || true
}

# =============================================================================
# CGROUP MANAGEMENT (V2)
# =============================================================================

create_cgroup_v2() {
  local name=$1
  local cores=$2
  local memory_mb=$3

  log "Creating cgroup v2: $name (cores=$cores, memory=${memory_mb}MB)"

  # Create cgroup
  local cgroup_path="/sys/fs/cgroup/$name"
  sudo mkdir -p "$cgroup_path"

  # Enable controllers
  echo "+cpu +memory" | sudo tee /sys/fs/cgroup/cgroup.subtree_control > /dev/null 2>&1 || true

  # Set CPU quota (100000 = 100% of one core per period)
  local period=100000
  local quota=$((period * cores))
  echo "$quota $period" | sudo tee "$cgroup_path/cpu.max" > /dev/null

  # Set memory limit
  local memory_bytes=$((memory_mb * 1024 * 1024))
  echo $memory_bytes | sudo tee "$cgroup_path/memory.max" > /dev/null

  log_success "cgroup $name created"
}

run_in_cgroup_v2() {
  local name=$1
  shift

  # Add current process to cgroup
  echo $$ | sudo tee "/sys/fs/cgroup/$name/cgroup.procs" > /dev/null
  "$@"
}

cleanup_cgroup_v2() {
  local name=$1
  sudo rmdir "/sys/fs/cgroup/$name" 2>/dev/null || true
}

# =============================================================================
# UNIFIED CGROUP INTERFACE
# =============================================================================

create_cgroup() {
  if [ "$CGROUP_VERSION" = "v1" ]; then
    create_cgroup_v1 "$@"
  else
    create_cgroup_v2 "$@"
  fi
}

run_in_cgroup() {
  if [ "$CGROUP_VERSION" = "v1" ]; then
    run_in_cgroup_v1 "$@"
  else
    run_in_cgroup_v2 "$@"
  fi
}

cleanup_cgroup() {
  if [ "$CGROUP_VERSION" = "v1" ]; then
    cleanup_cgroup_v1 "$@"
  else
    cleanup_cgroup_v2 "$@"
  fi
}

# =============================================================================
# BENCHMARK PROFILES
# =============================================================================

profile_budget() {
  # "Budget Laptop" - 4 cores, 8GB RAM
  log "Profile: BUDGET LAPTOP"
  log "  CPU: 4 cores"
  log "  Memory: 8GB"
  CORES=4
  MEMORY_MB=8192
}

profile_midrange() {
  # "Midrange Desktop" - 8 cores, 16GB RAM
  log "Profile: MIDRANGE DESKTOP"
  log "  CPU: 8 cores"
  log "  Memory: 16GB"
  CORES=8
  MEMORY_MB=16384
}

profile_memory_limited() {
  # Memory-constrained - all cores, 4GB RAM
  log "Profile: MEMORY LIMITED"
  log "  CPU: all cores"
  log "  Memory: 4GB"
  CORES=$(nproc)
  MEMORY_MB=4096
}

profile_cpu_limited() {
  # CPU-constrained - 2 cores at 50%, unlimited RAM
  log "Profile: CPU LIMITED"
  log "  CPU: 2 cores"
  log "  Memory: unlimited"
  CORES=2
  MEMORY_MB=32768
}

profile_custom() {
  # Custom profile
  CORES=${1:-4}
  MEMORY_MB=${2:-8192}
  log "Profile: CUSTOM"
  log "  CPU: $CORES cores"
  log "  Memory: ${MEMORY_MB}MB"
}

# =============================================================================
# BENCHMARK RUNNERS
# =============================================================================

run_constrained_benchmark() {
  local profile=$1
  local cgroup_name="benchmark_$$"
  local result_file="$RESULTS_DIR/constrained-${profile}-$(date +%s).json"

  check_cgroups
  check_sudo

  mkdir -p "$RESULTS_DIR"

  # Apply profile
  case $profile in
    budget)
      profile_budget
      ;;
    midrange)
      profile_midrange
      ;;
    memory-limited)
      profile_memory_limited
      ;;
    cpu-limited)
      profile_cpu_limited
      ;;
    custom)
      profile_custom "$2" "$3"
      ;;
    *)
      log_error "Unknown profile: $profile"
      exit 1
      ;;
  esac

  # Create cgroup
  create_cgroup "$cgroup_name" "$CORES" "$MEMORY_MB"

  log ""
  log "Starting constrained benchmark..."
  log "Results will be saved to: $result_file"
  log ""

  # Run benchmark in cgroup
  local start_time=$(date +%s)

  run_in_cgroup "$cgroup_name" node --max-old-space-size=$MEMORY_MB "$HARNESS" \
    --full-index --search 2>&1 | tee "$RESULTS_DIR/constrained-${profile}.log"

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  # Cleanup
  cleanup_cgroup "$cgroup_name"

  log ""
  log_success "Benchmark completed in ${duration}s"
  log_success "Results: $result_file"
}

# =============================================================================
# QUICK TESTS (without full benchmark harness)
# =============================================================================

quick_index_test() {
  local cores=${1:-4}
  local memory_mb=${2:-8192}
  local cgroup_name="quick_test_$$"

  check_cgroups
  check_sudo

  log "Quick Index Test (cores=$cores, memory=${memory_mb}MB)"

  create_cgroup "$cgroup_name" "$cores" "$memory_mb"

  # Clean artifacts
  rm -f "$PROJECT_ROOT/.agentdb/"*.db "$PROJECT_ROOT/.agentdb/"*.json 2>/dev/null || true

  # Run full index with timing
  local start_time=$(date +%s%N)

  run_in_cgroup "$cgroup_name" node --max-old-space-size=$memory_mb "$INDEXER" --full --quiet

  local end_time=$(date +%s%N)
  local duration_ms=$(( (end_time - start_time) / 1000000 ))

  cleanup_cgroup "$cgroup_name"

  log_success "Full index completed in ${duration_ms}ms ($(( duration_ms / 1000 ))s)"
}

quick_search_test() {
  local cores=${1:-4}
  local memory_mb=${2:-8192}
  local iterations=${3:-50}
  local cgroup_name="quick_search_$$"

  check_cgroups
  check_sudo

  log "Quick Search Test (cores=$cores, memory=${memory_mb}MB, iterations=$iterations)"

  if [ ! -f "$PROJECT_ROOT/.agentdb/codebase.db" ]; then
    log_warn "No index found, running full index first..."
    quick_index_test "$cores" "$memory_mb"
  fi

  create_cgroup "$cgroup_name" "$cores" "$memory_mb"

  local latencies=()
  local queries=("AuthService" "how does auth work" "employee monitoring" "what calls AuthService")

  for i in $(seq 1 $iterations); do
    local query="${queries[$((i % 4))]}"
    local start_time=$(date +%s%N)

    run_in_cgroup "$cgroup_name" "$SCRIPT_DIR/ss" "$query" --quiet --top 10 > /dev/null 2>&1

    local end_time=$(date +%s%N)
    local duration_ms=$(( (end_time - start_time) / 1000000 ))
    latencies+=($duration_ms)

    if [ $((i % 10)) -eq 0 ]; then
      log "Progress: $i/$iterations"
    fi
  done

  cleanup_cgroup "$cgroup_name"

  # Calculate p50, p95
  local sorted=($(printf '%s\n' "${latencies[@]}" | sort -n))
  local n=${#sorted[@]}
  local p50=${sorted[$((n / 2))]}
  local p95=${sorted[$((n * 95 / 100))]}
  local sum=0
  for l in "${latencies[@]}"; do
    sum=$((sum + l))
  done
  local avg=$((sum / n))

  log_success "Search latency results:"
  log "  p50: ${p50}ms"
  log "  p95: ${p95}ms"
  log "  avg: ${avg}ms"
}

# =============================================================================
# HELP
# =============================================================================

show_help() {
  cat << EOF
Resource-Constrained Benchmark Runner

Usage:
  $0 <profile> [options]

Profiles:
  budget           4 cores, 8GB RAM (budget laptop)
  midrange         8 cores, 16GB RAM (midrange desktop)
  memory-limited   All cores, 4GB RAM (memory stress test)
  cpu-limited      2 cores, unlimited RAM (CPU stress test)
  custom <c> <m>   Custom: <c> cores, <m> MB RAM

Quick Tests (faster, less comprehensive):
  quick-index [cores] [memory_mb]      Run single full index
  quick-search [cores] [memory_mb] [n] Run n search queries

Examples:
  $0 budget                    # Full benchmark with budget profile
  $0 custom 4 4096             # Custom: 4 cores, 4GB RAM
  $0 quick-index 2 4096        # Quick index test: 2 cores, 4GB
  $0 quick-search 4 8192 100   # 100 search queries: 4 cores, 8GB

Requirements:
  - Linux with cgroups
  - sudo access
  - Node.js 18+

Note: Results are saved to .claude/benchmarks/results/
EOF
}

# =============================================================================
# MAIN
# =============================================================================

main() {
  case "${1:-}" in
    budget|midrange|memory-limited|cpu-limited)
      run_constrained_benchmark "$1"
      ;;
    custom)
      if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
        log_error "Usage: $0 custom <cores> <memory_mb>"
        exit 1
      fi
      run_constrained_benchmark custom "$2" "$3"
      ;;
    quick-index)
      quick_index_test "${2:-4}" "${3:-8192}"
      ;;
    quick-search)
      quick_search_test "${2:-4}" "${3:-8192}" "${4:-50}"
      ;;
    -h|--help|help|"")
      show_help
      ;;
    *)
      log_error "Unknown command: $1"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
