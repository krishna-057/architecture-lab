import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "PORTFOLIO_INDEX.md",
  "MASTER_PLAN.md",
  "docs/project-repositories.md",
  "projects/01-flashreserve/README.md",
  "projects/02-pocketsentinel/README.md",
  "projects/03-personabridge/README.md",
  "projects/04-collabflow/PORTFOLIO_SUMMARY.md",
  "projects/05-hookrelay/README.md"
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing portfolio file: ${file}`);
  }
}

const index = readFileSync("PORTFOLIO_INDEX.md", "utf8");
const requiredMarkers = [
  "Recommended Demo Order",
  "Project Map",
  "FlashReserve",
  "PocketSentinel",
  "PersonaBridge",
  "CollabFlow",
  "HookRelay",
  "Cross-Project Themes",
  "Final Demo Checklist",
  "https://github.com/krishna-057/FlashReserve",
  "https://github.com/krishna-057/PocketSentinel",
  "https://github.com/krishna-057/PersonaBridge",
  "https://github.com/krishna-057/CollabFlow",
  "https://github.com/krishna-057/HookRelay"
];

for (const marker of requiredMarkers) {
  if (!index.includes(marker)) {
    throw new Error(`Portfolio index is missing marker: ${marker}`);
  }
}

const readme = readFileSync("README.md", "utf8");
if (!readme.includes("PORTFOLIO_INDEX.md")) {
  throw new Error("Root README must link to PORTFOLIO_INDEX.md.");
}

console.log("Portfolio index check passed.");
