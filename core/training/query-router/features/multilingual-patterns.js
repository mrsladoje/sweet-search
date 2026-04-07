/**
 * Multilingual Patterns for Query Router
 *
 * Provides non-English structural and semantic keyword detection for 15+ languages.
 * Enables the query router to correctly classify queries in any supported language.
 *
 * P0 Fixes Applied:
 * - Added try/catch error handling to all pattern matching functions
 * - Fixed regex catastrophic backtracking by replacing .+ with bounded patterns
 * - Added input length limits to prevent DoS
 *
 * Languages covered:
 * - Latin: English, German, Spanish, French, Portuguese, Italian
 * - Cyrillic: Serbian, Russian, Ukrainian
 * - CJK: Chinese (Simplified/Traditional), Japanese
 * - Hangul: Korean
 * - Arabic: Arabic, Persian, Urdu
 * - Other: Greek, Thai, Hebrew, Hindi (Devanagari), Vietnamese
 */

// P0 Fix: Maximum query length to prevent DoS via regex
const MAX_QUERY_LENGTH = 500;

/**
 * STRUCTURAL PATTERNS - Detect dependency/relationship queries
 *
 * Patterns for: callers, callees, implementations, impact, hierarchy
 */
export const STRUCTURAL_PATTERNS = {
  // WHO/WHAT CALLS X - Find callers of a symbol
  // Note: \b doesn't work with non-ASCII, so we use (?:^|\s) for non-Latin scripts
  callers: {
    en: /\b(what|who|which)\s+(calls?|uses?|invokes?|references?)\s+/i,
    de: /\b(was|wer|welche[rs]?)\s+(ruft|benutzt|verwendet|aufruft)\s+/i,
    es: /\b(qué|quién|cuál)\s+(llama|usa|invoca|referencia)\s+/i,
    fr: /\b(qu['']?est-ce qui|qui|quel)\s+(appelle|utilise|invoque)\s+/i,
    pt: /\b(o que|quem|qual)\s+(chama|usa|invoca|referencia)\s+/i,
    it: /\b(cosa|chi|quale)\s+(chiama|usa|invoca|riferisce)\s+/i,
    sr: /(?:^|\s)(шта|ко|који)\s+(позива|користи|зове|референцира)/i,
    ru: /(?:^|\s)(что|кто|какой)\s+(вызывает|использует|вызовет)/i,
    uk: /(?:^|\s)(що|хто|який)\s+(викликає|використовує|звертається)/i,
    zh: /(什么|谁|哪个)\s*(调用|使用|引用|访问)/,
    ja: /を?(呼び出す|使う|利用する|参照する)/,
    ko: /를?\s*(호출|사용|참조|이용)/,
    ar: /(ما|من|أي)\s*(يستدعي|يستخدم|يشير)/,
    el: /(?:^|\s)(τι|ποιος|ποια)\s+(καλεί|χρησιμοποιεί)/i,
    th: /(อะไร|ใคร)\s*(เรียก|ใช้|อ้างอิง)/,
    he: /(מה|מי|איזה)\s*(קורא|משתמש|מפנה)/,
    hi: /(क्या|कौन)\s*(कॉल|उपयोग|संदर्भ)/,
    // P1 Fix: Changed \b to (?:^|\s) - \b fails with Vietnamese diacritics
    vi: /(?:^|\s)(cái gì|ai|cái nào)\s+(gọi|sử dụng|tham chiếu)\s+/i,
  },

  // WHAT DOES X CALL - Find callees of a symbol
  // P0 Fix: Replaced .+ with bounded patterns to prevent catastrophic backtracking
  callees: {
    en: /\b(what\s+does|what\s+do|which\s+methods?|which\s+functions?)\s+\S+\s+(call|use|invoke|depend)/i,
    de: /\b(was\s+ruft|welche\s+methoden?)\s+\S+\s+(auf|benutzt)/i,
    es: /\b(qué\s+llama|qué\s+métodos?)\s+\S+\s+(usa|invoca)/i,
    fr: /\b(qu['']?appelle|quelles?\s+méthodes?)\s+/i,
    sr: /(?:^|\s)(шта\s+позива|које\s+методе)/i,
    ru: /(?:^|\s)(что\s+вызывает|какие\s+методы)/i,
    zh: /[\u4e00-\u9fff\w]+\s*(调用什么|使用什么|依赖什么)/,
    ja: /[\u3040-\u30ff\u4e00-\u9fff\w]+\s*(が呼び出す|が使う|が依存)/,
    ko: /[\uac00-\ud7af\w]+\s*(가\s*호출|가\s*사용|에\s*의존)/,
  },

  // IMPLEMENTATIONS OF X - Find implementing classes/interfaces
  // P0 Fix: Replaced .* with bounded patterns to prevent catastrophic backtracking
  implementations: {
    en: /\b(implementations?\s+of|classes?\s+implementing|implements|subclasses?\s+of|extends)\s+/i,
    de: /\b(implementierungen?\s+von|klassen?\s+die\s+implementieren|unterklassen?\s+von|erweitert)\s+/i,
    es: /\b(implementaciones?\s+de|clases?\s+que\s+implementan|subclases?\s+de|extiende)\s+/i,
    fr: /\b(implémentations?\s+de|classes?\s+implémentant|sous-classes?\s+de|étend)\s+/i,
    sr: /(?:^|\s)(имплементације|класе\s+које\s+имплементирају|подкласе|наслеђује)/i,
    ru: /(?:^|\s)(реализации|классы\s+реализующие|подклассы|наследует)/i,
    zh: /(实现|实现类|子类|继承)/,
    ja: /(の実装|を実装|サブクラス|継承)/,
    ko: /(구현|구현\s*클래스|하위\s*클래스|상속)/,
  },

  // IMPACT OF CHANGING X - Impact analysis
  // P0 Fix: Replaced .* with bounded patterns to prevent catastrophic backtracking
  impact: {
    en: /\b(impact|affected|breaking|ripple|consequence|side\s*effect)\s+(of\s+)?(changing|modifying|refactoring|removing|deleting)\s+/i,
    de: /\b(auswirkung|betroffen|konsequenz)\s+(von\s+)?(änderung|modifizierung|entfernung)\s+/i,
    es: /\b(impacto|afectado|consecuencia)\s+(de\s+)?(cambiar|modificar|eliminar)\s+/i,
    fr: /\b(impact|affecté|conséquence)\s+(de\s+)?(changer|modifier|supprimer)\s+/i,
    sr: /(?:^|\s)(утицај|последица|погођено)\s+(промене|модификације|брисања)/i,
    ru: /(?:^|\s)(влияние|последствие|затронуто)\s+(изменения|модификации|удаления)/i,
    zh: /(影响|变更\S*影响|修改\S*后果|删除\S*结果)/,
    ja: /(への影響|変更\S*影響|削除\S*結果)/,
    ko: /(영향|변경\S*영향|삭제\S*결과)/,
  },

  // HIERARCHY/INHERITANCE
  // P0 Fix: Replaced .* with bounded patterns to prevent catastrophic backtracking
  hierarchy: {
    en: /\b(class\s+hierarchy|inheritance\s+tree|parent\s+class|base\s+class|super\s*class)\s*/i,
    de: /\b(klassenhierarchie|vererbungsbaum|elternklasse|basisklasse|superklasse)\s*/i,
    es: /\b(jerarquía\s+de\s+clases|árbol\s+de\s+herencia|clase\s+padre|clase\s+base|superclase)\s*/i,
    sr: /(?:^|\s)(хијерархија|стабло\s+наслеђивања|родитељска\s+класа|базна\s+класа)/i,
    ru: /(?:^|\s)(иерархия\s+классов|дерево\s+наследования|родительский\s+класс|базовый\s+класс)/i,
    zh: /(类层次|继承树|父类|基类|超类)/,
    ja: /(クラス階層|継承ツリー|親クラス|基底クラス|スーパークラス)/,
    ko: /(클래스\s*계층|상속\s*트리|부모\s*클래스|기본\s*클래스)/,
  },
};

/**
 * SEMANTIC PATTERNS - Detect conceptual/explanatory queries
 *
 * Patterns for: questions, processes, architecture, explanations
 */
export const SEMANTIC_PATTERNS = {
  // QUESTION WORDS - How/Why/What is...
  // Note: \b doesn't work with non-ASCII, so we use (?:^|\s) for non-Latin scripts
  questionWords: {
    en: /\b(how\s+does|how\s+do|how\s+to|how\s+is|why\s+does|why\s+do|why\s+is|what\s+is|what\s+are|explain|describe)\s+/i,
    de: /\b(wie\s+funktioniert|wie\s+macht|warum\s+ist|was\s+ist|erkläre|beschreibe)\s+/i,
    es: /\b(cómo\s+funciona|cómo\s+se|por\s+qué|qué\s+es|explica|describe)\s+/i,
    fr: /\b(comment\s+fonctionne|comment\s+fait|pourquoi|qu['']?est-ce\s+que|expliquer|décrire)\s+/i,
    pt: /\b(como\s+funciona|como\s+faz|por\s+que|o\s+que\s+é|explique|descreva)\s+/i,
    it: /\b(come\s+funziona|come\s+fa|perché|cosa\s+è|spiega|descrivi)\s+/i,
    sr: /(?:^|\s)(како\s+функционише|како\s+ради|зашто|шта\s+је|објасни|опиши)/i,
    ru: /(?:^|\s)(как\s+работает|как\s+сделать|почему|что\s+такое|объясни|опиши)/i,
    uk: /(?:^|\s)(як\s+працює|як\s+зробити|чому|що\s+таке|поясни|опиши)/i,
    zh: /(如何|怎么|为什么|是什么|解释|描述)/,
    ja: /(どのように|どうやって|なぜ|とは何|説明して|説明する)/,
    ko: /(어떻게|왜|무엇|설명해|설명하다)/,
    ar: /(كيف|لماذا|ما هو|اشرح|صف)/,
    el: /(?:^|\s)(πώς|γιατί|τι\s+είναι|εξήγησε|περίγραψε)/i,
    th: /(อย่างไร|ทำไม|คืออะไร|อธิบาย)/,
    he: /(איך|למה|מה זה|הסבר|תאר)/,
    hi: /(कैसे|क्यों|क्या है|समझाइए|वर्णन)/,
    // P1 Fix: Changed \b to (?:^|\s) - \b fails with Vietnamese diacritics
    vi: /(?:^|\s)(như thế nào|tại sao|là gì|giải thích|mô tả)\s*/i,
  },

  // PROCESS/FLOW - Authentication flow, request lifecycle
  processWords: {
    en: /\b(flow|process|lifecycle|workflow|pipeline|sequence|steps?|phases?)\s+/i,
    de: /\b(ablauf|prozess|lebenszyklus|arbeitsablauf|pipeline|sequenz|schritte?|phasen?)\s+/i,
    es: /\b(flujo|proceso|ciclo\s+de\s+vida|flujo\s+de\s+trabajo|secuencia|pasos?|fases?)\s+/i,
    fr: /\b(flux|processus|cycle\s+de\s+vie|workflow|séquence|étapes?|phases?)\s+/i,
    sr: /(?:^|\s)(ток|процес|животни\s+циклус|радни\s+ток|секвенца|кораци?|фазе?)/i,
    ru: /(?:^|\s)(поток|процесс|жизненный\s+цикл|рабочий\s+процесс|последовательность|шаги?|фазы?)/i,
    zh: /(流程|过程|生命周期|工作流|管道|序列|步骤|阶段)/,
    ja: /(フロー|プロセス|ライフサイクル|ワークフロー|パイプライン|シーケンス|ステップ|フェーズ)/,
    ko: /(흐름|프로세스|생명주기|워크플로우|파이프라인|시퀀스|단계)/,
  },

  // ARCHITECTURE/DESIGN - Patterns, architecture, design
  architectureWords: {
    en: /\b(architecture|design\s+pattern|pattern|structure|component|module|layer|tier)\s+/i,
    de: /\b(architektur|entwurfsmuster|muster|struktur|komponente|modul|schicht)\s+/i,
    es: /\b(arquitectura|patrón\s+de\s+diseño|patrón|estructura|componente|módulo|capa)\s+/i,
    fr: /\b(architecture|patron\s+de\s+conception|motif|structure|composant|module|couche)\s+/i,
    sr: /(?:^|\s)(архитектура|шаблон|образац|структура|компонента|модул|слој)/i,
    ru: /(?:^|\s)(архитектура|шаблон\s+проектирования|паттерн|структура|компонент|модуль|слой)/i,
    zh: /(架构|设计模式|模式|结构|组件|模块|层)/,
    ja: /(アーキテクチャ|デザインパターン|パターン|構造|コンポーネント|モジュール|レイヤー)/,
    ko: /(아키텍처|디자인\s*패턴|패턴|구조|컴포넌트|모듈|레이어)/,
  },

  // CONCEPT WORDS - Error handling, validation, etc.
  // Note: Slavic languages use prefix matching (7+ chars) to handle grammatical cases
  // e.g., "аутентификац" matches аутентификација/аутентификације/аутентификацији
  conceptWords: {
    en: /\b(error\s+handling|validation|authentication|authorization|caching|logging|security|performance|optimization|database|queries?|token|management|logic|session|configuration)\s*/i,
    de: /\b(fehlerbehandlung|validierung|authentifizierung|autorisierung|caching|protokollierung|sicherheit|leistung|optimierung)\s*/i,
    es: /\b(manejo\s+de\s+errores|validación|autenticación|autorización|caché|registro|seguridad|rendimiento|optimización)\s*/i,
    fr: /\b(gestion\s+des\s+erreurs|validation|authentification|autorisation|mise\s+en\s+cache|journalisation|sécurité|performance|optimisation)\s*/i,
    // Serbian: prefix matching for grammatical cases + added логик (logic), процес, механизам
    sr: /(?:^|\s)(обрад\w*\s+грешак|валидациј\w*|аутентификациј\w*|ауторизациј\w*|кеширањ\w*|логовањ\w*|безбедност\w*|перформанс\w*|оптимизациј\w*|логик\w*|процес\w*|механизам\w*|пријав\w*|сесиј\w*)/i,
    // Russian: prefix matching for grammatical cases + added логик (logic), процесс, механизм
    ru: /(?:^|\s)(обработк\w*\s+ошибок|валидациj?\w*|аутентификациj?\w*|авторизациj?\w*|кэшировани\w*|логировани\w*|безопасност\w*|производительност\w*|оптимизациj?\w*|логик\w*|процесс?\w*|механизм\w*|авториз\w*|сесси\w*)/i,
    // Ukrainian: prefix matching
    uk: /(?:^|\s)(обробк\w*\s+помилок|валідаці\w*|автентифікаці\w*|авторизаці\w*|кешуванн\w*|логуванн\w*|безпек\w*|продуктивніст\w*|оптимізаці\w*|логік\w*|процес\w*|механізм\w*)/i,
    zh: /(错误处理|验证|认证|授权|缓存|日志|安全|性能|优化|数据库|查询|令牌|管理|逻辑)/,
    ja: /(エラー処理|バリデーション|認証|認可|キャッシュ|ロギング|セキュリティ|パフォーマンス|最適化|データベース|クエリ|トークン|管理|ロジック)/,
    ko: /(오류\s*처리|검증|인증|권한|캐싱|로깅|보안|성능|최적화|데이터베이스|쿼리|토큰|관리|로직)/,
    // Hindi: added common concept words
    hi: /(त्रुटि\s*हैंडलिंग|सत्यापन|प्रमाणीकरण|प्राधिकरण|कैशिंग|लॉगिंग|सुरक्षा|प्रदर्शन|अनुकूलन|डेटाबेस|क्वेरी|टोकन|प्रबंधन|तर्क)/,
    // Thai: added common concept words
    th: /(การจัดการข้อผิดพลาด|การตรวจสอบ|การยืนยันตัวตน|การอนุญาต|แคช|การบันทึก|ความปลอดภัย|ประสิทธิภาพ|การเพิ่มประสิทธิภาพ|ฐานข้อมูล|คิวรี|โทเค็น|การจัดการ|ตรรกะ)/,
    // Hebrew: added common concept words
    he: /(טיפול\s*בשגיאות|אימות|הרשאה|מטמון|רישום|אבטחה|ביצועים|אופטימיזציה|מסד\s*נתונים|שאילתה|אסימון|ניהול|לוגיקה)/,
    // Vietnamese: added common concept words
    vi: /(?:^|\s)(xử\s*lý\s*lỗi|xác\s*thực|ủy\s*quyền|bộ\s*nhớ\s*đệm|ghi\s*nhật\s*ký|bảo\s*mật|hiệu\s*suất|tối\s*ưu\s*hóa|cơ\s*sở\s*dữ\s*liệu|truy\s*vấn|mã\s*thông\s*báo|quản\s*lý|logic)/i,
    // Arabic: added common concept words
    ar: /(معالجة\s*الأخطاء|التحقق|المصادقة|التفويض|التخزين\s*المؤقت|التسجيل|الأمان|الأداء|التحسين|قاعدة\s*البيانات|استعلام|رمز|إدارة|منطق)/,
    // Greek: added common concept words
    el: /(?:^|\s)(χειρισμός\s*σφαλμάτων|επικύρωση|πιστοποίηση|εξουσιοδότηση|προσωρινή\s*αποθήκευση|καταγραφή|ασφάλεια|απόδοση|βελτιστοποίηση|βάση\s*δεδομένων|ερώτημα|διακριτικό|διαχείριση|λογική)/i,
  },
};

/**
 * Check if query matches any structural pattern
 *
 * P0 Fix: Added try/catch error handling and length check to prevent DoS
 *
 * @param {string} query - Query to check
 * @returns {{matched: boolean, type: string|null, language: string|null}}
 */
export function matchesStructuralPattern(query) {
  if (!query || typeof query !== 'string') {
    return { matched: false, type: null, language: null };
  }

  // P0 Fix: Length check to prevent DoS via long inputs
  if (query.length > MAX_QUERY_LENGTH) {
    return { matched: false, type: null, language: null };
  }

  try {
    for (const [type, patterns] of Object.entries(STRUCTURAL_PATTERNS)) {
      for (const [lang, pattern] of Object.entries(patterns)) {
        if (pattern.test(query)) {
          return { matched: true, type, language: lang };
        }
      }
    }
  } catch (error) {
    // P0 Fix: Catch regex errors (e.g., stack overflow from backtracking)
    console.error(`[multilingual-patterns] matchesStructuralPattern error: ${error.message}`);
    return { matched: false, type: null, language: null };
  }

  return { matched: false, type: null, language: null };
}

/**
 * Check if query matches any semantic pattern
 *
 * P0 Fix: Added try/catch error handling and length check to prevent DoS
 *
 * @param {string} query - Query to check
 * @returns {{matched: boolean, type: string|null, language: string|null}}
 */
export function matchesSemanticPattern(query) {
  if (!query || typeof query !== 'string') {
    return { matched: false, type: null, language: null };
  }

  // P0 Fix: Length check to prevent DoS via long inputs
  if (query.length > MAX_QUERY_LENGTH) {
    return { matched: false, type: null, language: null };
  }

  try {
    for (const [type, patterns] of Object.entries(SEMANTIC_PATTERNS)) {
      for (const [lang, pattern] of Object.entries(patterns)) {
        if (pattern.test(query)) {
          return { matched: true, type, language: lang };
        }
      }
    }
  } catch (error) {
    // P0 Fix: Catch regex errors (e.g., stack overflow from backtracking)
    console.error(`[multilingual-patterns] matchesSemanticPattern error: ${error.message}`);
    return { matched: false, type: null, language: null };
  }

  return { matched: false, type: null, language: null };
}

/**
 * Check if query has structural keywords in non-English language
 * (Feature 27 for query router)
 *
 * @param {string} query - Query to check
 * @returns {boolean}
 */
export function hasStructuralKeywordNonEn(query) {
  const result = matchesStructuralPattern(query);
  return result.matched && result.language !== 'en';
}

/**
 * Check if query has semantic keywords in non-English language
 * (Feature 28 for query router)
 *
 * @param {string} query - Query to check
 * @returns {boolean}
 */
export function hasSemanticKeywordNonEn(query) {
  const result = matchesSemanticPattern(query);
  return result.matched && result.language !== 'en';
}

/**
 * Check if query has cross-script concept pattern (Feature 29 for query router)
 * Detects: identifier in script A + concept words in script B
 *
 * This is a strong HYBRID signal - mixing identifier lookup with conceptual context
 * in different scripts.
 *
 * Examples:
 *   "समयट्रैकर security checks" → Hindi identifier + English concept
 *   "database queries in समयट्रैकर" → English concept + Hindi identifier
 *   "МониторПроцеса логика" → Cyrillic identifier + Cyrillic concept (same script, no match)
 *
 * @param {string} query - Query to check
 * @returns {boolean}
 */
export function hasCrossScriptConcept(query) {
  if (!query || typeof query !== 'string' || query.length > 500) {
    return false;
  }

  // Detect scripts present in query
  const hasLatin = /[a-zA-Z]{2,}/.test(query);
  const hasCyrillic = /[\u0400-\u04FF]{2,}/.test(query);
  const hasDevanagari = /[\u0900-\u097F]{2,}/.test(query);  // Hindi
  const hasThai = /[\u0E00-\u0E7F]{2,}/.test(query);
  const hasHebrew = /[\u0590-\u05FF]{2,}/.test(query);
  const hasArabic = /[\u0600-\u06FF]{2,}/.test(query);
  const hasGreek = /[\u0370-\u03FF]{2,}/.test(query);
  const hasCJK = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]{2,}/.test(query);
  const hasVietnamese = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]{2,}/i.test(query);

  // Count how many scripts are present
  const scripts = [hasLatin, hasCyrillic, hasDevanagari, hasThai, hasHebrew, hasArabic, hasGreek, hasCJK, hasVietnamese];
  const scriptCount = scripts.filter(Boolean).length;

  // Need at least 2 different scripts
  if (scriptCount < 2) {
    return false;
  }

  // Check for concept words in at least one of the scripts
  // Latin concept words (English)
  const hasLatinConcept = /\b(flow|process|mechanism|logic|algorithm|authentication|validation|security|management|database|queries?|token|checks?|handling|session|error|login|password|user|data|handles?)\b/i.test(query);

  // Non-Latin concept detection via semantic patterns
  const semanticMatch = matchesSemanticPattern(query);
  const hasNonLatinConcept = semanticMatch.matched && semanticMatch.language !== 'en';

  // Cross-script concept: Latin concept + non-Latin identifier OR non-Latin concept + Latin identifier
  if (hasLatin && hasLatinConcept && (hasCyrillic || hasDevanagari || hasThai || hasHebrew || hasArabic || hasGreek || hasCJK || hasVietnamese)) {
    return true;  // English concept + non-Latin identifier
  }

  if (hasNonLatinConcept && hasLatin) {
    return true;  // Non-Latin concept + Latin identifier
  }

  // Cyrillic concept + non-Cyrillic non-Latin identifier
  if (hasCyrillic && !hasLatin && (hasDevanagari || hasThai || hasHebrew || hasArabic || hasGreek || hasCJK)) {
    const cyrillicSemanticMatch = matchesSemanticPattern(query);
    if (cyrillicSemanticMatch.matched && (cyrillicSemanticMatch.language === 'sr' || cyrillicSemanticMatch.language === 'ru' || cyrillicSemanticMatch.language === 'uk')) {
      return true;
    }
  }

  return false;
}

/**
 * Detect query language based on patterns
 *
 * @param {string} query - Query to analyze
 * @returns {string} - Detected language code or 'unknown'
 */
export function detectQueryLanguage(query) {
  // Check structural patterns first
  const structural = matchesStructuralPattern(query);
  if (structural.matched) {
    return structural.language;
  }

  // Check semantic patterns
  const semantic = matchesSemanticPattern(query);
  if (semantic.matched) {
    return semantic.language;
  }

  // Default to English if no pattern matched
  return 'unknown';
}

/**
 * Get all supported languages for a pattern type
 *
 * @param {string} type - Pattern type ('structural' or 'semantic')
 * @returns {string[]} - Array of language codes
 */
export function getSupportedLanguages(type = 'all') {
  const languages = new Set();

  if (type === 'structural' || type === 'all') {
    for (const patterns of Object.values(STRUCTURAL_PATTERNS)) {
      for (const lang of Object.keys(patterns)) {
        languages.add(lang);
      }
    }
  }

  if (type === 'semantic' || type === 'all') {
    for (const patterns of Object.values(SEMANTIC_PATTERNS)) {
      for (const lang of Object.keys(patterns)) {
        languages.add(lang);
      }
    }
  }

  return [...languages].sort();
}

// Language code to name mapping
export const LANGUAGE_NAMES = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  sr: 'Serbian',
  ru: 'Russian',
  uk: 'Ukrainian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  el: 'Greek',
  th: 'Thai',
  he: 'Hebrew',
  hi: 'Hindi',
  vi: 'Vietnamese',
};
