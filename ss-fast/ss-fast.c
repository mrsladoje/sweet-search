/*
 * ss-fast.c - Blazing fast search client (~2-5ms)
 *
 * Full-featured C client for sweet-search server with all Node.js flags.
 * Connects via Unix socket for maximum speed.
 *
 * Usage: ss "query" [options]
 *
 * Options:
 *   -k, --top <n>       Number of results (default: 10)
 *   -m, --mode <mode>   Search mode: auto, lexical, semantic, hybrid
 *   -s, --summary       Summary-first output (10x token reduction)
 *       --mid           Middle-res output (5x token reduction)
 *   -j, --json          JSON output
 *       --no-expand     Disable graph expansion
 *       --no-rerank     Disable reranking
 *   -f, --fusion <type> Fusion method: cc (default) or rrf
 *       --no-late-interaction  Disable late interaction (enabled by default from config)
 *       --stop          Stop the search server
 *   -v, --verbose       Verbose output
 *   -h, --help          Show help
 *
 * Compile: gcc -O3 -march=native -flto -s -o ss ss-fast.c
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <errno.h>
#include <getopt.h>

#define SOCKET_PATH "/tmp/sweet-search.sock"
#define BUFFER_SIZE 16384

/* ANSI color codes */
#define D1 "\x1b[48;5;17m"    /* Dark blue background */
#define D2 "\x1b[48;5;24m"    /* Lighter blue background */
#define FA "\x1b[1;38;5;104m" /* Purple text (bold) */
#define FW "\x1b[1;38;5;231m" /* White text (bold) */
#define FG "\x1b[38;5;114m"   /* Green text */
#define FY "\x1b[38;5;220m"   /* Yellow text */
#define R  "\x1b[0m"          /* Reset */

/* Pixel art header */
static const char *L1 = "█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█";
static const char *L2 = "▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█";

/* Options structure */
typedef struct {
    const char *query;
    const char *mode;
    const char *fusion;
    int top_k;
    int summary;
    int mid;
    int json;
    int no_expand;
    int no_rerank;
    int no_late_interaction;  /* Disable late interaction (enabled by default from server config) */
    int stop;
    int verbose;
    int help;
} Options;

/* Long options for getopt_long */
static struct option long_options[] = {
    {"top",        required_argument, 0, 'k'},
    {"mode",       required_argument, 0, 'm'},
    {"summary",    no_argument,       0, 's'},
    {"mid",        no_argument,       0, 'M'},
    {"json",       no_argument,       0, 'j'},
    {"no-expand",  no_argument,       0, 'E'},
    {"no-rerank",  no_argument,       0, 'R'},
    {"fusion",     required_argument, 0, 'f'},
    {"no-late-interaction", no_argument, 0, 'C'},  /* Disable late interaction */
    {"stop",       no_argument,       0, 'S'},
    {"verbose",    no_argument,       0, 'v'},
    {"help",       no_argument,       0, 'h'},
    {0, 0, 0, 0}
};

/* URL-encode a string. Returns malloc'd buffer, caller must free. */
static char *url_encode(const char *s) {
    size_t len = strlen(s);
    char *result = malloc(len * 3 + 1);
    if (!result) return NULL;

    char *p = result;
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' ||
            c == '.' || c == '~') {
            *p++ = c;
        } else if (c == ' ') {
            *p++ = '%'; *p++ = '2'; *p++ = '0';
        } else {
            p += sprintf(p, "%%%02X", c);
        }
    }
    *p = '\0';
    return result;
}

/* Count UTF-8 characters (for proper padding) */
static size_t utf8_strlen(const char *s) {
    size_t count = 0;
    while (*s) {
        if ((*s & 0xC0) != 0x80) count++;
        s++;
    }
    return count;
}

/* Print the header with query */
static void print_header(const char *query) {
    size_t query_len = utf8_strlen(query) + 2;
    int padding = (query_len < 32) ? (int)(32 - query_len) : 0;

    printf("\n");
    printf(D1 "  " FA "%s" R D1 "%*s" R "\n", L1, 32, "");
    printf(D1 "  " FA "%s" R D2 "%*s" FW "\"%s\"" R D1 "  " R "\n",
           L2, padding, "", query);
}

/* Print usage information */
static void print_usage(const char *prog) {
    printf(FA "%s\n%s" R "\n\n", L1, L2);
    printf(FW "Usage:" R " %s \"query\" [options]\n\n", prog);
    printf(FW "Options:" R "\n");
    printf("  -k, --top <n>       Number of results (default: 10)\n");
    printf("  -m, --mode <mode>   Search mode: auto, lexical, semantic, hybrid\n");
    printf("  -s, --summary       Summary-first output " FY "(10x token reduction)" R "\n");
    printf("      --mid           Middle-res output " FY "(5x token reduction)" R "\n");
    printf("  -j, --json          JSON output\n");
    printf("      --no-expand     Disable graph expansion\n");
    printf("      --no-rerank     Disable reranking\n");
    printf("  -f, --fusion <type> Fusion method: cc (default) or rrf\n");
    printf("      --no-late-interaction  Disable late interaction " FY "(enabled by default)" R "\n");
    printf("      --stop          Stop the search server\n");
    printf("  -v, --verbose       Verbose output\n");
    printf("  -h, --help          Show this help\n");
    printf("\n" FW "Examples:" R "\n");
    printf("  %s \"AuthService\"                    " FG "# Lexical search" R "\n", prog);
    printf("  %s \"how does auth work\" -s          " FG "# Semantic + summary" R "\n", prog);
    printf("  %s \"BotDetection\" -k 5 -m lexical   " FG "# 5 results, force lexical" R "\n", prog);
    printf("  %s \"employee\" --mid                 " FG "# Middle-res view" R "\n", prog);
    printf("  %s --stop                            " FG "# Stop server" R "\n", prog);
}

/* Parse command-line arguments */
static int parse_args(int argc, char *argv[], Options *opts) {
    /* Defaults */
    opts->query = NULL;
    opts->mode = "auto";
    opts->fusion = "cc";
    opts->top_k = 10;
    opts->summary = 0;
    opts->mid = 0;
    opts->json = 0;
    opts->no_expand = 0;
    opts->no_rerank = 0;
    opts->no_late_interaction = 0;  /* Late interaction enabled by default (server config) */
    opts->stop = 0;
    opts->verbose = 0;
    opts->help = 0;

    int opt;
    int option_index = 0;

    /* Reset getopt */
    optind = 1;

    while ((opt = getopt_long(argc, argv, "k:m:sjf:vhMERC", long_options, &option_index)) != -1) {
        switch (opt) {
            case 'k':
                opts->top_k = atoi(optarg);
                if (opts->top_k <= 0) opts->top_k = 10;
                break;
            case 'm':
                opts->mode = optarg;
                break;
            case 's':
                opts->summary = 1;
                break;
            case 'M':
                opts->mid = 1;
                break;
            case 'j':
                opts->json = 1;
                break;
            case 'E':
                opts->no_expand = 1;
                break;
            case 'R':
                opts->no_rerank = 1;
                break;
            case 'f':
                opts->fusion = optarg;
                break;
            case 'C':
                opts->no_late_interaction = 1;
                break;
            case 'S':
                opts->stop = 1;
                break;
            case 'v':
                opts->verbose = 1;
                break;
            case 'h':
                opts->help = 1;
                break;
            default:
                return -1;
        }
    }

    /* Non-option arguments (query) */
    if (optind < argc) {
        opts->query = argv[optind];
    }

    return 0;
}

/* Build URL with all query parameters */
static char *build_url(const Options *opts, char *buffer, size_t bufsize) {
    char *encoded_query = url_encode(opts->query);
    if (!encoded_query) return NULL;

    /* Start with base */
    int len = snprintf(buffer, bufsize, "/search?q=%s&k=%d&format=%s",
                       encoded_query, opts->top_k,
                       opts->json ? "json" : "text");
    free(encoded_query);

    /* Add mode if not auto */
    if (strcmp(opts->mode, "auto") != 0) {
        len += snprintf(buffer + len, bufsize - len, "&mode=%s", opts->mode);
    }

    /* Add summary/mid */
    if (opts->summary) {
        len += snprintf(buffer + len, bufsize - len, "&summary=true");
    }
    if (opts->mid) {
        len += snprintf(buffer + len, bufsize - len, "&mid=true");
    }

    /* Add search options */
    if (opts->no_expand) {
        len += snprintf(buffer + len, bufsize - len, "&expand=false");
    }
    if (opts->no_rerank) {
        len += snprintf(buffer + len, bufsize - len, "&rerank=false");
    }
    if (strcmp(opts->fusion, "cc") != 0) {
        len += snprintf(buffer + len, bufsize - len, "&fusion=%s", opts->fusion);
    }
    /* Only send late-interaction param if explicitly disabling (server defaults to config) */
    if (opts->no_late_interaction) {
        len += snprintf(buffer + len, bufsize - len, "&late-interaction=false");
    }

    return buffer;
}

/* Send request to server and print response */
static int do_request(const char *path, int print_header_flag, const char *query) {
    int sock_fd;
    struct sockaddr_un addr;
    char request[2048];
    char buffer[BUFFER_SIZE];
    ssize_t n;
    int headers_done = 0;
    char *body_start;

    /* Check if socket exists */
    if (access(SOCKET_PATH, F_OK) != 0) {
        fprintf(stderr, FA "Error:" R " Socket %s not found\n", SOCKET_PATH);
        fprintf(stderr, "Start server: node sweet-search.js --serve\n");
        return 1;
    }

    /* Print header if requested */
    if (print_header_flag && query) {
        print_header(query);
    }

    /* Create socket */
    sock_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock_fd < 0) {
        fprintf(stderr, FA "Error:" R " Failed to create socket: %s\n", strerror(errno));
        return 1;
    }

    /* Connect to server */
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);

    if (connect(sock_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        fprintf(stderr, FA "Error:" R " Failed to connect: %s\n", strerror(errno));
        close(sock_fd);
        return 1;
    }

    /* Build and send HTTP request */
    n = snprintf(request, sizeof(request),
        "GET %s HTTP/1.0\r\nHost: l\r\n\r\n", path);

    if (write(sock_fd, request, n) != n) {
        fprintf(stderr, FA "Error:" R " Failed to send request: %s\n", strerror(errno));
        close(sock_fd);
        return 1;
    }

    /* Note: Don't shutdown(SHUT_WR) - it breaks async responses like summary mode.
     * HTTP/1.0 server will close connection after response, signaling EOF. */

    /* Read response and skip HTTP headers, stream body to stdout */
    while ((n = read(sock_fd, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[n] = '\0';

        if (!headers_done) {
            body_start = strstr(buffer, "\r\n\r\n");
            if (body_start) {
                headers_done = 1;
                body_start += 4;
                if (*body_start) {
                    fwrite(body_start, 1, n - (body_start - buffer), stdout);
                }
            }
        } else {
            fwrite(buffer, 1, n, stdout);
        }
    }

    if (n < 0) {
        fprintf(stderr, FA "Error:" R " Failed to read response: %s\n", strerror(errno));
        close(sock_fd);
        return 1;
    }

    fflush(stdout);
    close(sock_fd);
    return 0;
}

int main(int argc, char *argv[]) {
    Options opts;
    char url_buffer[2048];

    /* Parse arguments */
    if (parse_args(argc, argv, &opts) != 0) {
        print_usage(argv[0]);
        return 1;
    }

    /* Handle --help */
    if (opts.help) {
        print_usage(argv[0]);
        return 0;
    }

    /* Handle --stop */
    if (opts.stop) {
        printf(FA "Stopping server..." R "\n");
        return do_request("/stop", 0, NULL);
    }

    /* Check for query */
    if (!opts.query || opts.query[0] == '\0') {
        print_usage(argv[0]);
        return 0;
    }

    /* Verbose output */
    if (opts.verbose) {
        printf(FG "Query:" R " %s\n", opts.query);
        printf(FG "Mode:" R " %s\n", opts.mode);
        printf(FG "Top K:" R " %d\n", opts.top_k);
        if (opts.summary) printf(FG "Format:" R " summary\n");
        if (opts.mid) printf(FG "Format:" R " mid\n");
        if (opts.no_expand) printf(FG "Graph expansion:" R " disabled\n");
        if (opts.no_rerank) printf(FG "Reranking:" R " disabled\n");
        if (opts.no_late_interaction) printf(FG "Late Interaction:" R " disabled\n");
        printf("\n");
    }

    /* Build URL */
    if (!build_url(&opts, url_buffer, sizeof(url_buffer))) {
        fprintf(stderr, FA "Error:" R " Failed to build URL\n");
        return 1;
    }

    /* Send request */
    return do_request(url_buffer, !opts.json, opts.query);
}
