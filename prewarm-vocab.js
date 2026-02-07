#!/usr/bin/env node
/**
 * Pre-warm vocabulary with common Sloth terms
 * This speeds up semantic search for these terms (cache hit vs API call)
 */

import { expandVocabulary } from './embedding-service.js';

// 100 common Sloth terms - classes, concepts, features
const SLOTH_TERMS = [
  // Core entities
  'Employee', 'Manager', 'User', 'Admin', 'Team', 'Project', 'Client',
  'Session', 'Process', 'Absence', 'Realization', 'Document', 'Notification',

  // Auth & Security
  'JWT', 'authentication', 'authorization', 'login', 'logout', 'token',
  'JwtService', 'JwtAuthenticationFilter', 'ApiKey', 'WebSecurityConfig',
  'password', 'credentials', 'refresh token', 'access token',

  // Services
  'EmployeeService', 'ManagerService', 'UserService', 'LoginService',
  'EventService', 'ProcessService', 'ScreenshotService', 'EmailService',
  'RefreshTokenService', 'NetworkDetectionService', 'BotDetectionService',

  // Controllers
  'AuthController', 'EmployeeController', 'ProjectController', 'TeamController',
  'UserController', 'ManagerController', 'InstallerController', 'SessionController',

  // Vita Desktop
  'BioLogger', 'Listener', 'Buffer', 'TrajectoryBuffer', 'NeuromotorAnalyzer',
  'ConfigHandler', 'GrpcChannelManager', 'EventGrpcClient', 'TrayManager',
  'GUI', 'LoginGUI', 'SettingsGUI', 'NeoBrutalist',

  // Bot Detection
  'DetectionHeuristic', 'HeuristicResult', 'VetoRule', 'TrajectoryHasher',
  'AccelerationProfile', 'PowerLawViolation', 'BezierFit', 'MouseOnly',

  // Events & Metrics
  'BioEvent', 'BioClickEvent', 'BioKeystrokeEvent', 'BioMotionEvent',
  'EventMetrics', 'TrajectoryStats', 'AccelerationStats', 'ClickStats',

  // gRPC
  'grpc', 'protobuf', 'streaming', 'GrpcClient', 'GrpcBatchResult',
  'sloth_monitoring.proto', 'EmployeeEventGrpcClient', 'ProcessGrpcClient',

  // Frontend
  'React', 'Vite', 'TanStack', 'axios', 'UserContext', 'ProtectedRoutes',
  'Tailwind', 'dashboard', 'time tracking', 'stopwatch',

  // Database & Models
  'JPA', 'Hibernate', 'Repository', 'tblemployees', 'tblprojects', 'tblsessions',
  'EmployeeRepository', 'ProjectRepository', 'SettingsModel',

  // Common queries
  'how does authentication work', 'where is login handled',
  'employee time tracking', 'screenshot capture', 'process monitoring',
  'bot detection heuristics', 'neuromotor analysis', 'trajectory analysis',
  'installer management', 'email verification', 'API key authentication',
];

console.log('\nPre-warming vocabulary with ' + SLOTH_TERMS.length + ' Sloth terms...');
const start = Date.now();

try {
  await expandVocabulary(SLOTH_TERMS);
  console.log('Done in ' + (Date.now() - start) + 'ms');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
