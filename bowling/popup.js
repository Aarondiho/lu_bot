document.addEventListener('DOMContentLoaded', function () {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('status');
    const logsArea = document.getElementById('logs');

    function log(msg) {
        const time = new Date().toLocaleTimeString();
        logsArea.value += `[${time}] ${msg}\n`;
        logsArea.scrollTop = logsArea.scrollHeight;
    }

    // Load saved settings
    chrome.storage.local.get(['isRunning'], function (result) {
        updateStatus(result.isRunning);
    });

    function updateStatus(isRunning) {
        if (isRunning) {
            statusDiv.textContent = "Status: RUNNING";
            statusDiv.className = "status-running";
        } else {
            statusDiv.textContent = "Status: IDLE";
            statusDiv.className = "status-idle";
        }
    }

    startBtn.addEventListener('click', () => {
        // Simple Manual Start (Current Tab)
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "start" }, function (response) {
                if (response && response.success) {
                    log("Bot Started.");
                    updateStatus(true);
                } else {
                    log("Error: Bot start failed (Is game loaded?)");
                }
            });
        });
    });

    stopBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "stop" }, function (response) {
                log("Bot Stopped.");
                updateStatus(false);
            });
        });
    });

    // Listen for logs from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "log") {
            log(request.message);
        }
        if (request.action === "statusUpdate") {
            updateStatus(request.isRunning);
        }
    });
});
