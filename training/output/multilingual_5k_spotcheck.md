# Training Data Spot-Check Review

Generated: 2026-01-05T15:34:55.778Z

## Coverage

- **Labels**: SEMANTIC, HYBRID, STRUCTURAL, LEXICAL
- **Languages**: ko, en, ar, he, th, ja, hi, es, ru, vi, de, el, sr
- **Total samples**: 50
- **Edge cases**: 0

## Distribution

### By Label
- SEMANTIC: 15
- HYBRID: 11
- STRUCTURAL: 15
- LEXICAL: 9

### By Language
- ko: 2
- en: 9
- ar: 2
- he: 1
- th: 5
- ja: 7
- hi: 4
- es: 4
- ru: 4
- vi: 3
- de: 3
- el: 3
- sr: 3

## Samples for Review

| # | Query | Label | Language | Source | Notes |
|---|-------|-------|----------|--------|-------|
| 1 | `scheduling 아키텍처` | SEMANTIC | ko | label_stratified |  |
| 2 | `error handling authorization` | SEMANTIC | en | label_stratified |  |
| 3 | `scheduling authentication` | SEMANTIC | ar | label_stratified |  |
| 4 | `response handling authorization` | SEMANTIC | en | label_stratified |  |
| 5 | `steps in transaction management` | SEMANTIC | en | label_stratified |  |
| 6 | `שירותמשתמש API requests` | HYBRID | he | label_stratified |  |
| 7 | `how บริการผู้ใช้ handles user` | HYBRID | th | label_stratified |  |
| 8 | `登录流程 in 세션관리자` | HYBRID | ko | label_stratified |  |
| 9 | `SessionManager session logic` | HYBRID | en | label_stratified |  |
| 10 | `how データハンドラー handles manejo` | HYBRID | ja | label_stratified |  |
| 11 | `callers of प्रक्रियामॉनिटर` | STRUCTURAL | hi | label_stratified |  |
| 12 | `what methods does PhoneValidator use` | STRUCTURAL | en | label_stratified |  |
| 13 | `impact of changing TaskScheduler` | STRUCTURAL | en | label_stratified |  |
| 14 | `プロジェクトサービスの実装` | STRUCTURAL | ja | label_stratified |  |
| 15 | `資格情報ストアの実装` | STRUCTURAL | ja | label_stratified |  |
| 16 | `actualizarUsuario` | LEXICAL | es | label_stratified |  |
| 17 | `متحكمالفريق` | LEXICAL | ar | label_stratified |  |
| 18 | `บริการพนักงาน` | LEXICAL | th | label_stratified |  |
| 19 | `записатьАктивность` | LEXICAL | ru | label_stratified |  |
| 20 | `アクティブな従業員` | LEXICAL | ja | label_stratified |  |
| 21 | `обработатьДокумент` | LEXICAL | ru | language_stratified |  |
| 22 | `вызовы МенеджерСессии` | STRUCTURAL | ru | language_stratified |  |
| 23 | `как работает file upload` | SEMANTIC | ru | language_stratified |  |
| 24 | `Fehlerbehandlung in GestorConfiguracion` | HYBRID | es | language_stratified |  |
| 25 | `diseño de API request` | SEMANTIC | es | language_stratified |  |
| 26 | `llamadores de ValidadorToken` | STRUCTURAL | es | language_stratified |  |
| 27 | `input sanitization security` | SEMANTIC | en | language_stratified |  |
| 28 | `implementations of DocumentManager` | STRUCTURAL | en | language_stratified |  |
| 29 | `response handling structure` | SEMANTIC | en | language_stratified |  |
| 30 | `database queries in समयट्रैकर` | HYBRID | hi | language_stratified |  |
| 31 | `कॉन्फ़िगप्रबंधक` | LEXICAL | hi | language_stratified |  |
| 32 | `implementations of रिपोर्टजनरेटर` | STRUCTURAL | hi | language_stratified |  |
| 33 | `API requests in TạoBáoCáo` | HYBRID | vi | language_stratified |  |
| 34 | `GiámSátQuáTrình authentication process` | HYBRID | vi | language_stratified |  |
| 35 | `how DịchVụXácThực handles обрада` | HYBRID | vi | language_stratified |  |
| 36 | `พนักงานที่ใช้งานอยู่` | LEXICAL | th | language_stratified |  |
| 37 | `response handling lifecycle` | SEMANTIC | th | language_stratified |  |
| 38 | `callees of บริการแจ้งเตือน` | STRUCTURAL | th | language_stratified |  |
| 39 | `warum wird data_validation benötigt` | SEMANTIC | de | language_stratified |  |
| 40 | `warum macht monitoring das` | SEMANTIC | de | language_stratified |  |
| 41 | `validation logic in ProjektService` | HYBRID | de | language_stratified |  |
| 42 | `プロセスモニターを使うのは誰` | STRUCTURAL | ja | language_stratified |  |
| 43 | `image processingアーキテクチャ` | SEMANTIC | ja | language_stratified |  |
| 44 | `loggingプロセス` | SEMANTIC | ja | language_stratified |  |
| 45 | `subclasses of InvoiceGenerator` | STRUCTURAL | el | language_stratified |  |
| 46 | `what methods does TeamController use` | STRUCTURAL | el | language_stratified |  |
| 47 | `callees of TaskScheduler` | STRUCTURAL | el | language_stratified |  |
| 48 | `подкласе од ПланерЗадатака` | STRUCTURAL | sr | language_stratified |  |
| 49 | `обрада грешака за email sending` | SEMANTIC | sr | language_stratified |  |
| 50 | `ЛогерАктивности` | LEXICAL | sr | language_stratified |  |

## Review Checklist

For each sample, verify:

- [ ] **Label correctness**: Does the query match the assigned category?
- [ ] **Language accuracy**: Is the language tag correct?
- [ ] **Query quality**: Is this a realistic query a user would type?
- [ ] **No PII**: No sensitive information in the query

### Feedback Template

```
Sample #[ID]:
- Correct: [Yes/No]
- Suggested label: [if different]
- Notes: [any issues]
```
