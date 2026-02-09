#!/usr/bin/env node

/**
 * Reranking Latency Benchmark
 *
 * Measures FlashRank latency in isolation.
 * Used to establish baseline before CROSS-JEM optimization.
 *
 * Usage:
 *   node benchmark-rerank.js                    # Run full benchmark
 *   node benchmark-rerank.js --baseline         # Save baseline results
 *   node benchmark-rerank.js --compare baseline # Compare to baseline
 *   node benchmark-rerank.js --iterations=50   # Custom iteration count
 */

import { FlashRankReranker } from '../core/flashrank.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// BENCHMARK DOCUMENTS
// =============================================================================

// Realistic sample documents from the Sloth codebase
const BENCHMARK_DOCS = [
  { text: 'public class AuthService { public AuthResponseDTO authenticate(AuthRequestDTO request) { /* authentication logic with JWT token generation, password validation, and session management */ } }', name: 'AuthService' },
  { text: 'public class EmployeeService { public List<EmployeeResponseDTO> getAllActiveEmployees() { return employeeRepository.findByIsActiveTrue().stream().map(employeeMapper::toResponseDTO).collect(Collectors.toList()); } }', name: 'EmployeeService' },
  { text: 'public class RealizationController { @PostMapping public ResponseEntity<RealizationResponseDTO> createRealization(@RequestBody @Valid RealizationDTO dto) { return ResponseEntity.ok(realizationService.create(dto)); } }', name: 'RealizationController' },
  { text: 'public interface DetectionHeuristic { double calculateScore(BiologEvent event); boolean shouldTrigger(double score); String getHeuristicName(); }', name: 'DetectionHeuristic' },
  { text: 'public class JwtTokenProvider { public String generateToken(UserDetails userDetails) { return Jwts.builder().setSubject(userDetails.getUsername()).signWith(key).compact(); } }', name: 'JwtTokenProvider' },
  { text: 'export function useAuth() { const [user, setUser] = useState(null); const login = async (credentials) => { const response = await authApi.login(credentials); setUser(response.data); }; return { user, login, logout }; }', name: 'useAuth' },
  { text: 'public class ProjectService { public ProjectResponseDTO createProject(ProjectDTO dto) { Project project = projectMapper.toEntity(dto); project = projectRepository.save(project); return projectMapper.toResponseDTO(project); } }', name: 'ProjectService' },
  { text: 'public class AbsenceController { @GetMapping("/{id}") public ResponseEntity<AbsenceResponseDTO> getAbsenceById(@PathVariable Long id) { return ResponseEntity.ok(absenceService.getById(id)); } }', name: 'AbsenceController' },
  { text: 'public class ClientRepository extends JpaRepository<Client, Long> { List<Client> findByIsActiveTrue(); Optional<Client> findByNameIgnoreCase(String name); }', name: 'ClientRepository' },
  { text: 'export const TimePicker = ({ value, onChange, label }) => { const [hours, setHours] = useState(0); const [minutes, setMinutes] = useState(0); return <div className="time-picker">...</div>; };', name: 'TimePicker' },
  { text: 'public class SessionService { public SessionResponseDTO startSession(Long employeeId) { Session session = new Session(); session.setEmployee(employeeRepository.findById(employeeId).orElseThrow()); session.setStartTime(Instant.now()); return sessionMapper.toResponseDTO(sessionRepository.save(session)); } }', name: 'SessionService' },
  { text: 'public class NotificationService { public void sendNotification(NotificationDTO dto) { Notification notification = notificationMapper.toEntity(dto); notificationRepository.save(notification); emailService.sendEmail(dto.getRecipient(), dto.getSubject(), dto.getBody()); } }', name: 'NotificationService' },
  { text: 'public class BotDetectionService { private final List<DetectionHeuristic> heuristics; public BotDetectionResult analyze(BiologEvent event) { return heuristics.stream().map(h -> h.calculateScore(event)).reduce(0.0, Double::sum); } }', name: 'BotDetectionService' },
  { text: 'export function formatDate(date, format = "DD.MM.YYYY") { return format(new Date(date), format); }', name: 'formatDate' },
  { text: 'public class TeamController { @GetMapping public ResponseEntity<List<TeamResponseDTO>> getAllTeams() { return ResponseEntity.ok(teamService.getAllActive()); } }', name: 'TeamController' },
  { text: 'public class ConfigHandler { private Properties config; public String get(String key) { return config.getProperty(key); } public void set(String key, String value) { config.setProperty(key, value); save(); } }', name: 'ConfigHandler' },
  { text: 'public class EventService { public void sendEvent(BiologEvent event) { event.setTimestamp(Instant.now()); eventQueue.add(event); if (eventQueue.size() >= BATCH_SIZE) { flush(); } } }', name: 'EventService' },
  { text: 'export const DataTable = ({ columns, data, onRowClick }) => { return <table className="data-table">{data.map(row => <tr key={row.id} onClick={() => onRowClick(row)}>{columns.map(col => <td>{row[col.accessor]}</td>)}</tr>)}</table>; };', name: 'DataTable' },
  { text: 'public class DocumentService { public DocumentResponseDTO uploadDocument(MultipartFile file, Long entityId) { String path = fileStorageService.store(file); Document doc = new Document(file.getOriginalFilename(), path, entityId); return documentMapper.toResponseDTO(documentRepository.save(doc)); } }', name: 'DocumentService' },
  { text: 'public class TrajectoryHashStore { private final RingBuffer<MovementVector> buffer; public void add(MovementVector vector) { buffer.add(vector); updateHash(); } }', name: 'TrajectoryHashStore' },
  { text: 'public class LoginController { @PostMapping("/login") public ResponseEntity<AuthResponseDTO> login(@RequestBody @Valid LoginDTO dto) { return ResponseEntity.ok(authService.authenticate(dto)); } }', name: 'LoginController' },
  { text: 'export function useEmployees(filters) { return useQuery(["employees", filters], () => employeeApi.getAll(filters), { staleTime: 5 * 60 * 1000 }); }', name: 'useEmployees' },
  { text: 'public class PermissionEvaluator { public boolean hasPermission(Authentication auth, Object target, String permission) { User user = (User) auth.getPrincipal(); return user.getPermissions().contains(permission); } }', name: 'PermissionEvaluator' },
  { text: 'public class NeuromotorAnalyzer { public double calculatePowerLawCompliance(List<MovementVector> vectors) { if (vectors.size() < MIN_SAMPLES) return -1.0; return fitPowerLaw(vectors).rSquared; } }', name: 'NeuromotorAnalyzer' },
  { text: 'export const Modal = ({ isOpen, onClose, title, children }) => { if (!isOpen) return null; return createPortal(<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}>{children}</div></div>, document.body); };', name: 'Modal' },
  { text: 'public class GrpcEventService { @Override public void streamEvents(StreamObserver<EventResponse> responseObserver) { while (running) { Event event = eventQueue.take(); responseObserver.onNext(toProto(event)); } } }', name: 'GrpcEventService' },
  { text: 'public class RingBuffer<T> { private final Object[] buffer; private int head = 0; private int tail = 0; public void add(T item) { buffer[tail] = item; tail = (tail + 1) % buffer.length; } }', name: 'RingBuffer' },
  { text: 'export function validateForm(values, schema) { try { schema.validateSync(values, { abortEarly: false }); return {}; } catch (err) { return err.inner.reduce((acc, e) => ({ ...acc, [e.path]: e.message }), {}); } }', name: 'validateForm' },
  { text: 'public class ScreenshotService { public byte[] captureScreen() { Robot robot = new Robot(); Rectangle screenRect = new Rectangle(Toolkit.getDefaultToolkit().getScreenSize()); BufferedImage capture = robot.createScreenCapture(screenRect); return toBytes(capture); } }', name: 'ScreenshotService' },
  { text: 'public class PowerLawVetoRule implements VetoRule { private final double threshold; @Override public boolean shouldVeto(BotDetectionResult result) { return result.getPowerLawScore() < threshold; } }', name: 'PowerLawVetoRule' },
  { text: 'export const Sidebar = ({ items, activeItem, onItemClick }) => { return <nav className="sidebar">{items.map(item => <SidebarItem key={item.id} item={item} isActive={item.id === activeItem} onClick={() => onItemClick(item)} />)}</nav>; };', name: 'Sidebar' },
  { text: 'public class AbsenceService { public AbsenceResponseDTO requestAbsence(AbsenceDTO dto) { validateDateRange(dto); Absence absence = absenceMapper.toEntity(dto); absence.setStatus(AbsenceStatus.PENDING); return absenceMapper.toResponseDTO(absenceRepository.save(absence)); } }', name: 'AbsenceService' },
  { text: 'public class ProcessLogger { private final Map<Long, ProcessInfo> activeProcesses = new ConcurrentHashMap<>(); public void logProcessStart(ProcessInfo info) { activeProcesses.put(info.getPid(), info); eventService.sendProcessEvent(info, EventType.PROCESS_START); } }', name: 'ProcessLogger' },
  { text: 'export function debounce(fn, delay) { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => fn(...args), delay); }; }', name: 'debounce' },
  { text: 'public class EquipmentController { @PostMapping("/assign") public ResponseEntity<Void> assignEquipment(@RequestBody EquipmentAssignmentDTO dto) { equipmentService.assign(dto); return ResponseEntity.noContent().build(); } }', name: 'EquipmentController' },
  { text: 'public class EmailService { public void sendEmail(String to, String subject, String body) { MimeMessage message = mailSender.createMimeMessage(); MimeMessageHelper helper = new MimeMessageHelper(message); helper.setTo(to); helper.setSubject(subject); helper.setText(body, true); mailSender.send(message); } }', name: 'EmailService' },
  { text: 'export const DateRangePicker = ({ startDate, endDate, onChange }) => { const [range, setRange] = useState({ start: startDate, end: endDate }); return <div className="date-range-picker"><DatePicker value={range.start} onChange={d => setRange(r => ({ ...r, start: d }))} /></div>; };', name: 'DateRangePicker' },
  { text: 'public class ReportGenerator { public byte[] generatePdfReport(ReportConfig config) { Document document = new Document(); PdfWriter.getInstance(document, outputStream); document.open(); addContent(document, config); document.close(); return outputStream.toByteArray(); } }', name: 'ReportGenerator' },
  { text: 'public class KeyboardLogger { private final NativeKeyListener listener; public void start() { GlobalScreen.addNativeKeyListener(listener); } public void stop() { GlobalScreen.removeNativeKeyListener(listener); } }', name: 'KeyboardLogger' },
  { text: 'export function useDebounce(value, delay) { const [debouncedValue, setDebouncedValue] = useState(value); useEffect(() => { const handler = setTimeout(() => setDebouncedValue(value), delay); return () => clearTimeout(handler); }, [value, delay]); return debouncedValue; }', name: 'useDebounce' },
  { text: 'public class StatisticsService { public DashboardStatsDTO getDashboardStats(Long companyId) { return DashboardStatsDTO.builder().totalEmployees(employeeRepository.countByCompanyId(companyId)).activeProjects(projectRepository.countActiveByCompanyId(companyId)).build(); } }', name: 'StatisticsService' },
  { text: 'public class VelocityProfileHeuristic implements DetectionHeuristic { @Override public double calculateScore(BiologEvent event) { List<Double> velocities = event.getVelocities(); return calculateVariance(velocities) / calculateMean(velocities); } }', name: 'VelocityProfileHeuristic' },
  { text: 'export const Tooltip = ({ children, content, position = "top" }) => { const [visible, setVisible] = useState(false); return <div onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>{children}{visible && <div className={`tooltip tooltip-${position}`}>{content}</div>}</div>; };', name: 'Tooltip' },
  { text: 'public class FileStorageService { private final Path storageLocation; public String store(MultipartFile file) { String filename = UUID.randomUUID() + "_" + file.getOriginalFilename(); Files.copy(file.getInputStream(), storageLocation.resolve(filename)); return filename; } }', name: 'FileStorageService' },
  { text: 'public class MouseTracker { private final List<MouseMovement> movements = new ArrayList<>(); public void trackMovement(int x, int y, long timestamp) { movements.add(new MouseMovement(x, y, timestamp)); if (movements.size() >= BUFFER_SIZE) { flush(); } } }', name: 'MouseTracker' },
  { text: 'export function groupBy(array, key) { return array.reduce((result, item) => { const group = item[key]; if (!result[group]) result[group] = []; result[group].push(item); return result; }, {}); }', name: 'groupBy' },
  { text: 'public class SecurityConfig extends WebSecurityConfigurerAdapter { @Override protected void configure(HttpSecurity http) { http.csrf().disable().authorizeRequests().antMatchers("/api/auth/**").permitAll().anyRequest().authenticated(); } }', name: 'SecurityConfig' },
  { text: 'public class WorkTimeCalculator { public Duration calculateWorkedTime(List<Session> sessions) { return sessions.stream().filter(s -> s.getEndTime() != null).map(s -> Duration.between(s.getStartTime(), s.getEndTime())).reduce(Duration.ZERO, Duration::plus); } }', name: 'WorkTimeCalculator' },
  { text: 'export const Pagination = ({ currentPage, totalPages, onPageChange }) => { const pages = Array.from({ length: totalPages }, (_, i) => i + 1); return <nav className="pagination">{pages.map(page => <button key={page} onClick={() => onPageChange(page)} className={page === currentPage ? "active" : ""}>{page}</button>)}</nav>; };', name: 'Pagination' },
  { text: 'public class AuditLogService { public void log(AuditAction action, String entityType, Long entityId, String details) { AuditLog log = AuditLog.builder().action(action).entityType(entityType).entityId(entityId).details(details).timestamp(Instant.now()).user(getCurrentUser()).build(); auditLogRepository.save(log); } }', name: 'AuditLogService' },
];

// =============================================================================
// UTILITIES
// =============================================================================

function calculateStats(values) {
  if (!values || values.length === 0) {
    return { mean: 0, median: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stddev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  const variance = sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)],
    p99: sorted[Math.floor(n * 0.99)],
    min: sorted[0],
    max: sorted[n - 1],
    stddev: Math.round(stddev * 100) / 100,
  };
}

function parseArgs() {
  const args = {
    baseline: false,
    compare: null,
    iterations: 50,
    warmup: 10,
    docCounts: [10, 20, 50],
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--baseline') {
      args.baseline = true;
    } else if (arg.startsWith('--compare=')) {
      args.compare = arg.split('=')[1];
    } else if (arg.startsWith('--iterations=')) {
      args.iterations = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--warmup=')) {
      args.warmup = parseInt(arg.split('=')[1], 10);
    }
  }

  return args;
}

// =============================================================================
// BENCHMARK
// =============================================================================

async function runBenchmark(args) {
  console.log('='.repeat(60));
  console.log('FLASHRANK RERANKING LATENCY BENCHMARK');
  console.log('='.repeat(60));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Iterations per test: ${args.iterations}`);
  console.log(`  Warmup iterations: ${args.warmup}`);
  console.log(`  Document counts: ${args.docCounts.join(', ')}`);
  console.log();

  // Initialize reranker
  console.log('Initializing FlashRank reranker...');
  const flashrank = new FlashRankReranker();
  await flashrank.init();
  console.log('Model loaded.\n');

  const queries = [
    'AuthService authentication login',
    'employee time tracking',
    'bot detection heuristic',
  ];

  const results = {
    timestamp: new Date().toISOString(),
    config: args,
    benchmarks: {},
  };

  // Run warmup
  console.log(`Running ${args.warmup} warmup iterations...`);
  const warmupDocs = BENCHMARK_DOCS.slice(0, 20);
  for (let i = 0; i < args.warmup; i++) {
    await flashrank.rerank(queries[i % queries.length], warmupDocs, 10);
  }
  console.log('Warmup complete.\n');

  // Benchmark each document count
  for (const docCount of args.docCounts) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Benchmarking with ${docCount} documents`);
    console.log(`${'─'.repeat(50)}`);

    const docs = BENCHMARK_DOCS.slice(0, docCount);

    // Sequential benchmark
    console.log('\n  Sequential (Promise.all per doc):');
    const seqLatencies = [];
    for (let i = 0; i < args.iterations; i++) {
      const query = queries[i % queries.length];

      const start = performance.now();
      await flashrank.rerank(query, docs, 10);
      const elapsed = performance.now() - start;

      seqLatencies.push(elapsed);

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r    Progress: ${i + 1}/${args.iterations}`);
      }
    }
    console.log();

    const seqStats = calculateStats(seqLatencies);
    results.benchmarks[`docs_${docCount}_sequential`] = seqStats;

    console.log(`    P50: ${seqStats.p50.toFixed(2)}ms  P95: ${seqStats.p95.toFixed(2)}ms  Mean: ${seqStats.mean.toFixed(2)}ms`);

    // Batched benchmark
    console.log('\n  Batched (true transformer batch):');
    const batchLatencies = [];
    for (let i = 0; i < args.iterations; i++) {
      const query = queries[i % queries.length];

      const start = performance.now();
      await flashrank.rerankBatched(query, docs, 10);
      const elapsed = performance.now() - start;

      batchLatencies.push(elapsed);

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r    Progress: ${i + 1}/${args.iterations}`);
      }
    }
    console.log();

    const batchStats = calculateStats(batchLatencies);
    results.benchmarks[`docs_${docCount}_batched`] = batchStats;

    console.log(`    P50: ${batchStats.p50.toFixed(2)}ms  P95: ${batchStats.p95.toFixed(2)}ms  Mean: ${batchStats.mean.toFixed(2)}ms`);

    // Calculate improvement
    const improvement = ((seqStats.p50 - batchStats.p50) / seqStats.p50 * 100).toFixed(1);
    const speedup = (seqStats.p50 / batchStats.p50).toFixed(1);
    const color = improvement > 0 ? '\x1b[32m' : '\x1b[31m';
    console.log(`\n  ${color}Improvement: ${improvement}% (${speedup}x faster)\x1b[0m`);
  }

  return results;
}

async function main() {
  const args = parseArgs();

  try {
    const results = await runBenchmark(args);

    // Save baseline if requested
    if (args.baseline) {
      const baselinePath = join(__dirname, '..', 'benchmark-results', 'rerank-baseline.json');
      writeFileSync(baselinePath, JSON.stringify(results, null, 2));
      console.log(`\nBaseline saved to: ${baselinePath}`);
    }

    // Compare to baseline if requested
    if (args.compare) {
      const baselinePath = join(__dirname, '..', 'benchmark-results', `${args.compare}.json`);
      if (existsSync(baselinePath)) {
        const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

        console.log('\n' + '='.repeat(60));
        console.log('COMPARISON TO BASELINE');
        console.log('='.repeat(60));

        for (const key of Object.keys(results.benchmarks)) {
          if (baseline.benchmarks[key]) {
            const current = results.benchmarks[key];
            const base = baseline.benchmarks[key];
            const improvement = ((base.p50 - current.p50) / base.p50 * 100).toFixed(1);
            const color = improvement > 0 ? '\x1b[32m' : '\x1b[31m';

            console.log(`\n${key}:`);
            console.log(`  Baseline P50: ${base.p50.toFixed(2)}ms`);
            console.log(`  Current P50:  ${current.p50.toFixed(2)}ms`);
            console.log(`  ${color}Improvement: ${improvement}%\x1b[0m`);
          }
        }
      } else {
        console.log(`\nBaseline file not found: ${baselinePath}`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('\n| Docs | Sequential P50 | Batched P50 | Speedup |');
    console.log('|------|----------------|-------------|---------|');
    for (const docCount of args.docCounts) {
      const seqStats = results.benchmarks[`docs_${docCount}_sequential`];
      const batchStats = results.benchmarks[`docs_${docCount}_batched`];
      if (seqStats && batchStats) {
        const speedup = (seqStats.p50 / batchStats.p50).toFixed(1);
        console.log(`| ${docCount.toString().padEnd(4)} | ${seqStats.p50.toFixed(2).padStart(14)}ms | ${batchStats.p50.toFixed(2).padStart(11)}ms | ${speedup.padStart(7)}x |`);
      }
    }

  } catch (err) {
    console.error('Benchmark failed:', err.message);
    process.exit(1);
  }
}

main();
