// Stores mapping of TabID -> Credential Object
// { 123: {phone: "...", password: "..."}, 124: ... }
let tabCredentials = {};

// Listen for messages from Popup (to launch) or Content Script (to get creds)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // 1. Popup sends "LAUNCH_ACCOUNTS" with list
    if (request.action === "LAUNCH_ACCOUNTS") {
        const accounts = request.accounts;
        console.log(`Received ${accounts.length} accounts to launch.`);

        accounts.forEach((account, index) => {
            // Add a small delay between launches to prevent browser choking
            setTimeout(() => {
                chrome.tabs.create({ url: "https://bowling.lumitel.bi/Home/Login", active: false }, (tab) => {
                    // Map the new Tab ID to this account
                    tabCredentials[tab.id] = account;
                    console.log(`Launched Tab ${tab.id} for user ${account.phone}`);
                });
            }, index * 1000);
        });

        sendResponse({ success: true, message: `Launching ${accounts.length} tabs...` });
        return true;
    }

    // 2. Content Script sends "GET_MY_CREDS"
    if (request.action === "GET_MY_CREDS") {
        const tabId = sender.tab ? sender.tab.id : null;
        if (tabId && tabCredentials[tabId]) {
            console.log(`Sending credentials to Tab ${tabId}`);
            sendResponse({ success: true, credentials: tabCredentials[tabId] });
        } else {
            // If tab is not in our managed list, plain response
            sendResponse({ success: false, message: "No credentials assigned to this tab." });
        }
        return true;
    }
    // 3. Content Script Request to Maximize
    if (request.action === "MAXIMIZE_WINDOW") {
        console.log("Received MAXIMIZE_WINDOW request.");
        if (sender.tab && sender.tab.windowId) {
            chrome.windows.update(sender.tab.windowId, { state: "maximized" }, () => {
                if (chrome.runtime.lastError) console.log("Maximize Error:", chrome.runtime.lastError);
            });
        }
        return true;
    }
});

// Cleanup: If a tab is closed, remove it from memory
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabCredentials[tabId]) {
        delete tabCredentials[tabId];
    }
});
