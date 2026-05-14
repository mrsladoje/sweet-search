# ss-search Stage 5 boost-sweep summary

Generated: 2026-05-14T10:40:06.335Z

## Per-boost dev numbers (90 ast-tester golds, agentic strategy)

| boost | PASS | PARTIAL | FAIL | fr@5 |
|---|---|---|---|---|
| 1.15 | 55 | 18 | 17 | 85/90 |
| 1.25 | 55 | 17 | 18 | 85/90 |
| 1.3 | 53 | 18 | 19 | 85/90 |

## Per-gold flips vs boost=1.15

### boost=1.25: 1 flips

- ~ shift **CS-002** PARTIAL → FAIL: `libs/server/Resp/RespServerSession.cs::LatencyMetrics` → `libs/server/Resp/BasicCommands.cs::RespServerSession`

### boost=1.3: 3 flips

- ~ shift **CS-002** PARTIAL → FAIL: `libs/server/Resp/RespServerSession.cs::LatencyMetrics` → `libs/server/Resp/BasicCommands.cs::RespServerSession`
- ⚠ regress **JV-002** PASS → PARTIAL: `gson/src/main/java/com/google/gson/internal/ConstructorConstructor.java::get` → `gson/src/main/java/com/google/gson/internal/ConstructorConstructor.java::ConstructorConstructor`
- ⚠ regress **PHP-004** PASS → FAIL: `Slim/App.php::App` → `Slim/Routing/RouteResolver.php::RouteResolver`
