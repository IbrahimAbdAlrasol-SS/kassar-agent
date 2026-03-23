# TOOLS

Available tools and when to use them:

| Tool          | Risk   | Input schema                              | Use when                                      |
|---------------|--------|-------------------------------------------|-----------------------------------------------|
| run_terminal  | HIGH   | {"command":"..."}                         | run, execute, test, build, install, compile   |
| read_file     | LOW    | {"path":"..."}                            | read, show, display, check file contents      |
| write_file    | MEDIUM | {"path":"...","content":"..."}            | create, write, save, update file              |
| open_app      | MEDIUM | {"app":"..."}                             | open, launch application                      |
| search_web    | LOW    | {"query":"..."}                           | search, find, look up, latest news, facts     |

## Do NOT use a tool when:
- The user is chatting or reacting
- You can answer directly from knowledge
- The request is a question about yourself or your capabilities
- The request is ambiguous (ask first)
