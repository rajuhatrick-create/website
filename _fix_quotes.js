const fs = require('fs');
const filePath = 'c:/Users/Vishwa/.gemini/antigravity/scratch/nestiq/nestiq_server.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i] || '';
  if (line.includes("navItems =") && line.includes("switchDashboardTab")) {
    console.log("Found at line", i + 1);
    console.log(JSON.stringify(line.substring(0, 400)));
    break;
  }
}
