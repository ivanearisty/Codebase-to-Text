# Codebase To Text for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Quickly consolidate your entire workspace or a specific directory/file into a single text file, formatted for easy use with Large Language Models (LLMs) or other analysis tools.

## Acknowledgement

This extension expands on the work of Project Hierarchy Explorer by Jake Demian

## Motivation

Modern LLMs often have large context windows, allowing you to ask questions about significant amounts of code. However, manually copying and pasting files from your codebase is tedious and error-prone. Tools like Cursor or embedded assistants exist, but sometimes you just want a simple text dump of your relevant code.

This extension provides a straightforward way to generate a single text file containing:

1.  A directory structure overview of the included files.
2.  The content of each included file, clearly demarcated.

It intelligently ignores files based on `.gitignore` rules and custom VS Code settings.

## Features

*   **Workspace Export:** Generate output for the entire workspace.
*   **Targeted Export:** Generate output starting from a specific folder or file selected in the Explorer.
*   **Directory Structure:** Includes a text-based tree view of the included files/folders at the beginning of the output.
*   **File Content:** Appends the content of each included file, marked with `// File: <path>` headers.
*   **`.gitignore` Support:** Automatically respects rules found in the `.gitignore` file at the workspace root.
*   **Custom Ignore Patterns:** Define additional glob patterns in VS Code settings (`codebaseToText.ignorePatterns`) to exclude more files/folders (e.g., `**/__pycache__/**`, `**/*.log`).
*   **File Size Limit:** Avoids including excessively large files using the `codebaseToText.maxFileSizeMB` setting.
*   **Basic Binary File Detection:** Attempts to identify and skip likely binary files, replacing their content with a placeholder.
*   **Simple Output:** Generates the result in a new, untitled plaintext file for easy saving or copying.

## Installation

1.  Open Visual Studio Code.
2.  Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3.  Search for "Codebase To Text".
4.  Click "Install".
5.  Reload VS Code if prompted.

## Usage

There are two main ways to use the extension:

**1. Generate from Workspace Root:**

*   Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
*   Type `Codebase To Text` and select `Codebase To Text: Generate Output (Workspace)`.
*   The extension will scan your entire workspace (respecting ignores), generate the structure and content, and open the result in a new untitled tab.

**2. Generate from Specific Path (Folder or File):**

*   In the VS Code Explorer panel, right-click on the desired folder or file.
*   Select `Codebase To Text: Generate Output (From Here)` from the context menu.
*   The extension will process only the selected item (and its children, if it's a folder), respecting ignore rules relative to the workspace root.
*   The output structure and file paths will be relative to the folder you selected. If you selected a single file, only that file's content will be included (no structure tree).
*   The result opens in a new untitled tab.

## Configuration

You can customize the extension's behavior via VS Code settings (File > Preferences > Settings or `Ctrl+,`/`Cmd+,`). Search for "codebaseToText".

*   **`codebaseToText.ignorePatterns`**:
    *   An array of glob patterns for files/folders to ignore *in addition* to `.gitignore`.
    *   Useful for temporary ignores or patterns specific to your local setup.

*   **`codebaseToText.outputFileName`**:
    *   The suggested filename when saving the generated untitled file.
    *   Default: `"codebase-output.txt"`

*   **`codebaseToText.maxFileSizeMB`**:
    *   The maximum size (in Megabytes) for a single file to be included. Files larger than this will be skipped.
    *   Default: `5`

## Ignoring Files

The extension uses two sources for ignore patterns, combining them for the final filter:

1.  **`.gitignore`:** Reads the `.gitignore` file located at the **root** of your workspace folder. Standard `.gitignore` syntax applies. Note: Currently, only the root `.gitignore` is considered.
2.  **VS Code Settings (`codebaseToText.ignorePatterns`):** Reads the array of glob patterns from your User or Workspace settings. This allows for extension-specific ignore rules without modifying your project's `.gitignore`.

Files matching *any* pattern from either source (that isn't negated by a later rule) will be excluded from the output. Skipped files are listed in a summary at the end of the generated output.

## Known Issues & Limitations

*   **Performance:** Generating output for very large codebases with many files can take time and consume memory.
*   **Output Size:** The resulting text file can become very large for substantial projects.
*   **Binary Detection:** The check for binary files is a heuristic (based on non-ASCII character ratio) and may not be 100% accurate.
*   **`.gitignore` Scope:** Only the `.gitignore` file in the workspace root is currently read. Nested `.gitignore` files are not processed.
*   **Encoding:** Assumes files are UTF-8 encoded. Errors may occur with other encodings.

## Contributing

Contributions, issues, and feature requests are welcome! Please feel free to open an issue or submit a pull request on the [GitHub repository](https://github.com/your-username/codebase-to-text). <!-- Replace with your actual repo link -->

## License

This extension is licensed under the [MIT License](LICENSE). <!-- Make sure you have a LICENSE file -->
