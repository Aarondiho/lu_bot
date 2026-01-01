const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load accounts
const accountsPath = path.join(__dirname, 'accounts.json');
if (!fs.existsSync(accountsPath)) {
    console.error("No accounts.json found!");
    process.exit(1);
}
const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
console.log(`Loaded ${accounts.length} accounts.`);

// Path to your Chrome Extension
const extensionPath = path.join(__dirname, 'bowling'); // folder containing manifest.json

// Launch multiple Chrome profiles
(async () => {
    const isHeadless = false;

    console.log(`Starting ${accounts.length} bots...`);

    // Helper to copy folder recursively (for extension isolation)
    function copyFolderSync(from, to) {
        if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
        fs.readdirSync(from).forEach(element => {
            if (fs.lstatSync(path.join(from, element)).isFile()) {
                fs.copyFileSync(path.join(from, element), path.join(to, element));
            } else {
                copyFolderSync(path.join(from, element), path.join(to, element));
            }
        });
    }

    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ];

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];

        // Stagger launches
        await new Promise(resolve => setTimeout(resolve, i * 3000));

        // 1. Prepare Profile Folder
        const profileDir = path.join(__dirname, 'profiles', account.phone);
        const userDataDir = path.join(profileDir, 'chrome_data');
        const userExtensionPath = path.join(profileDir, 'extension_copy');

        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }

        // 2. Copy Extension to Unique Folder (Prevents File Locking / Shared State)
        // This ensures every browser instance has its OWN copy of the extension files
        try {
            copyFolderSync(extensionPath, userExtensionPath);
        } catch (e) {
            console.error(`Failed to copy extension for ${account.phone}:`, e);
        }

        console.log(`Launching Profile: ${account.phone}`);

        try {
            // 3. Launch with Unique Extension Path & Random UA
            const ua = userAgents[i % userAgents.length];

            const context = await chromium.launchPersistentContext(userDataDir, {
                headless: isHeadless,
                userAgent: ua, // Unique Fingerprint
                args: [
                    `--disable-background-timer-throttling`,
                    `--disable-renderer-backgrounding`,
                    `--disable-features=TabFreeze`,
                    `--no-sandbox`,
                    `--disable-setuid-sandbox`,
                    `--disable-infobars`,
                    `--load-extension=${userExtensionPath}`,
                    `--disable-extensions-except=${userExtensionPath}`
                ],
                viewport: { width: 1000, height: 600 }
            });

            const pages = context.pages();
            const page = pages.length > 0 ? pages[0] : await context.newPage();

            const loginUrl = `https://bowling.lumitel.bi/Home/Login?auto_user=${account.phone}&auto_pass=${account.password}`;

            await page.goto(loginUrl, { timeout: 60000 });

            console.log(`✅ Bot ${account.phone} is running.`);

            context.on('close', () => console.log(`Bot ${account.phone} stopped.`));

        } catch (err) {
            console.error(`❌ Failed to launch ${account.phone}:`, err);
        }
    }
})();
