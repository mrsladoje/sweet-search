#!/usr/bin/env node

/**
 * Comprehensive Reranker Model Comparison
 *
 * Compares MiniLM-L6-v2 vs TinyBERT-L2-v2 for:
 * - Latency (local-only)
 * - Accuracy (Success@10, MRR@10)
 * - Combined performance with Voyage API cascade
 *
 * Usage:
 *   node benchmark-model-comparison.js                 # Run all tests
 *   node benchmark-model-comparison.js --latency-only  # Latency benchmark only
 *   node benchmark-model-comparison.js --eval-only     # Evaluation only (requires ground truth)
 *   node benchmark-model-comparison.js --iterations=30 # Custom iteration count
 */

import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// MODELS TO COMPARE
// =============================================================================

const MODELS = {
  'MiniLM-L6-v2': 'Xenova/ms-marco-MiniLM-L-6-v2',
  'TinyBERT-L2-v2': 'Xenova/ms-marco-TinyBERT-L-2-v2',
};

// =============================================================================
// BENCHMARK DOCUMENTS (realistic code samples)
// =============================================================================

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
// TEST QUERIES WITH GROUND TRUTH
// =============================================================================

const TEST_QUERIES = [
  { query: 'AuthService authentication login', expectedTop: ['AuthService', 'LoginController', 'JwtTokenProvider'] },
  { query: 'employee time tracking', expectedTop: ['EmployeeService', 'SessionService', 'WorkTimeCalculator'] },
  { query: 'bot detection heuristic', expectedTop: ['BotDetectionService', 'DetectionHeuristic', 'VelocityProfileHeuristic'] },
  { query: 'file upload document storage', expectedTop: ['DocumentService', 'FileStorageService'] },
  { query: 'user permissions access control', expectedTop: ['PermissionEvaluator', 'SecurityConfig'] },
  { query: 'React form validation', expectedTop: ['validateForm', 'useAuth'] },
  { query: 'project management service', expectedTop: ['ProjectService', 'RealizationController'] },
  { query: 'absence leave request', expectedTop: ['AbsenceService', 'AbsenceController'] },
  { query: 'notification email sending', expectedTop: ['NotificationService', 'EmailService'] },
  { query: 'mouse movement tracking', expectedTop: ['MouseTracker', 'TrajectoryHashStore', 'NeuromotorAnalyzer'] },
];

// =============================================================================
// DYNAMIC RERANKER CLASS (supports model switching)
// =============================================================================

class DynamicFlashRanker {
  constructor(modelPath) {
    this.modelPath = modelPath;
    this.pipeline = null;
    this.maxDocLength = 512;
  }

  async init() {
    if (this.pipeline) return;

    try {
      const transformers = await import('@xenova/transformers');
      this.pipeline = await transformers.pipeline(
        'text-classification',
        this.modelPath,
        { quantized: true }
      );
      console.log(`  Loaded: ${this.modelPath}`);
    } catch (err) {
      console.error(`  Failed to load ${this.modelPath}: ${err.message}`);
      this.pipeline = null;
    }
  }

  async rerank(query, documents, topK = 10) {
    const start = performance.now();

    if (!this.pipeline) {
      throw new Error('Model not initialized');
    }

    const pairs = documents.map((doc, index) => ({
      index,
      text: (typeof doc === 'string' ? doc : doc.text || doc.content || '').slice(0, this.maxDocLength),
      original: doc,
    }));

    const scores = await Promise.all(
      pairs.map(async (pair) => {
        try {
          const input = `${query} [SEP] ${pair.text}`;
          const result = await this.pipeline(input);
          return { ...pair, score: result[0]?.score || 0 };
        } catch {
          return { ...pair, score: 0 };
        }
      })
    );

    scores.sort((a, b) => b.score - a.score);

    const results = scores.slice(0, topK).map((item, rank) => ({
      ...item.original,
      score: item.score,
      originalIndex: item.index,
      newRank: rank + 1,
    }));

    return {
      results,
      latency_ms: performance.now() - start,
    };
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function calculateStats(values) {
  if (!values || values.length === 0) {
    return { mean: 0, median: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  return {
    mean: Math.round(mean * 100) / 100,
    median: sorted[Math.floor(n / 2)],
    p50: sorted[Math.floor(n * 0.5)],
    p95: sorted[Math.floor(n * 0.95)],
    min: sorted[0],
    max: sorted[n - 1],
  };
}

function calculateAccuracy(results, expected) {
  // Success@K: Is at least one expected result in top K?
  const resultNames = results.map(r => r.name || r.original?.name);
  const foundAny = expected.some(exp => resultNames.includes(exp));

  // MRR: Reciprocal rank of first expected result
  let mrr = 0;
  for (let i = 0; i < resultNames.length; i++) {
    if (expected.includes(resultNames[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  // Recall@K: How many expected results are in top K?
  const found = expected.filter(exp => resultNames.includes(exp)).length;
  const recall = found / expected.length;

  return { success: foundAny, mrr, recall };
}

function parseArgs() {
  const args = {
    latencyOnly: false,
    evalOnly: false,
    iterations: 30,
    warmup: 5,
    docCounts: [10, 20, 50],
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--latency-only') {
      args.latencyOnly = true;
    } else if (arg === '--eval-only') {
      args.evalOnly = true;
    } else if (arg.startsWith('--iterations=')) {
      args.iterations = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--warmup=')) {
      args.warmup = parseInt(arg.split('=')[1], 10);
    }
  }

  return args;
}

// =============================================================================
// LATENCY BENCHMARK
// =============================================================================

async function runLatencyBenchmark(args) {
  console.log('\n' + '='.repeat(70));
  console.log('LATENCY BENCHMARK: MiniLM-L6-v2 vs TinyBERT-L2-v2');
  console.log('='.repeat(70));
  console.log(`\nConfiguration: ${args.iterations} iterations, ${args.warmup} warmup`);

  const results = {};

  for (const [modelName, modelPath] of Object.entries(MODELS)) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Model: ${modelName}`);
    console.log(`${'─'.repeat(60)}`);

    const reranker = new DynamicFlashRanker(modelPath);
    await reranker.init();

    if (!reranker.pipeline) {
      console.log(`  SKIPPED: Failed to load model`);
      continue;
    }

    results[modelName] = {};

    // Warmup
    console.log(`\n  Warming up (${args.warmup} iterations)...`);
    const warmupDocs = BENCHMARK_DOCS.slice(0, 20);
    for (let i = 0; i < args.warmup; i++) {
      await reranker.rerank(TEST_QUERIES[i % TEST_QUERIES.length].query, warmupDocs, 10);
    }

    // Benchmark each document count
    for (const docCount of args.docCounts) {
      const docs = BENCHMARK_DOCS.slice(0, docCount);
      const latencies = [];

      process.stdout.write(`  ${docCount} docs: `);

      for (let i = 0; i < args.iterations; i++) {
        const query = TEST_QUERIES[i % TEST_QUERIES.length].query;
        const result = await reranker.rerank(query, docs, 10);
        latencies.push(result.latency_ms);

        if ((i + 1) % 10 === 0) {
          process.stdout.write('.');
        }
      }

      const stats = calculateStats(latencies);
      results[modelName][`docs_${docCount}`] = stats;

      console.log(` P50: ${stats.p50.toFixed(1)}ms, P95: ${stats.p95.toFixed(1)}ms, Mean: ${stats.mean.toFixed(1)}ms`);
    }
  }

  return results;
}

// =============================================================================
// ACCURACY EVALUATION
// =============================================================================

async function runAccuracyEvaluation() {
  console.log('\n' + '='.repeat(70));
  console.log('ACCURACY EVALUATION: MiniLM-L6-v2 vs TinyBERT-L2-v2');
  console.log('='.repeat(70));
  console.log(`\nTest queries: ${TEST_QUERIES.length}`);
  console.log(`Documents: ${BENCHMARK_DOCS.length}`);

  const results = {};

  for (const [modelName, modelPath] of Object.entries(MODELS)) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Model: ${modelName}`);
    console.log(`${'─'.repeat(60)}`);

    const reranker = new DynamicFlashRanker(modelPath);
    await reranker.init();

    if (!reranker.pipeline) {
      console.log(`  SKIPPED: Failed to load model`);
      continue;
    }

    const metrics = {
      successes: 0,
      totalMrr: 0,
      totalRecall: 0,
      details: [],
    };

    for (const testCase of TEST_QUERIES) {
      const result = await reranker.rerank(testCase.query, BENCHMARK_DOCS, 10);
      const accuracy = calculateAccuracy(result.results, testCase.expectedTop);

      metrics.successes += accuracy.success ? 1 : 0;
      metrics.totalMrr += accuracy.mrr;
      metrics.totalRecall += accuracy.recall;

      metrics.details.push({
        query: testCase.query,
        success: accuracy.success,
        mrr: accuracy.mrr,
        recall: accuracy.recall,
        top3: result.results.slice(0, 3).map(r => r.name || r.original?.name),
      });
    }

    const n = TEST_QUERIES.length;
    results[modelName] = {
      successRate: (metrics.successes / n * 100).toFixed(1) + '%',
      mrr: (metrics.totalMrr / n).toFixed(3),
      recall: (metrics.totalRecall / n * 100).toFixed(1) + '%',
      details: metrics.details,
    };

    console.log(`\n  Success@10: ${results[modelName].successRate}`);
    console.log(`  MRR@10:     ${results[modelName].mrr}`);
    console.log(`  Recall@10:  ${results[modelName].recall}`);

    // Show failures
    const failures = metrics.details.filter(d => !d.success);
    if (failures.length > 0) {
      console.log(`\n  Failures (${failures.length}):`);
      failures.slice(0, 3).forEach(f => {
        console.log(`    - "${f.query}" → got: [${f.top3.join(', ')}]`);
      });
    }
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     RERANKER MODEL COMPARISON: MiniLM-L6-v2 vs TinyBERT-L2-v2    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  let latencyResults = null;
  let accuracyResults = null;

  // Run latency benchmark
  if (!args.evalOnly) {
    latencyResults = await runLatencyBenchmark(args);
  }

  // Run accuracy evaluation
  if (!args.latencyOnly) {
    accuracyResults = await runAccuracyEvaluation();
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));

  if (latencyResults) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│ LATENCY COMPARISON (P50)                                            │');
    console.log('├─────────────────┬─────────────┬─────────────┬─────────────┬─────────┤');
    console.log('│ Model           │ 10 docs     │ 20 docs     │ 50 docs     │ Speedup │');
    console.log('├─────────────────┼─────────────┼─────────────┼─────────────┼─────────┤');

    const modelNames = Object.keys(latencyResults);
    const miniLM = latencyResults['MiniLM-L6-v2'];
    const tinyBERT = latencyResults['TinyBERT-L2-v2'];

    for (const model of modelNames) {
      const r = latencyResults[model];
      const d10 = r.docs_10?.p50?.toFixed(1) || 'N/A';
      const d20 = r.docs_20?.p50?.toFixed(1) || 'N/A';
      const d50 = r.docs_50?.p50?.toFixed(1) || 'N/A';

      let speedup = '-';
      if (model === 'TinyBERT-L2-v2' && miniLM?.docs_50?.p50 && tinyBERT?.docs_50?.p50) {
        speedup = (miniLM.docs_50.p50 / tinyBERT.docs_50.p50).toFixed(1) + 'x';
      }

      console.log(`│ ${model.padEnd(15)} │ ${(d10 + 'ms').padStart(11)} │ ${(d20 + 'ms').padStart(11)} │ ${(d50 + 'ms').padStart(11)} │ ${speedup.padStart(7)} │`);
    }
    console.log('└─────────────────┴─────────────┴─────────────┴─────────────┴─────────┘');
  }

  if (accuracyResults) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│ ACCURACY COMPARISON                                                 │');
    console.log('├─────────────────┬─────────────┬─────────────┬─────────────┬─────────┤');
    console.log('│ Model           │ Success@10  │ MRR@10      │ Recall@10   │ Delta   │');
    console.log('├─────────────────┼─────────────┼─────────────┼─────────────┼─────────┤');

    const miniLM = accuracyResults['MiniLM-L6-v2'];
    const tinyBERT = accuracyResults['TinyBERT-L2-v2'];

    for (const [model, r] of Object.entries(accuracyResults)) {
      let delta = '-';
      if (model === 'TinyBERT-L2-v2' && miniLM && tinyBERT) {
        const miniSuccess = parseFloat(miniLM.successRate);
        const tinySuccess = parseFloat(tinyBERT.successRate);
        delta = (tinySuccess - miniSuccess).toFixed(1) + '%';
      }

      console.log(`│ ${model.padEnd(15)} │ ${r.successRate.padStart(11)} │ ${r.mrr.padStart(11)} │ ${r.recall.padStart(11)} │ ${delta.padStart(7)} │`);
    }
    console.log('└─────────────────┴─────────────┴─────────────┴─────────────┴─────────┘');
  }

  // Decision recommendation
  if (latencyResults && accuracyResults) {
    const miniLM = accuracyResults['MiniLM-L6-v2'];
    const tinyBERT = accuracyResults['TinyBERT-L2-v2'];
    const miniLatency = latencyResults['MiniLM-L6-v2']?.docs_50?.p50;
    const tinyLatency = latencyResults['TinyBERT-L2-v2']?.docs_50?.p50;

    if (miniLM && tinyBERT && miniLatency && tinyLatency) {
      const successDelta = parseFloat(tinyBERT.successRate) - parseFloat(miniLM.successRate);
      const speedup = miniLatency / tinyLatency;

      console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
      console.log('│ RECOMMENDATION                                                      │');
      console.log('├─────────────────────────────────────────────────────────────────────┤');

      if (successDelta >= -2 && speedup >= 2) {
        console.log('│ ✅ SWITCH TO TinyBERT-L2-v2                                         │');
        console.log(`│    Speedup: ${speedup.toFixed(1)}x faster with ${successDelta >= 0 ? 'no' : Math.abs(successDelta).toFixed(1) + '%'} accuracy loss           │`);
      } else if (successDelta < -4) {
        console.log('│ ❌ KEEP MiniLM-L6-v2                                                │');
        console.log(`│    TinyBERT accuracy drop too large: ${successDelta.toFixed(1)}%                        │`);
      } else {
        console.log('│ ⚠️  CONSIDER: Trade-off required                                    │');
        console.log(`│    Speedup: ${speedup.toFixed(1)}x, Accuracy delta: ${successDelta.toFixed(1)}%                          │`);
      }
      console.log('└─────────────────────────────────────────────────────────────────────┘');
    }
  }

  // Save results
  const outputPath = join(__dirname, 'benchmark-results', 'model-comparison.json');
  const output = {
    timestamp: new Date().toISOString(),
    latency: latencyResults,
    accuracy: accuracyResults,
  };

  try {
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
  } catch (err) {
    console.log(`\nCould not save results: ${err.message}`);
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
