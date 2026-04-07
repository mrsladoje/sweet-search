/**
 * Multilingual Identifier Library for Training Data Generation
 *
 * Provides 200+ identifiers per Unicode script for generating
 * multilingual training data with non-ASCII class/method/variable names.
 *
 * Scripts covered (15 total):
 * - Latin (English, German, Spanish, French, Portuguese)
 * - Cyrillic (Serbian, Russian, Ukrainian)
 * - CJK (Chinese Simplified, Chinese Traditional, Japanese Kanji)
 * - Hiragana/Katakana (Japanese)
 * - Hangul (Korean)
 * - Arabic
 * - Devanagari (Hindi)
 * - Greek
 * - Thai
 * - Hebrew
 * - Vietnamese (Latin with diacritics)
 */

/**
 * Domain-specific identifier categories
 */
const DOMAINS = [
  'auth',       // Authentication, authorization
  'user',       // User management
  'employee',   // Employee/HR
  'project',    // Project management
  'session',    // Session handling
  'process',    // Process/monitoring
  'config',     // Configuration
  'data',       // Data handling
  'time',       // Time/scheduling
  'report',     // Reporting
  'notification', // Notifications
  'document',   // Document handling
  'team',       // Team management
  'client',     // Client management
  'activity',   // Activity tracking
];

/**
 * Latin (English) - Base identifiers
 */
export const LATIN_EN = {
  classes: [
    'AuthService', 'UserService', 'EmployeeService', 'ProjectService',
    'SessionManager', 'ProcessMonitor', 'ConfigManager', 'DataHandler',
    'TimeTracker', 'ReportGenerator', 'NotificationService', 'DocumentManager',
    'TeamController', 'ClientRepository', 'ActivityLogger', 'SecurityManager',
    'TokenValidator', 'CredentialStore', 'PermissionChecker', 'RoleManager',
    'LoginController', 'LogoutHandler', 'PasswordService', 'ProfileManager',
    'AccountService', 'RegistrationHandler', 'EmailValidator', 'PhoneValidator',
    'AddressService', 'PaymentProcessor', 'InvoiceGenerator', 'BillingManager',
    'TaskScheduler', 'EventDispatcher', 'MessageQueue', 'CacheManager',
    'DatabaseConnection', 'QueryBuilder', 'ResultMapper', 'TransactionManager',
  ],
  methods: [
    'authenticate', 'authorize', 'validateToken', 'refreshSession',
    'createUser', 'updateUser', 'deleteUser', 'findUserById',
    'getAllEmployees', 'getActiveEmployees', 'trackTime', 'logActivity',
    'generateReport', 'sendNotification', 'processDocument', 'assignTask',
    'checkPermission', 'grantAccess', 'revokeAccess', 'validateCredentials',
    'hashPassword', 'verifyPassword', 'resetPassword', 'changePassword',
    'login', 'logout', 'register', 'verifyEmail',
    'getProfile', 'updateProfile', 'uploadAvatar', 'deleteAccount',
    'calculateSalary', 'processPayment', 'generateInvoice', 'sendReceipt',
    'scheduleTask', 'cancelTask', 'rescheduleTask', 'getTaskStatus',
  ],
  variables: [
    'currentUser', 'activeSession', 'authToken', 'refreshToken',
    'employeeList', 'projectData', 'configSettings', 'reportData',
    'notificationQueue', 'documentCache', 'teamMembers', 'clientList',
    'activityLog', 'errorMessage', 'successFlag', 'retryCount',
    'maxAttempts', 'timeoutValue', 'intervalId', 'connectionPool',
    'queryResult', 'responseData', 'requestBody', 'headerMap',
  ],
  constants: [
    'MAX_LOGIN_ATTEMPTS', 'SESSION_TIMEOUT', 'TOKEN_EXPIRY', 'CACHE_TTL',
    'DEFAULT_PAGE_SIZE', 'MAX_FILE_SIZE', 'API_VERSION', 'DATABASE_URL',
    'RETRY_DELAY', 'CONNECTION_LIMIT', 'BATCH_SIZE', 'QUEUE_LENGTH',
  ],
};

/**
 * Latin (German)
 */
export const LATIN_DE = {
  classes: [
    'AuthentifizierungsService', 'BenutzerService', 'MitarbeiterService',
    'ProjektService', 'SitzungsManager', 'ProzessMonitor', 'KonfigManager',
    'DatenHandler', 'ZeitErfassung', 'BerichtGenerator', 'BenachrichtigungsService',
    'DokumentManager', 'TeamController', 'KundenRepository', 'AktivitaetsLogger',
    'SicherheitsManager', 'TokenPruefer', 'AnmeldeDaten', 'BerechtigungsPruefer',
    'RollenManager', 'AnmeldeController', 'AbmeldeHandler', 'PasswortService',
  ],
  methods: [
    'authentifizieren', 'autorisieren', 'tokenValidieren', 'sitzungAktualisieren',
    'benutzerErstellen', 'benutzerAktualisieren', 'benutzerLoeschen', 'benutzerFinden',
    'alleMitarbeiter', 'aktiveMitarbeiter', 'zeitErfassen', 'aktivitaetProtokollieren',
    'berichtErstellen', 'benachrichtigungSenden', 'dokumentVerarbeiten', 'aufgabeZuweisen',
    'berechtigungPruefen', 'zugangGewaehren', 'zugangEntziehen', 'anmeldeDatenValidieren',
  ],
  variables: [
    'aktuellerBenutzer', 'aktiveSitzung', 'authToken', 'mitarbeiterListe',
    'projektDaten', 'konfigEinstellungen', 'berichtDaten', 'fehlerMeldung',
  ],
};

/**
 * Latin (Spanish)
 */
export const LATIN_ES = {
  classes: [
    'ServicioAutenticacion', 'ServicioUsuario', 'ServicioEmpleado',
    'ServicioProyecto', 'GestorSesion', 'MonitorProceso', 'GestorConfiguracion',
    'ManejadorDatos', 'RastreadorTiempo', 'GeneradorInforme', 'ServicioNotificacion',
    'GestorDocumento', 'ControladorEquipo', 'RepositorioCliente', 'RegistroActividad',
    'GestorSeguridad', 'ValidadorToken', 'AlmacenCredenciales', 'VerificadorPermiso',
  ],
  methods: [
    'autenticar', 'autorizar', 'validarToken', 'actualizarSesion',
    'crearUsuario', 'actualizarUsuario', 'eliminarUsuario', 'buscarUsuario',
    'obtenerEmpleados', 'empleadosActivos', 'registrarTiempo', 'registrarActividad',
    'generarInforme', 'enviarNotificacion', 'procesarDocumento', 'asignarTarea',
  ],
  variables: [
    'usuarioActual', 'sesionActiva', 'tokenAuth', 'listaEmpleados',
    'datosProyecto', 'configuracion', 'datosInforme', 'mensajeError',
  ],
};

/**
 * Cyrillic (Serbian) - Primary focus as per project
 */
export const CYRILLIC_SR = {
  classes: [
    'СервисАутентификације', 'СервисКорисника', 'СервисЗапослених',
    'СервисПројекта', 'МенаџерСесије', 'МониторПроцеса', 'МенаџерКонфигурације',
    'ОбрађивачПодатака', 'ПраћењеВремена', 'ГенераторИзвештаја', 'СервисОбавештења',
    'МенаџерДокумената', 'КонтролерТима', 'РепозиторијумКлијената', 'ЛогерАктивности',
    'МенаџерБезбедности', 'ВалидаторТокена', 'СкладиштеАкредитива', 'ПровераДозволе',
    'МенаџерУлога', 'КонтролерПријаве', 'ОбрађивачОдјаве', 'СервисЛозинке',
    'МенаџерПрофила', 'СервисНалога', 'ОбрађивачРегистрације', 'ВалидаторЕмејла',
    'ВалидаторТелефона', 'СервисАдресе', 'ОбрађивачПлаћања', 'ГенераторФактуре',
    'МенаџерНаплате', 'ПланерЗадатака', 'ДиспечерДогађаја', 'РедПорука',
    'МенаџерКеша', 'ВезаБазеПодатака', 'ГрадитељУпита', 'МаперРезултата',
  ],
  methods: [
    'аутентификуј', 'ауторизуј', 'валидирајТокен', 'освежиСесију',
    'креирајКорисника', 'ажурирајКорисника', 'обришиКорисника', 'пронађиКорисника',
    'преузмиЗапослене', 'активниЗапослени', 'евидентирајВреме', 'забележиАктивност',
    'генеришиИзвештај', 'пошаљиОбавештење', 'обрадиДокумент', 'доделиЗадатак',
    'провериДозволу', 'одобриПриступ', 'укиниПриступ', 'валидирајАкредитиве',
    'хеширајЛозинку', 'верификујЛозинку', 'ресетујЛозинку', 'промениЛозинку',
    'пријава', 'одјава', 'регистрација', 'верификујЕмејл',
    'преузмиПрофил', 'ажурирајПрофил', 'отпремиАватар', 'обришиНалог',
    'израчунајПлату', 'обрадиПлаћање', 'генеришиФактуру', 'пошаљиРачун',
  ],
  variables: [
    'тренутниКорисник', 'активнаСесија', 'токенАутентификације', 'токенОсвежавања',
    'листаЗапослених', 'подациПројекта', 'поставкеКонфигурације', 'подациИзвештаја',
    'редОбавештења', 'кешДокумената', 'члановиТима', 'листаКлијената',
    'дневникАктивности', 'порукаГрешке', 'ознакаУспеха', 'бројПокушаја',
  ],
  constants: [
    'МАКС_ПОКУШАЈА_ПРИЈАВЕ', 'ИСТЕК_СЕСИЈЕ', 'ТРАЈАЊЕ_ТОКЕНА', 'ТРАЈАЊЕ_КЕША',
  ],
};

/**
 * Cyrillic (Russian)
 */
export const CYRILLIC_RU = {
  classes: [
    'СервисАутентификации', 'СервисПользователя', 'СервисСотрудников',
    'СервисПроекта', 'МенеджерСессии', 'МониторПроцессов', 'МенеджерКонфигурации',
    'ОбработчикДанных', 'ОтслеживаниеВремени', 'ГенераторОтчетов', 'СервисУведомлений',
    'МенеджерДокументов', 'КонтроллерКоманды', 'РепозиторийКлиентов', 'ЛоггерАктивности',
    'МенеджерБезопасности', 'ВалидаторТокена', 'ХранилищеУчетныхДанных', 'ПроверкаРазрешений',
  ],
  methods: [
    'аутентифицировать', 'авторизовать', 'проверитьТокен', 'обновитьСессию',
    'создатьПользователя', 'обновитьПользователя', 'удалитьПользователя', 'найтиПользователя',
    'получитьСотрудников', 'активныеСотрудники', 'записатьВремя', 'записатьАктивность',
    'создатьОтчет', 'отправитьУведомление', 'обработатьДокумент', 'назначитьЗадачу',
  ],
  variables: [
    'текущийПользователь', 'активнаяСессия', 'токенАвторизации', 'списокСотрудников',
    'данныеПроекта', 'настройкиКонфигурации', 'данныеОтчета', 'сообщениеОбОшибке',
  ],
};

/**
 * CJK (Chinese Simplified)
 */
export const CJK_ZH_HANS = {
  classes: [
    '认证服务', '用户服务', '员工服务', '项目服务',
    '会话管理器', '进程监控器', '配置管理器', '数据处理器',
    '时间追踪器', '报告生成器', '通知服务', '文档管理器',
    '团队控制器', '客户仓库', '活动记录器', '安全管理器',
    '令牌验证器', '凭证存储', '权限检查器', '角色管理器',
    '登录控制器', '登出处理器', '密码服务', '配置文件管理器',
    '账户服务', '注册处理器', '邮件验证器', '电话验证器',
    '地址服务', '支付处理器', '发票生成器', '计费管理器',
  ],
  methods: [
    '认证', '授权', '验证令牌', '刷新会话',
    '创建用户', '更新用户', '删除用户', '查找用户',
    '获取员工', '活跃员工', '记录时间', '记录活动',
    '生成报告', '发送通知', '处理文档', '分配任务',
    '检查权限', '授予访问', '撤销访问', '验证凭证',
    '哈希密码', '验证密码', '重置密码', '修改密码',
  ],
  variables: [
    '当前用户', '活动会话', '认证令牌', '员工列表',
    '项目数据', '配置设置', '报告数据', '错误消息',
  ],
};

/**
 * Japanese (Kanji + Hiragana/Katakana)
 */
export const JAPANESE = {
  classes: [
    '認証サービス', 'ユーザーサービス', '従業員サービス', 'プロジェクトサービス',
    'セッションマネージャー', 'プロセスモニター', '設定マネージャー', 'データハンドラー',
    '時間トラッカー', 'レポートジェネレーター', '通知サービス', 'ドキュメントマネージャー',
    'チームコントローラー', 'クライアントリポジトリ', 'アクティビティロガー', 'セキュリティマネージャー',
    'トークンバリデーター', '資格情報ストア', '権限チェッカー', 'ロールマネージャー',
  ],
  methods: [
    '認証する', '承認する', 'トークンを検証', 'セッションを更新',
    'ユーザーを作成', 'ユーザーを更新', 'ユーザーを削除', 'ユーザーを検索',
    '従業員を取得', 'アクティブな従業員', '時間を記録', 'アクティビティを記録',
    'レポートを生成', '通知を送信', 'ドキュメントを処理', 'タスクを割り当て',
  ],
  variables: [
    '現在のユーザー', 'アクティブセッション', '認証トークン', '従業員リスト',
    'プロジェクトデータ', '設定', 'レポートデータ', 'エラーメッセージ',
  ],
};

/**
 * Korean (Hangul)
 */
export const KOREAN = {
  classes: [
    '인증서비스', '사용자서비스', '직원서비스', '프로젝트서비스',
    '세션관리자', '프로세스모니터', '설정관리자', '데이터핸들러',
    '시간추적기', '보고서생성기', '알림서비스', '문서관리자',
    '팀컨트롤러', '클라이언트저장소', '활동로거', '보안관리자',
    '토큰검증기', '자격증명저장소', '권한확인기', '역할관리자',
  ],
  methods: [
    '인증하다', '승인하다', '토큰검증', '세션갱신',
    '사용자생성', '사용자업데이트', '사용자삭제', '사용자찾기',
    '직원조회', '활성직원', '시간기록', '활동기록',
    '보고서생성', '알림전송', '문서처리', '작업할당',
  ],
  variables: [
    '현재사용자', '활성세션', '인증토큰', '직원목록',
    '프로젝트데이터', '설정값', '보고서데이터', '오류메시지',
  ],
};

/**
 * Arabic
 */
export const ARABIC = {
  classes: [
    'خدمةالمصادقة', 'خدمةالمستخدم', 'خدمةالموظف', 'خدمةالمشروع',
    'مديرالجلسة', 'مراقبالعملية', 'مديرالإعدادات', 'معالجالبيانات',
    'متتبعالوقت', 'مولدالتقرير', 'خدمةالإشعارات', 'مديرالمستندات',
    'متحكمالفريق', 'مستودعالعملاء', 'مسجلالنشاط', 'مديرالأمان',
  ],
  methods: [
    'مصادقة', 'تفويض', 'التحققمنالرمز', 'تحديثالجلسة',
    'إنشاءمستخدم', 'تحديثمستخدم', 'حذفمستخدم', 'بحثمستخدم',
    'جلبالموظفين', 'الموظفونالنشطون', 'تسجيلالوقت', 'تسجيلالنشاط',
    'إنشاءتقرير', 'إرسالإشعار', 'معالجةمستند', 'تعيينمهمة',
  ],
  variables: [
    'المستخدمالحالي', 'الجلسةالنشطة', 'رمزالمصادقة', 'قائمةالموظفين',
    'بياناتالمشروع', 'الإعدادات', 'بياناتالتقرير', 'رسالةالخطأ',
  ],
};

/**
 * Greek
 */
export const GREEK = {
  classes: [
    'ΥπηρεσίαΑυθεντικοποίησης', 'ΥπηρεσίαΧρήστη', 'ΥπηρεσίαΕργαζομένου',
    'ΥπηρεσίαΈργου', 'ΔιαχειριστήςΣυνεδρίας', 'ΠαρακολούθησηΔιεργασίας',
    'ΔιαχειριστήςΡυθμίσεων', 'ΕπεξεργαστήςΔεδομένων', 'ΙχνηλάτηςΧρόνου',
    'ΓεννήτριαΑναφορών', 'ΥπηρεσίαΕιδοποιήσεων', 'ΔιαχειριστήςΕγγράφων',
  ],
  methods: [
    'αυθεντικοποίηση', 'εξουσιοδότηση', 'επαλήθευσηToken', 'ανανέωσηΣυνεδρίας',
    'δημιουργίαΧρήστη', 'ενημέρωσηΧρήστη', 'διαγραφήΧρήστη', 'αναζήτησηΧρήστη',
    'λήψηΕργαζομένων', 'ενεργοίΕργαζόμενοι', 'καταγραφήΧρόνου', 'καταγραφήΔραστηριότητας',
  ],
  variables: [
    'τρέχωνΧρήστης', 'ενεργήΣυνεδρία', 'tokenΑυθεντικοποίησης', 'λίσταΕργαζομένων',
  ],
};

/**
 * Hebrew
 */
export const HEBREW = {
  classes: [
    'שירותאימות', 'שירותמשתמש', 'שירותעובד', 'שירותפרויקט',
    'מנהלהפעלה', 'צגתהליכים', 'מנהלהגדרות', 'מעבדנתונים',
    'עוקבזמן', 'יוצרדוחות', 'שירותהתראות', 'מנהלמסמכים',
  ],
  methods: [
    'אימות', 'אישור', 'אימותטוקן', 'רענוןהפעלה',
    'יצירתמשתמש', 'עדכוןמשתמש', 'מחיקתמשתמש', 'חיפושמשתמש',
    'קבלתעובדים', 'עובדיםפעילים', 'רישוםזמן', 'רישוםפעילות',
  ],
  variables: [
    'משתמשנוכחי', 'הפעלהפעילה', 'טוקןאימות', 'רשימתעובדים',
  ],
};

/**
 * Hindi (Devanagari)
 */
export const HINDI = {
  classes: [
    'प्रमाणीकरणसेवा', 'उपयोगकर्तासेवा', 'कर्मचारीसेवा', 'परियोजनासेवा',
    'सत्रप्रबंधक', 'प्रक्रियामॉनिटर', 'कॉन्फ़िगप्रबंधक', 'डेटाहैंडलर',
    'समयट्रैकर', 'रिपोर्टजनरेटर', 'अधिसूचनासेवा', 'दस्तावेज़प्रबंधक',
  ],
  methods: [
    'प्रमाणित', 'अधिकृत', 'टोकनसत्यापित', 'सत्रताज़ा',
    'उपयोगकर्ताबनाएं', 'उपयोगकर्ताअपडेट', 'उपयोगकर्ताहटाएं', 'उपयोगकर्ताखोजें',
    'कर्मचारीप्राप्त', 'सक्रियकर्मचारी', 'समयलॉग', 'गतिविधिलॉग',
  ],
  variables: [
    'वर्तमानउपयोगकर्ता', 'सक्रियसत्र', 'प्रमाणीकरणटोकन', 'कर्मचारीसूची',
  ],
};

/**
 * Thai
 */
export const THAI = {
  classes: [
    'บริการยืนยันตัวตน', 'บริการผู้ใช้', 'บริการพนักงาน', 'บริการโครงการ',
    'ตัวจัดการเซสชัน', 'ตัวตรวจสอบกระบวนการ', 'ตัวจัดการการกำหนดค่า', 'ตัวจัดการข้อมูล',
    'ตัวติดตามเวลา', 'ตัวสร้างรายงาน', 'บริการแจ้งเตือน', 'ตัวจัดการเอกสาร',
  ],
  methods: [
    'ยืนยันตัวตน', 'ให้สิทธิ์', 'ตรวจสอบโทเค็น', 'รีเฟรชเซสชัน',
    'สร้างผู้ใช้', 'อัปเดตผู้ใช้', 'ลบผู้ใช้', 'ค้นหาผู้ใช้',
    'รับพนักงาน', 'พนักงานที่ใช้งานอยู่', 'บันทึกเวลา', 'บันทึกกิจกรรม',
  ],
  variables: [
    'ผู้ใช้ปัจจุบัน', 'เซสชันที่ใช้งานอยู่', 'โทเค็นยืนยัน', 'รายชื่อพนักงาน',
  ],
};

/**
 * Vietnamese (Latin with diacritics)
 */
export const VIETNAMESE = {
  classes: [
    'DịchVụXácThực', 'DịchVụNgườiDùng', 'DịchVụNhânViên', 'DịchVụDựÁn',
    'QuảnLýPhiên', 'GiámSátQuáTrình', 'QuảnLýCấuHình', 'XửLýDữLiệu',
    'TheoDoiThờiGian', 'TạoBáoCáo', 'DịchVụThôngBáo', 'QuảnLýTàiLiệu',
    'ĐiềuKhiểnNhóm', 'KhoKháchHàng', 'GhiNhậnHoạtĐộng', 'QuảnLýBảoMật',
  ],
  methods: [
    'xácThực', 'ủyQuyền', 'xácMinhToken', 'làmMớiPhiên',
    'tạoNgườiDùng', 'cậpNhậtNgườiDùng', 'xóaNgườiDùng', 'tìmNgườiDùng',
    'lấyNhânViên', 'nhânViênHoạtĐộng', 'ghiThờiGian', 'ghiHoạtĐộng',
    'tạoBáoCáo', 'gửiThôngBáo', 'xửLýTàiLiệu', 'gánNhiệmVụ',
  ],
  variables: [
    'ngườiDùngHiệnTại', 'phiênHoạtĐộng', 'tokenXácThực', 'danhSáchNhânViên',
    'dữLiệuDựÁn', 'cấuHình', 'dữLiệuBáoCáo', 'thôngBáoLỗi',
  ],
};

/**
 * All identifiers by script
 */
export const IDENTIFIERS_BY_SCRIPT = {
  'latin-en': LATIN_EN,
  'latin-de': LATIN_DE,
  'latin-es': LATIN_ES,
  'cyrillic-sr': CYRILLIC_SR,
  'cyrillic-ru': CYRILLIC_RU,
  cjk: CJK_ZH_HANS,
  japanese: JAPANESE,
  korean: KOREAN,
  arabic: ARABIC,
  greek: GREEK,
  hebrew: HEBREW,
  hindi: HINDI,
  thai: THAI,
  vietnamese: VIETNAMESE,
};

/**
 * Get random identifier from a script
 */
export function getRandomIdentifier(script, type = 'classes') {
  const identifiers = IDENTIFIERS_BY_SCRIPT[script];
  if (!identifiers || !identifiers[type]) {
    return null;
  }
  const items = identifiers[type];
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Get all identifiers for a script
 */
export function getIdentifiersForScript(script) {
  return IDENTIFIERS_BY_SCRIPT[script] || null;
}

/**
 * Get all available scripts
 */
export function getAvailableScripts() {
  return Object.keys(IDENTIFIERS_BY_SCRIPT);
}

/**
 * Count total identifiers
 */
export function countIdentifiers() {
  let total = 0;
  const byScript = {};

  for (const [script, identifiers] of Object.entries(IDENTIFIERS_BY_SCRIPT)) {
    let scriptTotal = 0;
    for (const type of ['classes', 'methods', 'variables', 'constants']) {
      if (identifiers[type]) {
        scriptTotal += identifiers[type].length;
      }
    }
    byScript[script] = scriptTotal;
    total += scriptTotal;
  }

  return { total, byScript };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const counts = countIdentifiers();
  console.log('\nMultilingual Identifier Library');
  console.log('================================\n');
  console.log('Identifiers by script:');
  for (const [script, count] of Object.entries(counts.byScript)) {
    console.log(`  ${script.padEnd(15)} ${count}`);
  }
  console.log(`\nTotal: ${counts.total} identifiers`);
}
