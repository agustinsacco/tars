# create-command Guide Skill

This skill allows Tars to create custom slash commands for Gemini CLI extensions.

## Instructions

1.  **Locate Extension**: Navigate to the target extension directory (e.g., `~/.gemini/extensions/<name>`).
2.  **Create Directory**: Create a `commands` directory if it doesn't exist, and a subdirectory for the command group (e.g., `commands/utils`).
    - The directory structure determines the command name: `commands/<group>/<name>.toml` becomes `/<group>:<name>`.
3.  **Create TOML File**: Create a `.toml` file with the command definition.
4.  **Define Content**:
    - `prompt`: The text sent to the LLM.
    - `{{args}}`: Placeholder for user arguments.
    - `!{command}`: Syntax to execute shell commands and inject output.

## Template

```toml
# commands/utils/summarize.toml

prompt = """
Please summarize the content of the following file:

File Content:
!{cat {{args}}}
"""
```

## Usage

After creating the file, restart the Gemini CLI (or re-link extension). Default commands are available immediately in `commands/`.
The command above would be invoked as `/utils:summarize path/to/file`.
