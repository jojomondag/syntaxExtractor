import * as vscode from 'vscode';
import { initializeFileTypeConfiguration, detectWorkspaceFileTypes } from './operations/initializeFileTypes';
import { ConfigManager } from './config/ConfigManager';
import { extractAndCopyText, extractFileFolderTree, getTokenCount } from './operations';
import { handleOpenWebpage } from './commands/openWebpage';

// Defines a data provider for a tree view, implementing the necessary interfaces for VS Code to render and manage tree items.
class MyDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(): Thenable<vscode.TreeItem[]> { return Promise.resolve([]); }
}

export async function activate(context: vscode.ExtensionContext) {
    const treeView = vscode.window.createTreeView('emptyView', { treeDataProvider: new MyDataProvider() });

    context.subscriptions.push(vscode.commands.registerCommand('extension.createWebview', () => openWebviewAndExplorerSidebar(context)));
    context.subscriptions.push(vscode.commands.registerCommand('syntaxExtractor.extractFileFolderTree', extractFileFolderTree));
    context.subscriptions.push(vscode.commands.registerCommand('syntaxExtractor.extractAndCopyText', extractAndCopyText));
    context.subscriptions.push(vscode.commands.registerCommand('extension.refreshFileTypes', refreshFileTypes));
    
    treeView.onDidChangeVisibility(({ visible }) => {
        if (visible) {
            openWebviewAndExplorerSidebar(context);
        }
    });

    // Check if settings.json exists before initializing file types
    const exists = await settingsFileExists();
    if (!exists) {
        console.log('settings.json not found. Initializing file types.');
        await initializeFileTypeConfiguration();
    } else {
        console.log('settings.json already exists. Skipping initialization.');
    }
}

let globalPanel: vscode.WebviewPanel | undefined;


// Function to check if settings.json exists
async function settingsFileExists(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.log('No workspace is opened.');
        return false;
    }

    const settingsUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode', 'settings.json');
    
    try {
        // Try to read the settings.json to check if it exists
        await vscode.workspace.fs.readFile(settingsUri);
        return true;
    } catch (error) {
        // If the file does not exist
        return false;
    }
}

function openWebviewAndExplorerSidebar(context: vscode.ExtensionContext) {
    if (globalPanel) {
        // Reveal the existing webview panel
        globalPanel.reveal(vscode.ViewColumn.One);
    } else {
        // Create a new webview if it does not already exist
        globalPanel = vscode.window.createWebviewPanel(
            'webPageView', 'SynExt', vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')]
            }
        );

        // Event to handle the disposal of the webview
        globalPanel.onDidDispose(() => {
            console.log('Webview was closed');
            globalPanel = undefined; // Clear the reference to the disposed webview
        }, null, context.subscriptions);

        // Load the content into the webview
        (async () => {
            globalPanel.webview.html = await composeWebViewContent(globalPanel.webview, context.extensionUri);
        })();

        // Setup actions associated with the webview
        setupWebviewPanelActions(globalPanel, context);

        // Setup clipboard polling
        clipBoardPolling(globalPanel);

        // Listen to messages from the webview and handle them
        globalPanel.webview.onDidReceiveMessage(
            message => {
                if (globalPanel) { // Additional check for safety
                    handleReceivedMessage(message, globalPanel, context);
                }
            },
            undefined,
            context.subscriptions
        );

        // Send initial configuration to the webview
        globalPanel.webview.postMessage({
            command: 'initConfig',
            fileTypes: ConfigManager.getInstance().getFileTypes(),
            compressionLevel: ConfigManager.getInstance().getCompressionLevel(),
            clipboardDataBoxHeight: ConfigManager.getInstance().getClipboardDataBoxHeight()
        });
    }

    // This command ensures that the Explorer view is always shown when the button is pressed
    vscode.commands.executeCommand('workbench.view.explorer');
}

async function refreshFileTypes() {
    console.log("Reinitializing file types...");
    await initializeFileTypeConfiguration();
}

// Modified handleReceivedMessage to correctly handle async operations
async function handleReceivedMessage(message: any, panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    switch (message.command) {
        case 'refreshFileTypes':
            await refreshFileTypes(); // Ensure this function is accessible here
            panel.webview.postMessage({ command: 'refreshComplete' });
            break;
        case 'setCompressionLevel':
            await ConfigManager.getInstance().setCompressionLevel(message.level);
            break;
        case 'setFileTypes':
            await ConfigManager.getInstance().setFileTypes(message.fileTypes);
            break;
        case 'setClipboardDataBoxHeight':
            await ConfigManager.getInstance().setClipboardDataBoxHeight(message.height);
            break;
        case 'openWebpage':
            handleOpenWebpage();
            break;
        case 'countTokens':
            const tokenCount = getTokenCount(message.text);
            panel.webview.postMessage({ command: 'setTokenCount', count: tokenCount });
            break;
        case 'countChars':
            const charCount = message.text.length;
            panel.webview.postMessage({ command: 'setCharCount', count: charCount });
            break;
        case 'requestCounts':
            panel.webview.postMessage({ command: 'setTokenCount', count: getTokenCount(message.text) });
            panel.webview.postMessage({ command: 'setCharCount', count: message.text.length });
            break;
        case 'updateFileTypes':
            const currentFileTypes = await ConfigManager.getInstance().getFileTypes();
            const fileTypeIndex = currentFileTypes.indexOf(message.fileType);
            if (fileTypeIndex > -1) {
                currentFileTypes.splice(fileTypeIndex, 1);
            } else {
                currentFileTypes.push(message.fileType);
            }
            await ConfigManager.getInstance().setFileTypes(currentFileTypes);
            panel.webview.postMessage({
                command: 'configUpdated',
                fileTypes: currentFileTypes
            });
            break;
    }

    // Post back the updated configuration
    const updatedConfig = {
        compressionLevel: await ConfigManager.getInstance().getCompressionLevel(),
        fileTypes: await ConfigManager.getInstance().getFileTypes(),
        clipboardDataBoxHeight: await ConfigManager.getInstance().getClipboardDataBoxHeight()
    };
    console.log(`Posting back updated config`);
    panel.webview.postMessage({
        command: 'configUpdated',
        ...updatedConfig
    });
}

// Periodically polls the clipboard and sends updates to the webview
async function clipBoardPolling(panel: vscode.WebviewPanel) {
    let lastKnownClipboardContent = ''; // Keep track of the last known content

    setInterval(async () => {
        const clipboardContent = await vscode.env.clipboard.readText();
        if (clipboardContent !== lastKnownClipboardContent) {
            lastKnownClipboardContent = clipboardContent; // Update last known content
            panel.webview.postMessage({
                command: 'updateClipboardDataBox',
                content: clipboardContent
            });
        }
    }, 800);

    const clipboardContent = await vscode.env.clipboard.readText();

    if (clipboardContent !== lastKnownClipboardContent) {
        lastKnownClipboardContent = clipboardContent; // Update last known content
        const tokenCount = getTokenCount(clipboardContent);
        const charCount = clipboardContent.length;
        panel.webview.postMessage({
            command: 'updateClipboardDataBox',
            content: clipboardContent,
            tokenCount: tokenCount,
            charCount: charCount
        });
    }
}

// Prepares and returns the HTML content to be displayed in the webview, including injecting the correct CSS file reference.
async function composeWebViewContent(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
    try {
        const htmlPath = vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'webview.html');
        const htmlContentUint8 = await vscode.workspace.fs.readFile(htmlPath);
        let htmlContent = Buffer.from(htmlContentUint8).toString('utf8');

        // Correctly reference CSS and JS with webview-compatible URIs
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'webview.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'webview.js'));

        // Replace placeholders or specific script and link tags with correct URIs
        htmlContent = htmlContent.replace(/<link rel="stylesheet" href=".\/webview.css">/, `<link rel="stylesheet" href="${styleUri}">`);
        htmlContent = htmlContent.replace(/<script src="webview.js"><\/script>/, `<script src="${scriptUri}"></script>`);

        return htmlContent;
        
    } catch (error) {
        console.error(`Failed to load webview content: ${error}`);
        return 'Error loading webview content.';
    }
}

function setupWebviewPanelActions(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    // Send initial configuration to webview
    const sendConfigToWebview = () => {
        panel.webview.postMessage({
            command: 'initConfig',
            fileTypes: ConfigManager.getInstance().getFileTypes(),
            compressionLevel: ConfigManager.getInstance().getCompressionLevel(),
            clipboardDataBoxHeight: ConfigManager.getInstance().getClipboardDataBoxHeight()
        });
    };

    // Ensures that when the webview gains focus, it receives the latest configuration and state
    panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.visible) {
            sendConfigToWebview();
            clipBoardPolling(panel); // Continue clipboard polling if needed
        }
    });
    // Initial send of configuration to ensure webview is up-to-date
    sendConfigToWebview();
}