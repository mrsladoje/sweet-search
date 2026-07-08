/**
 * Entity Extraction Tests - Batch 1
 *
 * Tests for C, C++, PHP, Swift, Scala:
 * - Entity extraction from language patterns
 * - Relationship extraction (imports, includes, extends)
 * - skipCallObjects filtering
 */

import { describe, it, expect } from 'vitest';
import { GraphExtractor } from '../../core/graph/index.js';

const extractor = new GraphExtractor({ projectRoot: '/test', useTreeSitter: false });

// =============================================================================
// C LANGUAGE
// =============================================================================

describe('C language', () => {
  it('extracts entities: macro, struct, enum, function', async () => {
    const result = await extractor.extractFromFile('/test/app.c', `
#include <stdio.h>
#include "utils.h"
#define MAX_SIZE 100
typedef struct Node Node;
struct Point {
  int x, y;
};
enum Color { RED, GREEN, BLUE };
int main(int argc, char *argv[]) {
  printf("hello");
  server.start();
}
`);
    expect(result.entities.some(e => e.type === 'macro' && e.name === 'MAX_SIZE')).toBe(true);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Point')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Color')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'main')).toBe(true);
  });

  it('extracts relationships: includes and method calls', async () => {
    const result = await extractor.extractFromFile('/test/app.c', `
#include <stdio.h>
#include "utils.h"
int main() {
  printf("hello");
  server.start();
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'stdio.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'utils.h')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'server.start')).toBe(true);
  });

  it('filters skipCallObjects: printf, malloc, etc', async () => {
    const result = await extractor.extractFromFile('/test/app.c', `
int main() {
  printf("test");
  fprintf(stderr, "error");
  malloc(100);
  server.start();
}
`);
    expect(result.relationships.some(r => r.target_name === 'printf')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'fprintf')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'malloc')).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'server.start')).toBe(true);
  });
});

// =============================================================================
// C++ LANGUAGE
// =============================================================================

describe('C++ language', () => {
  it('extracts entities: namespace, class, enum', async () => {
    const result = await extractor.extractFromFile('/test/app.cpp', `
#include <iostream>
namespace app {
class Server : public Base {
  void start() {
    cout << "starting";
    client.connect();
  }
};
enum class Status { OK, ERROR };
}
`);
    expect(result.entities.some(e => e.type === 'namespace' && e.name === 'app')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'Server')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
  });

  it('extracts relationships: includes and inheritance', async () => {
    const result = await extractor.extractFromFile('/test/app.cpp', `
#include <iostream>
namespace app {
class Server : public Base {
  void start() {
    client.connect();
  }
};
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'iostream')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Base')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'client.connect')).toBe(true);
  });

  it('filters skipCallObjects: cout, cerr, std, etc', async () => {
    const result = await extractor.extractFromFile('/test/app.cpp', `
void process() {
  cout << "message";
  cerr << "error";
  std::endl;
  printf("test");
  client.connect();
}
`);
    expect(result.relationships.some(r => r.target_name === 'cout')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'cerr')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'std')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'printf')).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'client.connect')).toBe(true);
  });

  it('extracts out-of-line qualified method/ctor definitions (Allman braces, multi-line params)', async () => {
    const result = await extractor.extractFromFile('/test/name_constraint.cpp', `
#include <botan/pkix_types.h>

GeneralName::GeneralName(const std::string& str) : GeneralName()
   {
   m_type = str;
   }

GeneralName::MatchResult GeneralName::matches(const X509_Certificate& cert) const
   {
   return MatchResult::All;
   }

bool GeneralName::matches_dns(const std::string& nam) const
   {
   return nam == m_name;
   }

void Name_Constraints::validate(const X509_Certificate& subject,
                                const X509_Certificate& issuer) const
   {
   subject.matches_dns(issuer.name());
   }
`);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'matches')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'matches_dns')).toBe(true);
    expect(result.entities.some(e => e.type === 'method' && e.name === 'validate')).toBe(true);
    expect(result.entities.some(e => e.type === 'constructor' && e.name === 'GeneralName')).toBe(true);
    // spans must reach the closing brace (Allman style, brace on its own line)
    const m = result.entities.find(e => e.type === 'method' && e.name === 'matches_dns');
    expect(m.end_line).toBeGreaterThan(m.start_line);
    // statement-position qualified calls must NOT become entities
    expect(result.entities.some(e => e.name === 'matches' && e.start_line > m.start_line)).toBe(false);
  });
});

// =============================================================================
// PHP LANGUAGE
// =============================================================================

describe('PHP language', () => {
  it('extracts entities: trait, class, function, interface', async () => {
    const result = await extractor.extractFromFile('/test/app.php', `
namespace App\\Services;
use App\\Models\\User;
trait Cacheable {
  public function cache() {}
}
class UserService extends BaseService {
  public function find(int $id): User {
    echo "finding";
    $this->repo->findById($id);
    logger->info("found");
  }
}
interface Repository {
  public function findAll(): array;
}
`);
    expect(result.entities.some(e => e.type === 'trait' && e.name === 'Cacheable')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'UserService')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'find')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'cache')).toBe(true);
    expect(result.entities.some(e => e.type === 'interface' && e.name === 'Repository')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'findAll')).toBe(true);
  });

  it('extracts relationships: use, namespace, method calls', async () => {
    const result = await extractor.extractFromFile('/test/app.php', `
namespace App\\Services;
use App\\Models\\User;
class UserService {
  public function find() {
    logger->info("found");
  }
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'App\\Models\\User')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'App\\Services')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'logger.info')).toBe(true);
  });

  it('filters skipCallObjects: echo, $this, self, parent, etc', async () => {
    const result = await extractor.extractFromFile('/test/app.php', `
class Test {
  public function process() {
    echo "test";
    print "test";
    var_dump($data);
    $this->repo->find();
    self::helper();
    parent::init();
    static::factory();
    logger->info("test");
  }
}
`);
    expect(result.relationships.some(r => r.target_name === 'echo')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'print')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'var_dump')).toBe(false);
    expect(result.relationships.some(r => r.target_name.includes('$this'))).toBe(false);
    expect(result.relationships.some(r => r.target_name.includes('self'))).toBe(false);
    expect(result.relationships.some(r => r.target_name.includes('parent'))).toBe(false);
    expect(result.relationships.some(r => r.target_name.includes('static'))).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'logger.info')).toBe(true);
  });
});

// =============================================================================
// SWIFT LANGUAGE
// =============================================================================

describe('Swift language', () => {
  it('extracts entities: protocol, class, func, struct, enum, extension', async () => {
    const result = await extractor.extractFromFile('/test/app.swift', `
import Foundation
protocol Codable {}
class User: Codable {
  func validate() {
    print("validating")
    service.check()
  }
}
struct Point {
  var x: Double
  var y: Double
}
enum Status {
  case active
  case inactive
}
extension User {}
`);
    expect(result.entities.some(e => e.type === 'protocol' && e.name === 'Codable')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'func' && e.name === 'validate')).toBe(true);
    expect(result.entities.some(e => e.type === 'struct' && e.name === 'Point')).toBe(true);
    expect(result.entities.some(e => e.type === 'enum' && e.name === 'Status')).toBe(true);
    expect(result.entities.some(e => e.type === 'extension' && e.name === 'User')).toBe(true);
  });

  it('extracts relationships: imports, inheritance, method calls', async () => {
    const result = await extractor.extractFromFile('/test/app.swift', `
import Foundation
protocol Codable {}
class User: Codable {
  func validate() {
    service.check()
  }
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'Foundation')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Codable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'service.check')).toBe(true);
  });

  it('filters skipCallObjects: print, fatalError, String, Int, etc', async () => {
    const result = await extractor.extractFromFile('/test/app.swift', `
func process() {
  print("test")
  fatalError("error")
  precondition(true)
  assert(true)
  let x: String = ""
  let y: Int = 0
  let z: Double = 0.0
  service.check()
}
`);
    expect(result.relationships.some(r => r.target_name === 'print')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'fatalError')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'precondition')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'assert')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'String')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Int')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Double')).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'service.check')).toBe(true);
  });
});

// =============================================================================
// SCALA LANGUAGE
// =============================================================================

describe('Scala language', () => {
  it('extracts entities: trait, case class, def, object', async () => {
    const result = await extractor.extractFromFile('/test/app.scala', `
import scala.collection.mutable
trait Loggable {
  def log(msg: String): Unit
}
case class User(name: String) extends Serializable with Loggable {
  def log(msg: String): Unit = {
    println(msg)
    logger.info(msg)
  }
}
object UserFactory {
  def create(name: String): User = User(name)
}
`);
    expect(result.entities.some(e => e.type === 'trait' && e.name === 'Loggable')).toBe(true);
    expect(result.entities.some(e => e.type === 'class' && e.name === 'User')).toBe(true);
    expect(result.entities.some(e => e.type === 'def' && e.name === 'log')).toBe(true);
    expect(result.entities.some(e => e.type === 'object' && e.name === 'UserFactory')).toBe(true);
    expect(result.entities.some(e => e.type === 'def' && e.name === 'create')).toBe(true);
  });

  it('extracts relationships: imports, extends, with, method calls', async () => {
    const result = await extractor.extractFromFile('/test/app.scala', `
import scala.collection.mutable
trait Loggable {
  def log(msg: String): Unit
}
case class User(name: String) extends Serializable with Loggable {
  def log(msg: String): Unit = {
    logger.info(msg)
  }
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'scala.collection.mutable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Serializable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'extends' && r.target_name === 'Loggable')).toBe(true);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'logger.info')).toBe(true);
  });

  it('filters skipCallObjects: println, print, require, assert, collections, etc', async () => {
    const result = await extractor.extractFromFile('/test/app.scala', `
def process(): Unit = {
  println("test")
  print("test")
  require(true)
  assert(true)
  val s = Seq(1, 2, 3)
  val l = List(1, 2, 3)
  val m = Map("a" -> 1)
  val set = Set(1, 2)
  val opt = Option(1)
  logger.info("test")
}
`);
    expect(result.relationships.some(r => r.target_name === 'println')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'print')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'require')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'assert')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Seq')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'List')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Map')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Set')).toBe(false);
    expect(result.relationships.some(r => r.target_name === 'Option')).toBe(false);
    expect(result.relationships.some(r => r.type === 'calls' && r.target_name === 'logger.info')).toBe(true);
  });
});
