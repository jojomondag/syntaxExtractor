const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { extractCode } = require('./commands/codeExtractor');

let currentPanel = undefined;  // Reference to the current webview panel

function activate(context) {
    console.log('Syntax Extractor is now active!');

    // Register the extract code command
    let extractCodeDisposable = vscode.commands.registerCommand('codeExtractor.extractCode', async (uri, uris) => {
        if (!uris || uris.length === 0) {
            if (uri) {
                uris = [uri];
            } else {
                vscode.window.showWarningMessage('No folders selected for extraction.');
                return;
            }
        }
        await extractCode(uris);
    });

    // Register the command to open the explorer and initialize webview
    let openExplorerDisposable = vscode.commands.registerCommand('syntaxExtractor.openExplorer', () => {
        vscode.commands.executeCommand('workbench.view.explorer');
        showWebview(context);
    });

    // Add the tree view and listeners
    const emptyTreeDataProvider = {
        getTreeItem: () => null,
        getChildren: () => []
    };
    const treeView = vscode.window.createTreeView('emptyView', { treeDataProvider: emptyTreeDataProvider });

    context.subscriptions.push(
        treeView.onDidChangeVisibility(e => {
            if (e.visible) {
                vscode.commands.executeCommand('syntaxExtractor.openExplorer');
            }
        })
    );

    context.subscriptions.push(extractCodeDisposable, openExplorerDisposable);
}

function showWebview(context) {
    if (currentPanel) {
        // If the panel is already open, reveal it in the same column
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    console.log('Initializing Webview...');  // Debugging output

    currentPanel = vscode.window.createWebviewPanel(
        'syntaxExtractorWebview', // Identifies the type of the webview. Used internally
        'Syntax Extractor View',  // Title of the panel displayed to the user
        vscode.ViewColumn.One,    // Editor column to show the new webview panel in.
        {
            enableScripts: true,  // Enable scripts in the webview
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'))] // Restrict the webview to only load resources from the `webview` directory
        }
    );

    // Set the webview's HTML content by reading from the provided webview.html file
    const webviewHtml = getWebviewContent(context, currentPanel);
    currentPanel.webview.html = webviewHtml;

    // Handle the panel being closed (disposing of the reference)
    currentPanel.onDidDispose(() => {
        currentPanel = undefined;  // Reset the reference to undefined when the panel is closed
    });
}

function getWebviewContent(context, panel) {
    const webview = panel.webview;
    const basePath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'));  // Corrected path

    // Read the HTML content from `webview.html`
    const htmlPath = vscode.Uri.joinPath(basePath, 'webview.html');
    let htmlContent;
    try {
        htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        console.log(`Loaded HTML content from: ${htmlPath.fsPath}`);  // Debugging output
    } catch (error) {
        console.error(`Error reading webview.html: ${error.message}`);
        return `<html><body><h1>Error loading webview content</h1><p>${error.message}</p></body></html>`;
    }

    // Load CSS files with appropriate URIs for the webview
    const variablesCssUri = webview.asWebviewUri(vscode.Uri.joinPath(basePath, 'styles', 'variables.css'));
    const webviewCssUri = webview.asWebviewUri(vscode.Uri.joinPath(basePath, 'styles', 'webview.css'));
    const boxCssUri = webview.asWebviewUri(vscode.Uri.joinPath(basePath, 'styles', 'box.css'));  // Include box.css as well if needed

    console.log(`CSS URIs: ${variablesCssUri}, ${webviewCssUri}, ${boxCssUri}`);  // Debugging output

    // Update the HTML content to include the stylesheets dynamically
    htmlContent = htmlContent.replace('./styles/variables.css', variablesCssUri.toString());
    htmlContent = htmlContent.replace('./styles/webview.css', webviewCssUri.toString());
    htmlContent = htmlContent.replace('./styles/box.css', boxCssUri.toString());

    return htmlContent;
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
