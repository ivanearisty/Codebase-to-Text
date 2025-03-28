import * as vscode from "vscode";
import * as path from "path";
import ignore, { Ignore } from "ignore";

// --- Reusable Core Logic ---

async function generateCodebaseText(
  effectiveStartUri: vscode.Uri, // The folder/file path to start from
  workspaceRootUri: vscode.Uri // The actual root of the workspace for .gitignore
) {
  const config = vscode.workspace.getConfiguration("codebaseToText");
  const customIgnorePatterns: string[] = config.get("ignorePatterns") || [];
  const outputFileName: string =
    config.get("outputFileName") || "codebase-output.txt";
  const maxFileSizeMB: number = config.get("maxFileSizeMB") || 5;
  const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;

  let isSingleFileMode = false;
  let searchRootUri = effectiveStartUri;

  // Determine if the start URI is a file or directory
  try {
    const stats = await vscode.workspace.fs.stat(effectiveStartUri);
    if (stats.type === vscode.FileType.File) {
      isSingleFileMode = true;
      // If it's a file, the "root" for relative paths in output is its directory
      searchRootUri = vscode.Uri.joinPath(effectiveStartUri, "..");
    } else {
      searchRootUri = effectiveStartUri; // It's a directory
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Error accessing path: ${effectiveStartUri.fsPath}. ${err}`
    );
    return;
  }

  const relativeStartPath = path
    .relative(workspaceRootUri.fsPath, searchRootUri.fsPath)
    .replace(/\\/g, "/");
  const progressTitle = isSingleFileMode
    ? `Generating Text for ${path.basename(effectiveStartUri.fsPath)}`
    : `Generating Codebase Text from ${relativeStartPath || "."}`;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ increment: 0, message: "Reading ignore rules..." });

        // Initialize ignore instance - always relative to workspace root for .gitignore
        const ig = ignore();
        ig.add(customIgnorePatterns); // Add settings patterns first

        // Read .gitignore from the absolute workspace root
        const gitignorePatterns = await readGitIgnore(workspaceRootUri);
        ig.add(gitignorePatterns);

        progress.report({ increment: 10, message: "Finding files..." });

        let filesToProcess: vscode.Uri[] = [];

        if (isSingleFileMode) {
          // Only process the single selected file
          filesToProcess.push(effectiveStartUri);
        } else {
          // Find files recursively within the searchRootUri
          const searchPattern = new vscode.RelativePattern(
            searchRootUri,
            "**/*"
          );
          filesToProcess = await vscode.workspace.findFiles(
            searchPattern,
            null, // We handle ignores manually below
            undefined
          );
        }

        progress.report({ increment: 30, message: "Filtering files..." });

        const includedFiles: vscode.Uri[] = [];
        const skippedFiles: string[] = [];
        const sizeLimitedFiles: string[] = [];

        for (const fileUri of filesToProcess) {
          // Path relative to WORKSPACE ROOT for ignore checking
          const pathRelativeToWorkspace = path
            .relative(workspaceRootUri.fsPath, fileUri.fsPath)
            .replace(/\\/g, "/");

          // Path relative to SEARCH ROOT for display/output
          const pathRelativeToSearchRoot = path
            .relative(searchRootUri.fsPath, fileUri.fsPath)
            .replace(/\\/g, "/");

          // Ensure we don't process the search root itself if it was a directory
          if (fileUri.fsPath === searchRootUri.fsPath && !isSingleFileMode) {
              continue;
          }

          // Check against ignore rules (using path relative to workspace root)
          if (ig.ignores(pathRelativeToWorkspace)) {
            skippedFiles.push(pathRelativeToSearchRoot); // Log skipped relative to search root
            continue;
          }

          // Check file size
          try {
            const stats = await vscode.workspace.fs.stat(fileUri);
            if (stats.type !== vscode.FileType.File) continue;

            if (stats.size > maxFileSizeBytes) {
              sizeLimitedFiles.push(
                `${pathRelativeToSearchRoot} (${(
                  stats.size /
                  (1024 * 1024)
                ).toFixed(2)} MB)`
              );
              continue; // Skip file if too large
            }
          } catch (statError) {
            console.warn(
              `Could not stat file ${pathRelativeToSearchRoot}: ${statError}`
            );
            skippedFiles.push(`${pathRelativeToSearchRoot} (stat error)`);
            continue;
          }

          includedFiles.push(fileUri);
        }

        if (includedFiles.length === 0) {
          vscode.window.showWarningMessage(
            "No files found to include in the specified path after applying ignore rules."
          );
          return;
        }

        progress.report({ increment: 50, message: "Generating structure..." });

        // Build structure based on paths relative to the search root
        let outputContent = "";
        if (!isSingleFileMode) {
          outputContent = buildStructure(includedFiles, searchRootUri); // Pass searchRootUri as base
        } else {
          // For single file mode, just add a header indicating the file
          const relativeFilePath = path.relative(workspaceRootUri.fsPath, effectiveStartUri.fsPath).replace(/\\/g, "/");
          outputContent = `// Content for file: ${relativeFilePath}\n---\n\n`;
        }


        progress.report({ increment: 60, message: "Reading file contents..." });
        const totalFilesToRead = includedFiles.length;

        for (let i = 0; i < totalFilesToRead; i++) {
          const fileUri = includedFiles[i];
          // Path relative to SEARCH ROOT for display
          const relativePath = path
            .relative(searchRootUri.fsPath, fileUri.fsPath)
            .replace(/\\/g, "/");

          progress.report({
            increment: 40 / totalFilesToRead,
            message: `Reading: ${relativePath}`,
          });

          try {
            const fileContentRaw = await vscode.workspace.fs.readFile(fileUri);
            const fileContent = Buffer.from(fileContentRaw).toString("utf8");

            let nonAsciiRatio = 0;
            if (fileContent.length > 0) {
              const nonAsciiChars = fileContent.match(/[^\x00-\x7F]/g) || [];
              nonAsciiRatio = nonAsciiChars.length / fileContent.length;
            }

            outputContent += `\n\n// File: ${relativePath}\n`; // Use relative path from search root
            outputContent += "// ---- START ----\n\n";

            if (
              nonAsciiRatio > 0.3 &&
              fileContent.includes("\uFFFD")
            ) {
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
        }

        progress.report({ increment: 100, message: "Opening output..." });

        // // Add summary of skipped files (relative to search root)
        // if (skippedFiles.length > 0 || sizeLimitedFiles.length > 0) {
        //   outputContent += "\n\n---\n\nSkipped Files Summary:\n";
        //   if (sizeLimitedFiles.length > 0) {
        //     outputContent += `\nFiles skipped due to size limit (${maxFileSizeMB} MB):\n - ${sizeLimitedFiles.join(
        //       "\n - "
        //     )}\n`;
        //   }
        //   if (skippedFiles.length > 0) {
        //     outputContent += `\nFiles skipped due to ignore rules, errors, or binary detection:\n - ${skippedFiles.join(
        //       "\n - "
        //     )}\n`;
        //   }
        // }

        const outputDocument = await vscode.workspace.openTextDocument({
          content: outputContent,
          language: "plaintext",
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

// Helper function to read .gitignore files (remains the same)
async function readGitIgnore(workspaceRoot: vscode.Uri): Promise<string[]> {
  const gitignorePath = vscode.Uri.joinPath(workspaceRoot, ".gitignore");
  try {
    const raw = await vscode.workspace.fs.readFile(gitignorePath);
    return raw
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  } catch (error) {
    if (
      error instanceof vscode.FileSystemError &&
      error.code === "FileNotFound"
    ) {
      return [];
    }
    console.error("Error reading .gitignore:", error);
    vscode.window.showWarningMessage(`Could not read .gitignore: ${error}`);
    return [];
  }
}

// Helper function to build the directory structure string
function buildStructure(files: vscode.Uri[], baseUri: vscode.Uri): string {
  const structure: any = {};
  const baseFsPath = baseUri.fsPath;

  files.forEach((fileUri) => {
    // Ensure relative path is calculated from the correct base
    const relativePath = path
      .relative(baseFsPath, fileUri.fsPath)
      .replace(/\\/g, "/");
    const parts = relativePath.split("/");
    let currentLevel = structure;

    parts.forEach((part, index) => {
      if (!part) return; // Skip empty parts if relative path starts with / or has //
      if (index === parts.length - 1) {
        currentLevel[part] = null; // Mark as file
      } else {
        if (!currentLevel[part]) {
          currentLevel[part] = {};
        }
        currentLevel = currentLevel[part];
      }
    });
  });

  function formatStructure(level: any, indent: string = ""): string {
    let output = "";
    const entries = Object.entries(level).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    entries.forEach(([name, content], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const line = indent + connector + name + "\n";
      output += line;

      if (content !== null) {
        const newIndent = indent + (isLast ? "    " : "│   ");
        output += formatStructure(content, newIndent);
      }
    });
    return output;
  }
  const relativeBase = path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', baseFsPath).replace(/\\/g, "/") || '.';
  return `Project Structure (from ./${relativeBase}):\n${formatStructure(structure)}\n---\n\n`;
}

// --- Activation ---

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, "codebase-to-text" is now active!');

  // Command: Generate from Workspace Root
  const disposableGenerate = vscode.commands.registerCommand(
    "codebaseToText.generate",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }
      const workspaceRootUri = workspaceFolders[0].uri;
      // Call the core logic function with the workspace root
      await generateCodebaseText(workspaceRootUri, workspaceRootUri);
    }
  );

  // Command: Generate from specific path (context menu)
  const disposableGenerateFromPath = vscode.commands.registerCommand(
    "codebaseToText.generateFromPath",
    async (startUri?: vscode.Uri) => {
      // The startUri is automatically passed by VS Code when triggered from the context menu
      const workspaceFolders = vscode.workspace.workspaceFolders;

      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }
      const workspaceRootUri = workspaceFolders[0].uri; // Still need workspace root for .gitignore

      if (!startUri) {
        // Should not happen from context menu, but handle defensively
        // Maybe prompt user or default to workspace root?
        vscode.window.showWarningMessage(
          "No starting path selected. Defaulting to workspace root."
        );
        startUri = workspaceRootUri;
      }

      // Call the core logic function with the selected path and the workspace root
      await generateCodebaseText(startUri, workspaceRootUri);
    }
  );

  context.subscriptions.push(disposableGenerate, disposableGenerateFromPath);
}

export function deactivate() {}
