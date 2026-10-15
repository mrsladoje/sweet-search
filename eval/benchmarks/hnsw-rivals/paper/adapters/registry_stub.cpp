// paper::registry() for adapter_test only; rivals5.cpp defines its own.
#include "../adapter.h"
namespace paper {
std::map<std::string, Factory>& registry() { static std::map<std::string, Factory> r; return r; }
}
