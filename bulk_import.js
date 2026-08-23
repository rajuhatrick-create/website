#!/usr/bin/env node
// ============================================================
//  NestIQ — Bulk Resource Importer
//
//  USAGE:
//    node bulk_import.js /path/to/your/files
//
//  FILE NAMING CONVENTION (recommended for auto-tagging):
//    [Board]_[Class]_[Subject]_[Type]_[Title].pdf
//
//  Examples:
//    CBSE_Class10_Mathematics_Note_Quadratic Equations.pdf
//    ICSE_Class12_Physics_MockPaper_Specimen 2025.pdf
//    CBSE_Class11_Chemistry_Note_Organic Reactions.pdf
//
//  If a file doesn't follow the convention, you'll be prompted
//  to fill in the missing fields interactively.
//
//  Supported file types: .pdf, .doc, .docx, .ppt, .pptx, .jpg, .png, .webp
// ============================================================

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const crypto   = require('crypto');

// ── Config ───────────────────────────────────────────────────
const DB_PATH      = path.join(__dirname, 'nestiq.db');
const UPLOAD_DIR   = path.join(__dirname, 'uploads');

const KNOWN_BOARDS    = ['CBSE', 'ICSE', 'IB', 'IGCSE', 'State Board', 'Other'];
const KNOWN_CLASSES   = ['Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];
const KNOWN_TYPES     = ['Note', 'Mock Paper', 'Assignment', 'Worksheet', 'Textbook', 'Solution', 'Other'];
const KNOWN_SUBJECTS  = ['Mathematics','Physics','Chemistry','Biology','English','History','Geography',
                         'Economics','Computer Science','Hindi','Science','Social Science','Other'];

const EXT_TO_MIME = {
  '.pdf'  : 'application/pdf',
  '.doc'  : 'application/msword',
  '.docx' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt'  : 'application/vnd.ms-powerpoint',
  '.pptx' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.png'  : 'image/png',
  '.webp' : 'image/webp',
};

// ── Helpers ──────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise(res => rl.question(q, ans => res(ans.trim())));
}
function fuzzyMatch(input, list) {
  const norm = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  return list.find(item => item.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) || null;
}
function formatSize(bytes) {
  const kb = Math.round(bytes / 1024);
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
function uniqueFilename(origName) {
  const ext  = path.extname(origName);
  const hash = crypto.randomBytes(8).toString('hex');
  const base = path.basename(origName, ext).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);
  return `${base}_${hash}${ext}`;
}

// ── Parse filename for metadata ───────────────────────────────
function parseName(filename) {
  const base  = path.basename(filename, path.extname(filename));
  const parts = base.split('_');

  // Expect: Board_Class_Subject_Type_Title...
  if (parts.length >= 5) {
    const board   = fuzzyMatch(parts[0], KNOWN_BOARDS);
    const cls     = fuzzyMatch(parts[1] + ' ' + parts[2], KNOWN_CLASSES)
                    || fuzzyMatch(parts[1], KNOWN_CLASSES);
    const subject = fuzzyMatch(parts[2], KNOWN_SUBJECTS) || fuzzyMatch(parts[3], KNOWN_SUBJECTS);
    const type    = fuzzyMatch(parts[3], KNOWN_TYPES)    || fuzzyMatch(parts[4], KNOWN_TYPES);
    const title   = parts.slice(4).join(' ') || base;
    return { board, cls, subject, type, title };
  }
  if (parts.length >= 4) {
    return {
      board  : fuzzyMatch(parts[0], KNOWN_BOARDS),
      cls    : fuzzyMatch(parts[1], KNOWN_CLASSES),
      subject: fuzzyMatch(parts[2], KNOWN_SUBJECTS),
      type   : fuzzyMatch(parts[3], KNOWN_TYPES),
      title  : parts.slice(3).join(' ') || base,
    };
  }
  return { board:null, cls:null, subject:null, type:null, title: base.replace(/_/g,' ') };
}

// ── Prompt for missing fields ─────────────────────────────────
async function resolveField(label, value, options) {
  if (value) return value;
  console.log(`\n  ${label} options: ${options.join(', ')}`);
  const ans = await ask(`  Enter ${label}: `);
  return fuzzyMatch(ans, options) || ans || options[options.length - 1];
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: node bulk_import.js /path/to/your/files');
    process.exit(1);
  }

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new Database(DB_PATH);

  const allFiles = fs.readdirSync(folder).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return EXT_TO_MIME[ext];
  });

  if (allFiles.length === 0) {
    console.log('No supported files found in folder.');
    rl.close(); return;
  }

  console.log(`\n📂  Found ${allFiles.length} file(s) in ${folder}`);
  console.log('─'.repeat(60));

  const alreadyImported = db.prepare('SELECT public_id FROM resources').all().map(r => r.public_id);
  let imported = 0, skipped = 0;

  for (const filename of allFiles) {
    const srcPath = path.join(folder, filename);
    const ext     = path.extname(filename).toLowerCase();
    const mime    = EXT_TO_MIME[ext];
    const stat    = fs.statSync(srcPath);

    // Parse metadata from filename
    let { board, cls, subject, type, title } = parseName(filename);

    console.log(`\n📄  ${filename}`);
    if (board && cls && subject && type) {
      console.log(`    Auto-detected: ${board} | ${cls} | ${subject} | ${type} | "${title}"`);
      const confirm = await ask('    Import with these tags? [Y/n]: ');
      if (confirm.toLowerCase() === 'n') {
        board = null; cls = null; subject = null; type = null;
      }
    }

    // Fill in any missing fields
    board   = await resolveField('Board',   board,   KNOWN_BOARDS);
    cls     = await resolveField('Class',   cls,     KNOWN_CLASSES);
    subject = await resolveField('Subject', subject, KNOWN_SUBJECTS);
    type    = await resolveField('Type',    type,    KNOWN_TYPES);

    if (!title || title === path.basename(filename, ext)) {
      const t = await ask(`  Title [${title}]: `);
      if (t) title = t;
    }

    const price = await ask('  Price (Free / enter amount) [Free]: ') || 'Free';
    const desc  = await ask('  Description (optional): ');

    // Copy file to uploads/
    const destName = uniqueFilename(filename);
    const destPath = path.join(UPLOAD_DIR, destName);

    if (alreadyImported.includes(destName)) {
      console.log('    ⚠️  Already imported, skipping.');
      skipped++; continue;
    }

    fs.copyFileSync(srcPath, destPath);

    // Insert into DB
    db.prepare(`
      INSERT INTO resources (title, board, class, subject, type, price, description, file_url, public_id, file_type, file_size, downloads, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      title, board, cls, subject, type, price, desc || '',
      '/uploads/' + destName, destName, mime,
      formatSize(stat.size),
      new Date().toLocaleDateString('en-IN')
    );

    console.log(`    ✅  Imported: "${title}"`);
    imported++;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  ✅ Done! Imported: ${imported}  |  Skipped: ${skipped}`);
  console.log('  Restart NestIQ server to see new resources.');
  console.log('═'.repeat(60) + '\n');

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
