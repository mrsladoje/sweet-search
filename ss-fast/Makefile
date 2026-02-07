# Makefile for ss-fast - Blazing fast search client

CC = gcc
CFLAGS = -O3 -march=native -flto -Wall -Wextra
LDFLAGS = -s

TARGET = ss-fast
SRC = ss-fast.c

.PHONY: all clean install

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<
	@echo "Built $(TARGET) - size: $$(ls -lh $(TARGET) | awk '{print $$5}')"

# Debug build with symbols
debug: CFLAGS = -g -O0 -Wall -Wextra -DDEBUG
debug: LDFLAGS =
debug: $(TARGET)

# Minimal size build
small: CFLAGS = -Os -s
small: $(TARGET)
	@strip $(TARGET)
	@echo "Minimal $(TARGET) - size: $$(ls -lh $(TARGET) | awk '{print $$5}')"

clean:
	rm -f $(TARGET)

install: $(TARGET)
	cp $(TARGET) ../ss
	@echo "Installed as ../ss (14KB binary)"

# Test the binary
test: $(TARGET)
	@echo "Testing ss-fast..."
	@./$(TARGET) --help
	@echo ""
	@if [ -S /tmp/search.sock ]; then \
		echo "=== Server running, testing queries... ==="; \
		echo ""; \
		echo "1. Basic query:"; \
		./$(TARGET) "AuthService" -k 3; \
		echo ""; \
		echo "2. Summary mode:"; \
		./$(TARGET) "authentication" -s -k 3; \
		echo ""; \
		echo "3. Force lexical:"; \
		./$(TARGET) "BotDetection" -m lexical -k 2; \
	else \
		echo "Server not running (socket not found)"; \
	fi
