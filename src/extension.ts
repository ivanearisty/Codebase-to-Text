import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import ignore, { Ignore } from "ignore"; // Import the ignore library

// Helper function to read .gitignore files
async function readGitIgnore(workspaceRoot: vscode.Uri): Promise<string[]> {
  const gitignorePath = vscode.Uri.joinPath(workspaceRoot, ".gitignore");
  try {
    const raw = await vscode.workspace.fs.readFile(gitignorePath);
    return raw.toString().split(/\r?\n/).filter(line => line.trim() !== "" && !line.startsWith("#"));
  } catch (error) {
    // .gitignore might not exist, which is fine
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return [];
    }
    console.error("Error reading .gitignore:", error);
    vscode.window.showWarningMessage(`Could not read .gitignore: ${error}`);
    return [];
  }
}

// Helper function to build the directory structure string
function buildStructure(files: vscode.Uri[], workspaceRoot: vscode.Uri): string {
  const structure: any = {};

  files.forEach(fileUri => {
    const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath).replace(/\\/g, "/"); // Normalize path separators
    const parts = relativePath.split("/");
    let currentLevel = structure;

    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // It's a file
        currentLevel[part] = null; // Mark as file
      } else {
        // It's a directory
        if (!currentLevel[part]) {
          currentLevel[part] = {};
        }
        currentLevel = currentLevel[part];
      }
    });
  });

  function formatStructure(level: any, indent: string = ""): string {
    let output = "";
    const entries = Object.entries(level).sort(([a], [b]) => a.localeCompare(b)); // Sort entries alphabetically

    entries.forEach(([name, content], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const line = indent + connector + name + "\n";
      output += line;

      if (content !== null) { // It's a directory
        const newIndent = indent + (isLast ? "    " : "│   ");
        output += formatStructure(content, newIndent);
      }
    });
    return output;
  }

  return "Project Structure:\n" + formatStructure(structure) + "\n---\n\n";
}


export function activate(context: vscode.ExtensionContext) {
  console.log('Code to Test now active!');

  let disposable = vscode.commands.registerCommand(
    "codebaseToText.generate",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri;
      const config = vscode.workspace.getConfiguration("codebaseToText");
      const customIgnorePatterns: string[] = config.get("ignorePatterns") || [];
      const outputFileName: string = config.get("outputFileName") || "codebase-output.txt";
      const maxFileSizeMB: number = config.get("maxFileSizeMB") || 5;
      const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating Codebase Text",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ increment: 0, message: "Reading ignore rules..." });

            // Initialize ignore instance
            const ig = ignore();

            // 1. Add default and user-configured patterns
            ig.add(customIgnorePatterns);

            // 2. Add .gitignore patterns
            const gitignorePatterns = await readGitIgnore(workspaceRoot);
            ig.add(gitignorePatterns);

            progress.report({ increment: 10, message: "Finding files..." });

            // Find all files initially - null excludes means we handle ignores manually
            const allFiles = await vscode.workspace.findFiles(
              "**/*",
              null, // Let our ignore logic handle everything
              undefined // No max results limit initially
            );

            progress.report({ increment: 30, message: "Filtering files..." });

            // Filter files using the ignore rules
            const includedFiles: vscode.Uri[] = [];
            const skippedFiles: string[] = [];
            const sizeLimitedFiles: string[] = [];

            for (const fileUri of allFiles) {
              const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath).replace(/\\/g, "/"); // Use forward slashes for ignore matching

              if (ig.ignores(relativePath)) {
                skippedFiles.push(relativePath);
                continue;
              }

              // Check file size
              try {
                const stats = await vscode.workspace.fs.stat(fileUri);
                if (stats.size > maxFileSizeBytes) {
                  sizeLimitedFiles.push(`${relativePath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
                  continue; // Skip file if too large
                }
              } catch (statError) {
                console.warn(`Could not stat file ${relativePath}: ${statError}`);
                // Decide if you want to skip or include files you can't stat
                skippedFiles.push(`${relativePath} (stat error)`);
                continue;
              }

              includedFiles.push(fileUri);
            }

            if (includedFiles.length === 0) {
              vscode.window.showWarningMessage("No files found to include after applying ignore rules.");
              return;
            }

            progress.report({ increment: 50, message: "Generating structure..." });
            let outputContent = buildStructure(includedFiles, workspaceRoot);

            progress.report({ increment: 60, message: "Reading file contents..." });
            let filesProcessed = 0;
            const totalFilesToRead = includedFiles.length;

            for (const fileUri of includedFiles) {
              const relativePath = path.relative(workspaceRoot.fsPath, fileUri.fsPath).replace(/\\/g, "/");
              progress.report({
                increment: (40 / totalFilesToRead), // 40% of progress for reading files
                message: `Reading: ${relativePath}`,
              });

              try {
                const fileContentRaw = await vscode.workspace.fs.readFile(fileUri);
                const fileContent = Buffer.from(fileContentRaw).toString("utf8"); // Assume UTF-8

                // Basic check for binary-like content (optional, might need refinement)
                // This checks for a high percentage of non-printable ASCII or multi-byte UTF-8 chars
                let nonAsciiRatio = 0;
                if (fileContent.length > 0) {
                    const nonAsciiChars = fileContent.match(/[^\x00-\x7F]/g) || [];
                    nonAsciiRatio = nonAsciiChars.length / fileContent.length;
                }

                // Add file header
                outputContent += `\n\n// File: ${relativePath}\n`;
                outputContent += "// ---- START ----\n\n";

                if (nonAsciiRatio > 0.3 && fileContent.includes('\uFFFD')) { // High non-ASCII ratio and replacement chars suggest binary
                    outputContent += `[Content omitted - Likely binary file or invalid UTF-8]\n`;
                    skippedFiles.push(`${relativePath} (likely binary)`);
                } else {
                    outputContent += fileContent;
                }
                outputContent += "\n\n// ---- END ----\n";


              } catch (readError) {
                console.error(`Error reading file ${relativePath}:`, readError);
                outputContent += `\n\n// File: ${relativePath}\n`;
                outputContent += `// ---- START ----\n\n`;
                outputContent += `[Error reading file: ${readError}]\n`;
                outputContent += `\n// ---- END ----\n`;
                skippedFiles.push(`${relativePath} (read error)`);
              }
              filesProcessed++;
            }

            progress.report({ increment: 100, message: "Opening output..." });

            // Add summary of skipped files
            if (skippedFiles.length > 0 || sizeLimitedFiles.length > 0) {
              outputContent += "\n\n---\n\nSkipped Files Summary:\n";
              if (sizeLimitedFiles.length > 0) {
                outputContent += `\nFiles skipped due to size limit (${maxFileSizeMB} MB):\n - ${sizeLimitedFiles.join("\n - ")}\n`;
              }
              if (skippedFiles.length > 0) {
                outputContent += `\nFiles skipped due to ignore rules, errors, or binary detection:\n - ${skippedFiles.join("\n - ")}\n`;
              }
            }


            // Create and open a new document
            const outputDocument = await vscode.workspace.openTextDocument({
              content: outputContent,
              language: "plaintext", // Or 'markdown' if you prefer
            });

            await vscode.window.showTextDocument(outputDocument);
            vscode.window.showInformationMessage(
              `Codebase text generated (${includedFiles.length} files included). You can save the new file.`
            );

          } catch (error) {
            console.error("Error generating codebase text:", error);
            vscode.window.showErrorMessage(
              `Failed to generate codebase text: ${error}`
            );
          }
        }
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
