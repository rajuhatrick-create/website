// ============================================================
//  NestIQ — Single File Server
//  Run: node nestiq_server.js
//  Then open: http://localhost:3000
//
//  SETUP: npm install express cors multer better-sqlite3 bcryptjs jsonwebtoken
// ============================================================

const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const Database   = require('better-sqlite3');
const fs         = require('fs');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const path       = require('path');

// ══════════════════════════════════════════════════════════════
//  ⚙️  CONFIG — Edit these before running!
// ══════════════════════════════════════════════════════════════
const CONFIG = {
  PORT            : process.env.PORT             || 3000,
  ADMIN_EMAIL     : process.env.ADMIN_EMAIL       || 'tarunbaalalingam@gmail.com',
  ADMIN_PASS      : process.env.ADMIN_PASS        || 'my victory',
  JWT_SECRET      : process.env.JWT_SECRET        || 'nestiq_super_secret_2025_change_this',
  UPLOAD_DIR      : process.env.UPLOAD_DIR        || 'uploads',  // folder where files are saved on your server
  OLLAMA_HOST     : process.env.OLLAMA_HOST       || 'http://localhost:11434', // local Ollama instance
  OLLAMA_MODEL    : process.env.OLLAMA_MODEL      || 'studynestai', // run: ollama create studynestai -f Modelfile
};

// ── SQLite Database ──────────────────────────────────────────
const db = new Database(path.join(__dirname, 'nestiq.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'student',
    joined     TEXT NOT NULL,
    favourites TEXT DEFAULT '[]',
    downloads  TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS resources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    board       TEXT NOT NULL,
    class       TEXT NOT NULL,
    subject     TEXT NOT NULL,
    type        TEXT NOT NULL,
    price       TEXT DEFAULT 'Free',
    description TEXT,
    file_url    TEXT NOT NULL,
    public_id   TEXT,
    file_type   TEXT,
    file_size   TEXT,
    downloads   INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    subject    TEXT,
    topic      TEXT,
    rating     INTEGER,
    name       TEXT DEFAULT 'Anonymous',
    email      TEXT,
    user_role  TEXT DEFAULT 'Guest',
    created_at TEXT NOT NULL,
    time       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    title      TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Seed default users if table is empty
const checkUsers = db.prepare('SELECT count(*) as count FROM users').get();
if (checkUsers.count === 0) {
  const salt = bcrypt.genSaltSync(10);
  const studentPass = bcrypt.hashSync('password', salt);
  const teacherPass = bcrypt.hashSync('password', salt);
  const joined = new Date().toLocaleDateString('en-IN');
  
  db.prepare('INSERT INTO users (name, email, password, role, joined) VALUES (?, ?, ?, ?, ?)')
    .run('Rohan Sharma', 'student@nestiq.com', studentPass, 'student', joined);
  db.prepare('INSERT INTO users (name, email, password, role, joined) VALUES (?, ?, ?, ?, ?)')
    .run('Dr. Anjali Mehta', 'teacher@nestiq.com', teacherPass, 'teacher', joined);
    
  console.log('Seeded default accounts:');
  console.log('  - Student: student@nestiq.com / password');
  console.log('  - Teacher: teacher@nestiq.com / password');
}

// Seed sample resources if table is empty
const checkResources = db.prepare('SELECT count(*) as count FROM resources').get();
const UPLOAD_DIR_PATH = path.join(__dirname, CONFIG.UPLOAD_DIR);
if (!fs.existsSync(UPLOAD_DIR_PATH)) fs.mkdirSync(UPLOAD_DIR_PATH, { recursive: true });

if (checkResources.count === 0) {
  const joined = new Date().toLocaleDateString('en-IN');
  
  // Create dummy PDF files so downloads actually work immediately
  const dummyFiles = ['sample_quadratic.pdf', 'sample_physics.pdf', 'sample_organic.pdf'];
  dummyFiles.forEach(f => {
    const filePath = path.join(UPLOAD_DIR_PATH, f);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '%PDF-1.4 sample content for NestIQ dummy resource file', 'utf8');
    }
  });

  db.prepare(`
    INSERT INTO resources (title, board, class, subject, type, price, description, file_url, public_id, file_type, file_size, downloads, created_at)
    VALUES 
    ('Quadratic Equations Board Revision Notes', 'CBSE', 'Class 10', 'Mathematics', 'Note', 'Free', 'Quick notes for boards revision covering formulas and key standard questions.', '/uploads/sample_quadratic.pdf', 'sample_quadratic.pdf', 'application/pdf', '320 KB', 45, ?),
    ('ICSE Class 10 Physics Specimen Paper Solutions', 'ICSE', 'Class 10', 'Physics', 'Mock Paper', 'Free', 'Fully solved specimen paper with detailed explanation for numericals.', '/uploads/sample_physics.pdf', 'sample_physics.pdf', 'application/pdf', '1.4 MB', 82, ?),
    ('Organic Chemistry Name Reactions Roadmap', 'CBSE', 'Class 12', 'Chemistry', 'Note', 'Free', 'A visual roadmap showing conversions and name reactions.', '/uploads/sample_organic.pdf', 'sample_organic.pdf', 'application/pdf', '640 KB', 120, ?)
  `).run(joined, joined, joined);
  console.log('Seeded sample resources.');
}

// ── Express App ──────────────────────────────────────────────
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR_PATH),
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || path.extname(file.originalname);
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, Date.now() + '_' + unique + ext);
  }
});

const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — use your server's full capacity
  fileFilter(req, file, cb) {
    if (MIME_TO_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('File type not allowed.'));
  }
});

const idCardUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR_PATH),
    filename: (req, file, cb) => {
      const ext = file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
      cb(null, 'idcard_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('Only JPEG and PNG images are accepted.'));
  }
});

// Serve uploaded files publicly
app.use('/uploads', express.static(UPLOAD_DIR_PATH));

// ── Auth Helpers ─────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token.' });
  try { req.user = jwt.verify(token, CONFIG.JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Invalid token.' }); }
}
function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    const d = jwt.verify(token, CONFIG.JWT_SECRET);
    if (d.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
    req.user = d; next();
  } catch(e) { res.status(401).json({ error: 'Invalid token.' }); }
}

// ══════════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════════

// ── Auth ─────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase()))
    return res.status(409).json({ error: 'Email already registered.' });
  const hashed = await bcrypt.hash(password, 10);
  const joined = new Date().toLocaleDateString('en-IN');
  db.prepare('INSERT INTO users (name,email,password,role,joined) VALUES (?,?,?,?,?)')
    .run(name, email.toLowerCase(), hashed, role, joined);
  const user = db.prepare('SELECT id,name,email,role,joined FROM users WHERE email=?').get(email.toLowerCase());
  const token = jwt.sign({ id:user.id, email:user.email, role:user.role, name:user.name }, CONFIG.JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!user) return res.status(404).json({ error: 'No account found with this email.' });
  if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Wrong password.' });
  const token = jwt.sign({ id:user.id, email:user.email, role:user.role, name:user.name }, CONFIG.JWT_SECRET, { expiresIn:'30d' });
  res.json({ token, user: { id:user.id, name:user.name, email:user.email, role:user.role, joined:user.joined,
    favourites: JSON.parse(user.favourites||'[]'), downloads: JSON.parse(user.downloads||'[]') } });
});

app.post('/api/auth/admin', (req, res) => {
  const { email, password } = req.body;
  if (email !== CONFIG.ADMIN_EMAIL || password !== CONFIG.ADMIN_PASS)
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  const token = jwt.sign({ role:'admin', email }, CONFIG.JWT_SECRET, { expiresIn:'12h' });
  res.json({ token });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,joined,favourites,downloads FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ ...user, favourites: JSON.parse(user.favourites), downloads: JSON.parse(user.downloads) });
});

// ── Resources ─────────────────────────────────────────────────
app.post('/api/resources', adminMiddleware, upload.single('file'), (req, res) => {
  try {
    const { title, board, classLevel, subject, type, price, description } = req.body;
    if (!title || !board || !classLevel || !subject || !type) return res.status(400).json({ error: 'Missing required fields.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const fileUrl = '/uploads/' + req.file.filename;
    const kb = Math.round(req.file.size / 1024);
    const fileSize = kb > 1024 ? `${(kb/1024).toFixed(1)} MB` : `${kb} KB`;

    const info = db.prepare(
      'INSERT INTO resources (title,board,class,subject,type,price,description,file_url,public_id,file_type,file_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(title, board, classLevel, subject, type, price||'Free', description||'', fileUrl, req.file.filename, req.file.mimetype, fileSize, new Date().toLocaleDateString('en-IN'));

    res.json({ success:true, id:info.lastInsertRowid, file_url:fileUrl });
  } catch(e) { res.status(500).json({ error: 'Upload failed: ' + e.message }); }
});

app.get('/api/resources', (req, res) => {
  const { board, type } = req.query;
  let q = 'SELECT * FROM resources', p = [], c = [];
  if (board && board!=='all') { c.push('board=?'); p.push(board); }
  if (type  && type !=='all') { c.push('type=?');  p.push(type);  }
  if (c.length) q += ' WHERE ' + c.join(' AND ');
  res.json(db.prepare(q + ' ORDER BY id DESC').all(...p));
});

app.post('/api/resources/:id/download', (req, res) => {
  db.prepare('UPDATE resources SET downloads=downloads+1 WHERE id=?').run(req.params.id);
  res.json({ success:true });
});

app.delete('/api/resources/:id', adminMiddleware, (req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  // Delete the file from disk
  if (r.public_id) {
    const filePath = path.join(UPLOAD_DIR_PATH, r.public_id);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e) {}
  }
  db.prepare('DELETE FROM resources WHERE id=?').run(req.params.id);
  res.json({ success:true });
});

// ── User Data ─────────────────────────────────────────────────
app.put('/api/users/favourites', authMiddleware, (req, res) => {
  db.prepare('UPDATE users SET favourites=? WHERE id=?').run(JSON.stringify(req.body.favourites), req.user.id);
  res.json({ success:true });
});

app.post('/api/users/downloads', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT downloads FROM users WHERE id=?').get(req.user.id);
  let dls = JSON.parse(user.downloads||'[]');
  const { id, title, date } = req.body;
  if (!dls.find(d => d.id===id)) {
    dls.unshift({ id, title, date });
    db.prepare('UPDATE users SET downloads=? WHERE id=?').run(JSON.stringify(dls.slice(0,100)), req.user.id);
  }
  res.json({ success:true, downloads:dls });
});

// ── Feedback ──────────────────────────────────────────────────
app.post('/api/feedback', (req, res) => {
  const { type, message, subject, topic, rating, name, email, userRole } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required.' });
  const now = new Date();
  db.prepare('INSERT INTO feedback (type,message,subject,topic,rating,name,email,user_role,created_at,time) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(type||'feedback', message, subject||'', topic||'', rating||null, name||'Anonymous', email||'', userRole||'Guest',
        now.toLocaleDateString('en-IN'), now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
  res.json({ success:true });
});

app.get('/api/feedback', adminMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM feedback ORDER BY id DESC').all());
});

app.get('/api/feedback/export', adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM feedback ORDER BY id DESC').all();
  const lbl = { feedback:'General Feedback', request:'Resource Request', bug:'Bug Report', suggestion:'Feature Suggestion' };
  const hdr = ['#','Type','Name','Role','Message','Subject','Topic','Rating','Email','Date','Time'];
  const csv = '\uFEFF' + [hdr, ...rows.map((f,i)=>[
    rows.length-i, lbl[f.type]||f.type, f.name, f.user_role,
    '"'+(f.message||'').replace(/"/g,'""')+'"',
    f.subject||'', f.topic||'', f.rating||'', f.email||'', f.created_at, f.time
  ])].map(r=>r.join(',')).join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="NestIQ_Feedback_${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.csv"`);
  res.send(csv);
});

// ── Tests ─────────────────────────────────────────────────────
app.post('/api/tests', authMiddleware, (req, res) => {
  const { title, data } = req.body;
  if (!title || !data) return res.status(400).json({ error: 'Title and data required.' });
  const info = db.prepare('INSERT INTO tests (user_email,title,data,created_at) VALUES (?,?,?,?)')
    .run(req.user.email, title, JSON.stringify(data), new Date().toLocaleDateString('en-IN'));
  res.json({ success:true, id:info.lastInsertRowid });
});

app.get('/api/tests', authMiddleware, (req, res) => {
  const tests = db.prepare('SELECT * FROM tests WHERE user_email=? ORDER BY id DESC LIMIT 20').all(req.user.email);
  res.json(tests.map(t => ({ ...t, data: JSON.parse(t.data) })));
});

// ── AI Proxy Routes ───────────────────────────────────────────

// Study Nest AI system prompt (mirrors the Modelfile SYSTEM block)
const STUDY_NEST_SYSTEM = `You are "Study Nest AI", the expert academic tutor, teacher assistant, and school enrollment AI for the NestIQ Notes app — a dedicated platform for Indian K-12 students (Class 9, Class 10, Class 11, and Class 12) across CBSE, ICSE, and State Boards.

Your primary responsibilities are:

1. STUDENT DOUBT SOLVER & FILE FINDER:
   - Answer academic questions clearly across Physics, Chemistry, Mathematics, Biology, Social Science, and Computer Science.
   - Solve board numericals step-by-step with formulas, diagrams, and key exam tips.
   - Tailor explanations according to the student's selected Board (CBSE / ICSE / State Board) and Class (9, 10, 11, or 12).
   - Help students locate specific study notes, chapter PDFs, formula sheets, and past year question papers stored in the NestIQ catalog.

2. TEACHER ID CARD & SCHOOL ENROLLMENT VERIFIER:
   - Analyze uploaded Teacher ID cards or text details (Teacher Name, School Name, Email, ID Number).
   - Verify if the teacher's school is already enrolled in the NestIQ network (e.g., Delhi Public School, Kendriya Vidyalaya, St. Xavier's).
   - Check existing enrolled student/teacher counts for the school and generate a verification summary confirming authentic educator access.

3. TEACHER AI STUDY MATERIAL & LESSON GENERATOR:
   - Generate structured chapter notes, high-yield formula sheets, revision guides, and board-exam practice questions.
   - Format outputs in clean Markdown with clear headings, bullet points, key formulas, and exam tips.
   - Adhere strictly to official curriculum patterns (e.g., CBSE 2026 exam pattern, ICSE syllabus).

TONE & STYLE:
- Encouraging, concise, academically accurate, and structured.
- Use clear formatting with bold headers, bullet points, and numbered steps for math/physics solutions.`;

/**
 * callOllama — sends a chat request to the local Ollama instance.
 * Uses the /api/chat endpoint (multi-turn, with system prompt support).
 */
async function callOllama(systemPrompt, messages, stream = false) {
  const http = require('http');
  const url = new URL('/api/chat', CONFIG.OLLAMA_HOST);

  // Build the full message list: system message first, then history
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = JSON.stringify({
    model  : CONFIG.OLLAMA_MODEL,
    messages: ollamaMessages,
    stream  : false, // we always collect the full response server-side
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port    : url.port || 11434,
      path    : url.pathname,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Ollama /api/chat returns { message: { role, content }, done, ... }
          resolve(parsed.message?.content || '');
        } catch(e) {
          reject(new Error('Failed to parse Ollama response: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', (e) => reject(new Error('Ollama connection error: ' + e.message)));
    req.write(body);
    req.end();
  });
}

// AI Chat endpoint — powered by Study Nest AI (Ollama)
app.post('/api/ai/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages array required.' });
  try {
    const reply = await callOllama(STUDY_NEST_SYSTEM, messages);
    if (!reply) return res.status(500).json({ error: "Study Nest AI returned an empty response. Try again." });
    res.json({ reply });
  } catch(e) {
    console.error('Study Nest AI chat error:', e.message);
    res.status(500).json({ error: 'Study Nest AI is offline. Make sure Ollama is running: ollama serve' });
  }
});

// AI Mock Test Generator endpoint — powered by Study Nest AI (Ollama)
app.post('/api/ai/generate-test', async (req, res) => {
  const { subject, board, cls, topic, diff, marks, qtypes, instr } = req.body;
  if (!subject || !topic) return res.status(400).json({ error: 'Subject and topic required.' });
  try {
    const prompt = `Generate a mock test. Subject: ${subject}, Board: ${board}, Class: ${cls}, Topic: ${topic}, Difficulty: ${diff}, Total Marks: ${marks}, Types: ${qtypes}${instr ? ', Instructions: ' + instr : ''}. Return ONLY valid JSON (no markdown, no extra text): {"title":"...","subject":"...","topic":"...","board":"...","class":"...","totalMarks":${marks},"duration":"...","questions":[{"type":"MCQ|SA|LA|FIB","marks":1,"text":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"..."}]}`;
    const testGenSystem = 'You are an expert Indian school curriculum teacher. Return ONLY valid JSON, no extra text, no markdown code fences.';
    const raw = await callOllama(testGenSystem, [{ role: 'user', content: prompt }]);
    // Strip markdown code fences if model wraps anyway
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const test = JSON.parse(cleaned);
    res.json({ test });
  } catch(e) {
    console.error('Study Nest AI test gen error:', e.message);
    res.status(500).json({ error: 'Test generation failed. Make sure Ollama is running: ollama serve' });
  }
});

// ── Admin Stats ───────────────────────────────────────────────
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  res.json({
    resources : db.prepare("SELECT COUNT(*) as c FROM resources").get().c,
    students  : db.prepare("SELECT COUNT(*) as c FROM users WHERE role='student'").get().c,
    teachers  : db.prepare("SELECT COUNT(*) as c FROM users WHERE role='teacher'").get().c,
    feedback  : db.prepare("SELECT COUNT(*) as c FROM feedback").get().c,
    downloads : db.prepare("SELECT SUM(downloads) as c FROM resources").get().c || 0,
  });
});

app.get('/api/admin/users', adminMiddleware, (req, res) => {
  res.json(db.prepare('SELECT id,name,email,role,joined FROM users ORDER BY id DESC').all());
});

// ══════════════════════════════════════════════════════════════
//  FRONTEND — Served from memory (no separate files needed)
// ══════════════════════════════════════════════════════════════
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NestIQ — Free Resources for Every Student</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0b14;--card:#1a1628;--card2:#201b33;--border:#2a2240;--purple:#8b5cf6;--pl:#a78bfa;--pink:#ec4899;--cyan:#22d3ee;--text:#f0ebff;--muted:#9085b0;--accent:#c4b5fd;--green:#4ade80;--red:#f87171;--yellow:#fbbf24;--orange:#fb923c;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;overflow-x:hidden;}
body::before{content:'';position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(ellipse at 20% 20%,rgba(139,92,246,.15) 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(236,72,153,.08) 0%,transparent 50%),radial-gradient(ellipse at 60% 10%,rgba(34,211,238,.06) 0%,transparent 40%);animation:bgShift 12s ease-in-out infinite alternate;pointer-events:none;z-index:0;}
@keyframes bgShift{from{transform:translate(0,0)}to{transform:translate(2%,2%) rotate(3deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
nav{position:fixed;top:0;left:0;right:0;z-index:200;padding:1rem 4%;display:flex;align-items:center;justify-content:space-between;background:rgba(13,11,20,.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);}
.logo{font-family:'Syne',sans-serif;font-weight:800;font-size:1.4rem;background:linear-gradient(135deg,var(--pl),var(--pink));-webkit-background-clip:text;-webkit-text-fill-color:transparent;cursor:pointer;flex-shrink:0;}
.logo span{-webkit-text-fill-color:var(--cyan);}
.nav-links{list-style:none;display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap;}
.nav-links a{color:var(--muted);text-decoration:none;font-size:.85rem;font-weight:500;transition:color .2s;cursor:pointer;white-space:nowrap;}
.nav-links a:hover,.nav-links a.active{color:var(--accent);}
.nav-pill{background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.4);color:var(--pl)!important;padding:.35rem .9rem;border-radius:50px;font-size:.8rem!important;}
.nav-user-info{display:none;align-items:center;gap:.6rem;}
.nav-dot{width:8px;height:8px;border-radius:50%;background:var(--green);}
.nav-user-name{font-size:.82rem;color:var(--accent);font-weight:600;}
.nav-logout{background:none;border:1px solid var(--border);color:var(--muted);padding:.3rem .7rem;border-radius:8px;cursor:pointer;font-size:.75rem;font-family:'DM Sans',sans-serif;transition:all .2s;}
.nav-logout:hover{border-color:var(--red);color:var(--red);}
.page{display:none;padding-top:6rem;}
.page.active{display:block;}
.hero{position:relative;z-index:1;min-height:85vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:4rem 5% 4rem;}
.hero-badge{display:inline-flex;align-items:center;gap:.5rem;background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.4);color:var(--pl);padding:.4rem 1rem;border-radius:50px;font-size:.78rem;font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:1.5rem;animation:fadeUp .6s ease both;}
.hero-badge::before{content:'✦';color:var(--pink);}
h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(2.6rem,7vw,5rem);line-height:1.05;letter-spacing:-2px;margin-bottom:1.5rem;animation:fadeUp .6s .1s ease both;}
h1 .line1{display:block;}h1 .line2{display:block;background:linear-gradient(135deg,var(--pl),var(--pink),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hero>p{font-size:1.05rem;color:var(--muted);max-width:560px;line-height:1.7;margin-bottom:2.5rem;font-weight:300;animation:fadeUp .6s .2s ease both;}
.hero-btns{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;animation:fadeUp .6s .3s ease both;}
.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.85rem 1.8rem;border-radius:50px;font-weight:600;font-size:.9rem;cursor:pointer;border:none;font-family:'DM Sans',sans-serif;transition:all .2s;text-decoration:none;}
.btn-grad{background:linear-gradient(135deg,var(--purple),var(--pink));color:white;box-shadow:0 0 28px rgba(139,92,246,.4);}
.btn-grad:hover{transform:translateY(-2px);box-shadow:0 0 40px rgba(139,92,246,.6);}
.btn-outline{background:transparent;color:var(--accent);border:1px solid var(--border);}
.btn-outline:hover{border-color:var(--purple);background:rgba(139,92,246,.08);}
.btn-green{background:linear-gradient(135deg,#16a34a,#15803d);color:white;}
.btn-sm{padding:.5rem 1.1rem;font-size:.82rem;}
.btn-xs{padding:.35rem .8rem;font-size:.75rem;border-radius:8px;}
.stats{position:relative;z-index:1;display:flex;justify-content:center;gap:3rem;padding:1.8rem 5%;flex-wrap:wrap;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:rgba(26,22,40,.5);}
.stat{text-align:center;}
.stat-num{font-family:'Syne',sans-serif;font-size:1.8rem;font-weight:800;background:linear-gradient(135deg,var(--pl),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.stat-label{color:var(--muted);font-size:.8rem;margin-top:.2rem;}
section{position:relative;z-index:1;padding:4.5rem 5%;}
.section-tag{font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--pl);margin-bottom:.7rem;}
.section-title{font-family:'Syne',sans-serif;font-size:clamp(1.7rem,4vw,2.6rem);font-weight:800;letter-spacing:-1px;margin-bottom:.8rem;}
.section-sub{color:var(--muted);font-size:.95rem;max-width:500px;line-height:1.7;margin-bottom:2.5rem;font-weight:300;}
.divider{width:100%;height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);}
.boards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem;}
.board-card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:1.8rem;cursor:pointer;transition:transform .3s,border-color .3s,box-shadow .3s;position:relative;overflow:hidden;}
.board-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--purple);}
.board-card:nth-child(2)::before{background:var(--pink);}
.board-card:nth-child(3)::before{background:var(--cyan);}
.board-card:hover{transform:translateY(-5px);border-color:var(--purple);box-shadow:0 16px 50px rgba(139,92,246,.15);}
.board-card .icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;margin-bottom:1rem;background:rgba(255,255,255,.05);}
.board-card h3{font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:700;margin-bottom:.4rem;}
.board-card p{color:var(--muted);font-size:.82rem;line-height:1.6;}
.board-card .subjects{margin-top:1rem;display:flex;flex-wrap:wrap;gap:.35rem;}
.tag{background:rgba(139,92,246,.12);color:var(--accent);padding:.18rem .65rem;border-radius:50px;font-size:.72rem;font-weight:500;border:1px solid rgba(139,92,246,.2);}
.tag-green{background:rgba(74,222,128,.1);color:var(--green);border-color:rgba(74,222,128,.25);}
.tag-yellow{background:rgba(251,191,36,.1);color:var(--yellow);border-color:rgba(251,191,36,.25);}
.tag-cyan{background:rgba(34,211,238,.1);color:var(--cyan);border-color:rgba(34,211,238,.25);}
.filter-bar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.8rem;}
.filter-btn{padding:.4rem .9rem;border-radius:50px;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;}
.filter-btn.active{background:linear-gradient(135deg,var(--purple),var(--pink));color:white;border-color:transparent;}
.filter-btn:hover:not(.active){border-color:var(--purple);color:var(--accent);}
.pub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:1rem;}
.pub-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:1.4rem;transition:transform .2s,border-color .2s;position:relative;}
.pub-card:hover{transform:translateY(-3px);border-color:rgba(139,92,246,.45);}
.pub-card h5{font-family:'Syne',sans-serif;font-size:.95rem;font-weight:700;margin-bottom:.4rem;padding-right:2rem;line-height:1.3;}
.pub-card .desc{color:var(--muted);font-size:.8rem;line-height:1.5;margin-bottom:1rem;min-height:36px;}
.pub-card .card-meta{display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.8rem;}
.pub-card-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:auto;}
.fav-btn{position:absolute;top:1.2rem;right:1.2rem;background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted);transition:all .2s;}
.fav-btn.active{color:#f97316;}
.fav-btn:hover{transform:scale(1.2);}
.dl-count{font-size:.72rem;color:var(--muted);}
.file-size-badge{font-size:.7rem;color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--border);padding:.12rem .5rem;border-radius:50px;}
.empty-state{text-align:center;color:var(--muted);padding:3rem;grid-column:1/-1;}
.empty-state .e-icon{font-size:2.5rem;margin-bottom:.8rem;display:block;}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;}
.step{padding:1.8rem;background:var(--card);border:1px solid var(--border);border-radius:18px;}
.step-num{font-family:'Syne',sans-serif;font-size:2.5rem;font-weight:800;background:linear-gradient(135deg,rgba(139,92,246,.4),rgba(236,72,153,.4));-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;margin-bottom:.8rem;}
.step h4{font-family:'Syne',sans-serif;font-size:1rem;font-weight:700;margin-bottom:.4rem;}
.step p{color:var(--muted);font-size:.82rem;line-height:1.6;}
.cta-section{text-align:center;padding:5rem 5%;}
.cta-box{background:linear-gradient(135deg,rgba(139,92,246,.15),rgba(236,72,153,.08));border:1px solid rgba(139,92,246,.3);border-radius:28px;padding:3.5rem 2rem;}
.cta-box h2{font-family:'Syne',sans-serif;font-size:clamp(1.7rem,4vw,2.6rem);font-weight:800;letter-spacing:-1px;margin-bottom:.8rem;}
.cta-box>p{color:var(--muted);margin-bottom:1.8rem;font-size:.95rem;}
footer{position:relative;z-index:1;border-top:1px solid var(--border);padding:2rem 5%;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;}
footer p{color:var(--muted);font-size:.8rem;}footer p strong{color:var(--pl);}
.footer-links{display:flex;gap:1.2rem;}
.footer-links a{color:var(--muted);text-decoration:none;font-size:.8rem;transition:color .2s;cursor:pointer;}
.footer-links a:hover{color:var(--accent);}
.modal-overlay{display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);align-items:center;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:2.2rem;width:90%;max-width:480px;animation:fadeUp .3s ease both;max-height:90vh;overflow-y:auto;}
.modal h3{font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;margin-bottom:.3rem;}
.modal .sub{color:var(--muted);font-size:.85rem;margin-bottom:1.5rem;}
.modal label{display:block;color:var(--muted);font-size:.75rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:.35rem;margin-top:.9rem;}
.modal input,.modal select,.modal textarea{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text);padding:.75rem 1rem;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:.88rem;outline:none;transition:border-color .2s;}
.modal input:focus,.modal select:focus,.modal textarea:focus{border-color:var(--purple);}
.modal select option{background:#1a1628;}
.modal-btns{display:flex;gap:.7rem;margin-top:1.4rem;}
.modal-btns button{flex:1;padding:.75rem;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700;font-size:.88rem;cursor:pointer;border:none;transition:opacity .2s;}
.btn-cancel{background:rgba(255,255,255,.06);color:var(--muted);}
.btn-login-go{background:linear-gradient(135deg,var(--purple),var(--pink));color:white;}
.btn-cancel:hover,.btn-login-go:hover{opacity:.8;}
.modal-error{color:var(--red);font-size:.8rem;margin-top:.7rem;display:none;}
.modal-success{color:var(--green);font-size:.8rem;margin-top:.7rem;display:none;}
.role-select{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:1rem 0;}
.role-opt{background:rgba(255,255,255,.04);border:2px solid var(--border);border-radius:14px;padding:1.2rem;text-align:center;cursor:pointer;transition:all .2s;}
.role-opt:hover,.role-opt.selected{border-color:var(--purple);background:rgba(139,92,246,.12);}
.role-opt .r-icon{font-size:2rem;margin-bottom:.5rem;display:block;}
.role-opt h4{font-family:'Syne',sans-serif;font-size:.95rem;font-weight:700;margin-bottom:.2rem;}
.role-opt p{color:var(--muted);font-size:.72rem;}
.auth-tabs{display:flex;gap:.4rem;margin-bottom:1.5rem;}
.auth-tab{flex:1;padding:.6rem;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);font-family:'DM Sans',sans-serif;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .2s;text-align:center;}
.auth-tab.active{background:linear-gradient(135deg,var(--purple),var(--pink));color:white;border-color:transparent;}
.dashboard-layout{display:grid;grid-template-columns:220px 1fr;gap:2rem;}
.dashboard-sidebar{border-right:1px solid var(--border);padding-right:1.5rem;display:flex;flex-direction:column;gap:.5rem;}
.db-tab-btn{text-align:left;background:transparent;border:none;color:var(--muted);padding:.7rem 1rem;border-radius:10px;font-family:'DM Sans',sans-serif;font-weight:600;font-size:.85rem;cursor:pointer;display:flex;align-items:center;gap:.6rem;transition:all .2s;}
.db-tab-btn.active{background:rgba(139,92,246,.15);color:var(--pl);}
.db-tab-btn:hover:not(.active){background:rgba(255,255,255,.02);color:var(--accent);}
.dashboard-header{margin-bottom:2rem;display:flex;justify-content:space-between;align-items:center;}
.dashboard-header h2{font-family:'Syne',sans-serif;font-size:1.8rem;font-weight:800;}
.dashboard-header .role-badge{font-size:.7rem;padding:.2rem .6rem;background:var(--purple);border-radius:5px;}
.dash-panel{display:none;}
.dash-panel.active{display:block;}
.overview-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:2rem;}
.stat-card{background:var(--card2);border:1px solid var(--border);border-radius:16px;padding:1.4rem;display:flex;align-items:center;justify-content:space-between;}
.stat-card-info h6{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.3rem;}
.stat-card-info p{font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:800;color:var(--accent);}
.stat-card-icon{font-size:1.8rem;opacity:.4;}
.fav-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;}
.dl-list{display:flex;flex-direction:column;gap:.8rem;}
.dl-item{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem 1.3rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;}
.dl-item-info h5{font-family:'Syne',sans-serif;font-size:.9rem;font-weight:700;}
.dl-item-info p{color:var(--muted);font-size:.75rem;margin-top:.2rem;}
.upload-zone{border:2px dashed var(--border);border-radius:14px;padding:2rem;text-align:center;cursor:pointer;transition:all .2s;position:relative;background:rgba(255,255,255,.02);}
.upload-zone:hover,.upload-zone.dragover{border-color:var(--purple);background:rgba(139,92,246,.06);}
.upload-zone input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
.upload-zone .uz-icon{font-size:2.5rem;display:block;margin-bottom:.8rem;}
.upload-zone p{color:var(--muted);font-size:.85rem;}
.upload-zone p span{color:var(--pl);font-weight:600;}
.file-chosen{color:var(--green);font-size:.82rem;margin-top:.6rem;font-weight:600;}
.upload-progress{height:6px;background:var(--border);border-radius:3px;margin-top:1rem;overflow:hidden;display:none;}
.upload-progress-bar{height:100%;background:linear-gradient(90deg,var(--purple),var(--pink));border-radius:3px;transition:width .2s;width:0%;}
.test-gen-card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:2rem;margin-bottom:2rem;}
.test-gen-card h4{font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:700;margin-bottom:1.5rem;color:var(--accent);}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;}
.form-group{display:flex;flex-direction:column;gap:.35rem;}
.form-group.full{grid-column:1/-1;}
.form-group label{font-size:.72rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);}
.form-group input,.form-group select,.form-group textarea{background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--text);padding:.7rem .9rem;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:.88rem;outline:none;transition:border-color .2s;}
.form-group input:focus,.form-group select:focus{border-color:var(--purple);}
.form-group select option{background:#1a1628;}
.qtype-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem;}
.qtype-opt{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border);cursor:pointer;transition:all .2s;}
.qtype-opt input[type=checkbox]{accent-color:var(--purple);width:15px;height:15px;}
.qtype-opt label{font-size:.83rem;cursor:pointer;}
.qtype-opt:hover{border-color:var(--purple);}
.generated-test{background:var(--card2);border:1px solid var(--border);border-radius:20px;padding:2rem;margin-top:1.5rem;}
.test-header-info{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border);}
.test-header-info h3{font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:800;color:var(--accent);}
.test-meta-pills{display:flex;gap:.5rem;flex-wrap:wrap;}
.test-q{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.2rem 1.5rem;margin-bottom:1rem;}
.test-q .q-num{font-size:.72rem;font-weight:700;color:var(--pl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem;}
.test-q .q-type-badge{display:inline-block;padding:.15rem .6rem;border-radius:50px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-bottom:.6rem;}
.test-q .q-text{font-size:.9rem;line-height:1.6;margin-bottom:.8rem;}
.test-q .q-options{display:flex;flex-direction:column;gap:.4rem;}
.test-q .q-option{display:flex;align-items:center;gap:.6rem;padding:.5rem .8rem;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--border);font-size:.83rem;cursor:pointer;transition:all .15s;}
.test-q .q-option:hover{background:rgba(139,92,246,.08);border-color:var(--purple);}
.test-q .q-option input{accent-color:var(--purple);}
.test-q .q-option .opt-label{font-weight:700;color:var(--pl);min-width:1.2rem;}
.test-q .q-answer-space{margin-top:.6rem;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:.8rem;min-height:60px;color:var(--muted);font-size:.8rem;}
.test-q .q-mark{color:var(--muted);font-size:.75rem;margin-top:.6rem;}
.test-q .q-answer-reveal{margin-top:.8rem;padding:.8rem;border-radius:8px;background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);font-size:.83rem;display:none;}
.test-q .q-answer-reveal.show{display:block;}
.test-actions{display:flex;gap:.8rem;margin-top:1.5rem;}
.gen-loading{display:flex;align-items:center;justify-content:center;gap:.8rem;padding:2.5rem;color:var(--muted);}
.spinner{width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--purple);border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0;}
.admin-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;flex-wrap:wrap;gap:1rem;}
.admin-header h2{font-family:'Syne',sans-serif;font-size:1.8rem;font-weight:800;}
.admin-badge{background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.3);color:var(--green);padding:.28rem .7rem;border-radius:50px;font-size:.72rem;font-weight:700;display:inline-block;margin-top:.3rem;}
.add-form{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:1.8rem;margin-bottom:1.5rem;}
.add-form h4{font-family:'Syne',sans-serif;font-size:1rem;font-weight:700;margin-bottom:1.3rem;color:var(--accent);}
.form-submit{margin-top:1.3rem;background:linear-gradient(135deg,var(--purple),var(--pink));color:white;border:none;padding:.8rem 1.8rem;border-radius:10px;font-family:'Syne',sans-serif;font-weight:700;font-size:.88rem;cursor:pointer;transition:opacity .2s;}
.form-submit:hover{opacity:.85;}
.form-submit:disabled{opacity:.4;cursor:not-allowed;}
.resource-list{display:flex;flex-direction:column;gap:.8rem;}
.resource-item{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;}
.resource-item-info h5{font-family:'Syne',sans-serif;font-size:.9rem;font-weight:700;}
.resource-item-info p{color:var(--muted);font-size:.75rem;margin-top:.2rem;}
.meta-tags{display:flex;gap:.35rem;flex-wrap:wrap;}
.meta-tag{background:rgba(139,92,246,.12);color:var(--accent);padding:.12rem .55rem;border-radius:50px;font-size:.68rem;font-weight:600;border:1px solid rgba(139,92,246,.2);}
.btn-delete{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.3);color:var(--red);padding:.38rem .85rem;border-radius:8px;cursor:pointer;font-size:.78rem;font-weight:600;font-family:'DM Sans',sans-serif;transition:background .2s;}
.btn-delete:hover{background:rgba(248,113,113,.25);}
.user-list-item{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.1rem 1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.8rem;}
.user-list-item h5{font-family:'Syne',sans-serif;font-size:.9rem;font-weight:700;}
.user-list-item p{color:var(--muted);font-size:.75rem;margin-top:.2rem;}
#feedbackFab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:190;background:linear-gradient(180deg,var(--purple),var(--pink));color:white;border:none;cursor:pointer;padding:.7rem .45rem;border-radius:12px 0 0 12px;font-family:'Syne',sans-serif;font-weight:700;font-size:.72rem;letter-spacing:1.5px;writing-mode:vertical-rl;box-shadow:-4px 0 20px rgba(139,92,246,.4);transition:transform .3s;display:flex;align-items:center;gap:.5rem;}
#feedbackFab:hover{transform:translateY(-50%) translateX(-4px);}
.feedback-type-grid{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:.8rem 0 1rem;}
.ftype-opt{background:rgba(255,255,255,.04);border:2px solid var(--border);border-radius:12px;padding:.9rem;text-align:center;cursor:pointer;transition:all .2s;}
.ftype-opt:hover,.ftype-opt.selected{border-color:var(--purple);background:rgba(139,92,246,.12);}
.ftype-opt .ft-icon{font-size:1.6rem;display:block;margin-bottom:.3rem;}
.ftype-opt h5{font-family:'Syne',sans-serif;font-size:.85rem;font-weight:700;}
.ftype-opt p{color:var(--muted);font-size:.7rem;margin-top:.15rem;}
.star-rating{display:flex;gap:.4rem;margin:.5rem 0;}
.star{font-size:1.5rem;cursor:pointer;transition:transform .15s;opacity:.4;user-select:none;}
.star.lit{opacity:1;color:var(--yellow);}
.feedback-table-wrap{overflow-x:auto;border-radius:14px;border:1px solid var(--border);margin-top:1rem;}
.feedback-table{width:100%;border-collapse:collapse;font-size:.82rem;}
.feedback-table th{background:rgba(139,92,246,.12);color:var(--accent);font-weight:700;padding:.7rem 1rem;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;}
.feedback-table td{padding:.65rem 1rem;border-bottom:1px solid rgba(42,34,64,.5);color:var(--text);vertical-align:top;}
.feedback-table tr:last-child td{border-bottom:none;}
.type-pill{display:inline-block;padding:.15rem .55rem;border-radius:50px;font-size:.68rem;font-weight:700;text-transform:uppercase;}
.type-feedback{background:rgba(34,211,238,.1);color:var(--cyan);border:1px solid rgba(34,211,238,.25);}
.type-request{background:rgba(139,92,246,.1);color:var(--pl);border:1px solid rgba(139,92,246,.25);}
.type-bug{background:rgba(248,113,113,.1);color:var(--red);border:1px solid rgba(248,113,113,.25);}
.type-suggestion{background:rgba(74,222,128,.1);color:var(--green);border:1px solid rgba(74,222,128,.25);}
.feedback-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem;margin-bottom:1.2rem;}
.feedback-toolbar h4{font-family:'Syne',sans-serif;font-size:1rem;font-weight:700;}
.toast{position:fixed;bottom:2rem;right:2rem;z-index:9999;background:var(--card);border:1px solid rgba(74,222,128,.4);color:var(--green);padding:.9rem 1.4rem;border-radius:12px;font-size:.85rem;font-weight:600;transform:translateY(100px);opacity:0;transition:all .4s cubic-bezier(.34,1.56,.64,1);pointer-events:none;max-width:300px;}
.toast.show{transform:translateY(0);opacity:1;}
.toast.error{border-color:rgba(248,113,113,.4);color:var(--red);}
.reveal{opacity:0;transform:translateY(20px);transition:opacity .6s ease,transform .6s ease;}
.reveal.visible{opacity:1;transform:translateY(0);}
#chatFab{position:fixed;bottom:2rem;left:2rem;z-index:190;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--pink));border:none;cursor:pointer;font-size:1.5rem;box-shadow:0 4px 24px rgba(139,92,246,.55);display:flex;align-items:center;justify-content:center;transition:transform .3s;animation:fabGlow 2.5s ease-in-out infinite;}
#chatFab:hover{transform:scale(1.1);}
@keyframes fabGlow{0%,100%{box-shadow:0 4px 24px rgba(139,92,246,.55);}50%{box-shadow:0 4px 40px rgba(236,72,153,.7);}}
#chatWindow{position:fixed;bottom:6.5rem;left:2rem;z-index:190;width:360px;max-width:calc(100vw - 4rem);background:var(--card);border:1px solid var(--border);border-radius:22px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;transform:scale(.85) translateY(20px);opacity:0;pointer-events:none;transition:all .3s cubic-bezier(.34,1.3,.64,1);max-height:520px;}
#chatWindow.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}
.chat-header{padding:.9rem 1.1rem;background:linear-gradient(135deg,rgba(139,92,246,.25),rgba(236,72,153,.12));border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.chat-header-left{display:flex;align-items:center;gap:.6rem;}
.chat-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--pink));display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;font-weight:700;}
.chat-title{font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;}
.chat-sub{color:var(--green);font-size:.68rem;font-weight:600;display:flex;align-items:center;gap:.3rem;}
.online-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 1.5s infinite;}
.chat-close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;line-height:1;}
.chat-messages{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem;min-height:220px;max-height:280px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;}
.msg{display:flex;gap:.4rem;animation:fadeUp .25s ease both;}
.msg.user{flex-direction:row-reverse;}
.msg-av{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--pink));display:flex;align-items:center;justify-content:center;font-size:.65rem;flex-shrink:0;margin-top:auto;}
.msg.user .msg-av{background:rgba(139,92,246,.3);}
.msg-bubble{max-width:84%;padding:.6rem .85rem;border-radius:14px;font-size:.82rem;line-height:1.6;}
.msg.bot .msg-bubble{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);color:var(--text);border-bottom-left-radius:3px;}
.msg.user .msg-bubble{background:linear-gradient(135deg,var(--purple),var(--pink));color:white;border-bottom-right-radius:3px;}
.typing-bubble{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);border-radius:14px;border-bottom-left-radius:3px;padding:.6rem .85rem;display:flex;gap:4px;align-items:center;}
.typing-bubble span{width:6px;height:6px;border-radius:50%;background:var(--pl);animation:bounce 1.2s infinite;}
.typing-bubble span:nth-child(2){animation-delay:.2s;}
.typing-bubble span:nth-child(3){animation-delay:.4s;}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-5px);opacity:1;}}
.chat-chips{display:flex;flex-wrap:wrap;gap:.35rem;padding:.4rem .9rem .6rem;}
.chip{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);color:var(--accent);padding:.25rem .7rem;border-radius:50px;font-size:.7rem;font-weight:600;cursor:pointer;transition:background .2s;white-space:nowrap;}
.chip:hover{background:rgba(139,92,246,.25);}
.chat-input-area{padding:.7rem;border-top:1px solid var(--border);display:flex;gap:.45rem;flex-shrink:0;}
#chatInput{flex:1;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text);padding:.6rem .85rem;border-radius:50px;font-family:'DM Sans',sans-serif;font-size:.83rem;outline:none;transition:border-color .2s;}
#chatInput:focus{border-color:var(--purple);}
#chatInput::placeholder{color:var(--muted);}
#chatSend{background:linear-gradient(135deg,var(--purple),var(--pink));border:none;color:white;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:.95rem;display:flex;align-items:center;justify-content:center;transition:opacity .2s,transform .2s;flex-shrink:0;}
#chatSend:hover{opacity:.85;transform:scale(1.08);}
#chatSend:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.ai-tutor-banner{background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);border-radius:12px;padding:1rem;margin-bottom:1.5rem;font-size:.83rem;color:var(--accent);display:flex;align-items:center;gap:.6rem;}
.ai-tutor-banner .icon{font-size:1.5rem;}
.tts-btn{background:none;border:none;cursor:pointer;font-size:1rem;padding:.15rem .3rem;border-radius:4px;opacity:.6;transition:opacity .2s;align-self:flex-end;flex-shrink:0;line-height:1;}
.tts-btn:hover{opacity:1;}
@media(max-width:768px){
  .dashboard-layout{grid-template-columns:1fr;}
  .dashboard-sidebar{border-right:none;border-bottom:1px solid var(--border);padding-right:0;padding-bottom:1rem;flex-direction:row;overflow-x:auto;}
  .form-grid,.qtype-grid,.role-select,.feedback-type-grid{grid-template-columns:1fr;}
  .form-group.full{grid-column:1;}
}
@media print {
  body { background: white; color: black; }
  nav, #chatFab, #chatWindow, #feedbackFab, .dashboard-sidebar, .test-actions, .cta-section, footer, .overview-stats, .test-gen-card { display: none !important; }
  .page { padding-top: 0 !important; }
  .dashboard-layout { grid-template-columns: 1fr !important; }
  .generated-test { background: transparent !important; border: none !important; padding: 0 !important; margin: 0 !important; }
  .test-q { background: white !important; border: 1px solid #ccc !important; color: black !important; page-break-inside: avoid; }
  .test-q .q-option { background: white !important; border: 1px solid #ccc !important; color: black !important; }
  .test-q .q-answer-space { border: 1px solid #ccc !important; background: white !important; min-height: 100px !important; }
}
</style>
</head>
<body>

<nav>
  <div class="logo" onclick="showPage('home')">Nest<span>IQ</span></div>
  <ul class="nav-links">
    <li><a onclick="showPage('home')" id="nav-home" class="active">Home</a></li>
    <li><a onclick="scrollToSection('boards')">Boards</a></li>
    <li><a onclick="showPage('resources')" id="nav-resources">Resources</a></li>
    <li><a onclick="showPage('portal')" id="nav-portal" class="nav-pill" style="display:none;">My Dashboard</a></li>
    <li><a onclick="openAuthModal()" id="nav-login-btn" class="nav-pill">Login / Register</a></li>
    <li class="nav-user-info" id="nav-user-info">
      <div class="nav-dot"></div>
      <span class="nav-user-name" id="nav-user-name">User</span>
      <button class="nav-logout" onclick="logout()">Logout</button>
    </li>
  </ul>
</nav>

<!-- ── HOME PAGE ────────────────────────────────────────────── -->
<div id="homePage" class="page active">
  <div class="hero">
    <div class="hero-badge">Curriculum-Aligned Study Materials</div>
    <h1>
      <span class="line1">Free Resources for</span>
      <span class="line2">Every Indian Student</span>
    </h1>
    <p>Unlock notes, syllabi, specimen papers, and revision files for CBSE, ICSE, and State Boards. Practice with our custom AI Mock Test Generator and study smarter with Study Nest AI — your on-device academic tutor.</p>
    <div class="hero-btns">
      <a class="btn btn-grad" onclick="scrollToSection('boards')">✦ Explore Boards</a>
      <a class="btn btn-outline" onclick="showPage('resources')">Browse Files</a>
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-num" id="stat-resources">3+</div>
      <div class="stat-label">Verified Materials</div>
    </div>
    <div class="stat">
      <div class="stat-num" id="stat-students">100+</div>
      <div class="stat-label">Students Learning</div>
    </div>
    <div class="stat">
      <div class="stat-num" id="stat-teachers">5+</div>
      <div class="stat-label">Expert Educators</div>
    </div>
    <div class="stat">
      <div class="stat-num" id="stat-downloads">200+</div>
      <div class="stat-label">Total Downloads</div>
    </div>
  </div>

  <section id="boards">
    <div class="section-tag">Board Curriculums</div>
    <h2 class="section-title">Select Your Syllabus</h2>
    <p class="section-sub">Browse resource archives structured according to recent Board exam patterns and syllabus specifications.</p>
    
    <div class="boards-grid">
      <div class="board-card" onclick="selectBoardAndLoad('CBSE')">
        <div class="icon">🏫</div>
        <h3>CBSE Board</h3>
        <p>Class 9–12 notes, Chapter formulas, and Mock test papers matching NCRT guidelines.</p>
        <div class="subjects">
          <span class="tag">Maths</span>
          <span class="tag">Science</span>
          <span class="tag">Chemistry</span>
        </div>
      </div>
      <div class="board-card" onclick="selectBoardAndLoad('ICSE')">
        <div class="icon">📘</div>
        <h3>ICSE & ISC</h3>
        <p>Comprehensive subject revision guidelines, structured reference manuals, and mock assessments.</p>
        <div class="subjects">
          <span class="tag">Physics</span>
          <span class="tag">Biology</span>
          <span class="tag">English</span>
        </div>
      </div>
      <div class="board-card" onclick="selectBoardAndLoad('State')">
        <div class="icon">🏛️</div>
        <h3>State Board</h3>
        <p>Secondary & Higher Secondary resources tailored for local State Education standard syllabi.</p>
        <div class="subjects">
          <span class="tag">Syllabus</span>
          <span class="tag">Notes</span>
          <span class="tag">Question Bank</span>
        </div>
      </div>
    </div>
  </section>

  <div class="divider"></div>

  <section>
    <div class="section-tag">Features</div>
    <h2 class="section-title">How NestIQ Empowers You</h2>
    <p class="section-sub">A comprehensive suite of tools built for students to study, review, test, and request materials effortlessly.</p>
    
    <div class="steps">
      <div class="step">
        <div class="step-num">01</div>
        <h4>Instant Sign Up</h4>
        <p>Create a student or teacher account to log and track study progress.</p>
      </div>
      <div class="step">
        <div class="step-num">02</div>
        <h4>Search & Save</h4>
        <p>Download board resources in PDF format, save files to your favourites checklist.</p>
      </div>
      <div class="step">
        <div class="step-num">03</div>
        <h4>Chat with AI Tutor</h4>
        <p>Use the integrated Study Nest AI chat widget to solve numericals, clarify definitions, and get step-by-step explanations instantly.</p>
      </div>
      <div class="step">
        <div class="step-num">04</div>
        <h4>Generate Test Sheets</h4>
        <p>Configure a custom mock test with targeted questions, scoring keys, and evaluation schemes.</p>
      </div>
    </div>
  </section>

  <div class="divider"></div>

  <div class="cta-section">
    <div class="cta-box">
      <h2>Ready to Start Excelling?</h2>
      <p>Sign up now to unlock custom AI study dashboards and log revision documents.</p>
      <a class="btn btn-grad" onclick="openAuthModal()">Get Started for Free</a>
    </div>
  </div>
</div>

<!-- ── RESOURCES PAGE ───────────────────────────────────────── -->
<div id="resourcesPage" class="page">
  <section style="padding: 2rem 5%;">
    <div class="section-tag">Resource Hub</div>
    <h2 class="section-title">All Study Materials</h2>
    <p class="section-sub">Download formulas, practice booklets, syllabus checklists, and revision summaries.</p>

    <div style="background:var(--card2); border:1px solid var(--border); padding: 1.5rem; border-radius: 18px; margin-bottom: 2rem;">
      <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div class="form-group">
          <label>Board</label>
          <select id="filter-board" onchange="onFilterChange()">
            <option value="all">All Boards</option>
            <option value="CBSE">CBSE</option>
            <option value="ICSE">ICSE / ISC</option>
            <option value="State">State Boards</option>
          </select>
        </div>
        <div class="form-group">
          <label>Resource Type</label>
          <select id="filter-type" onchange="onFilterChange()">
            <option value="all">All Types</option>
            <option value="Note">Notes</option>
            <option value="Mock Paper">Mock Papers</option>
            <option value="Syllabus">Syllabus Guide</option>
            <option value="Textbook">Textbooks</option>
          </select>
        </div>
        <div class="form-group">
          <label>Class Level</label>
          <select id="filter-class" onchange="onFilterChange()">
            <option value="all">All Classes</option>
            <option value="Class 9">Class 9</option>
            <option value="Class 10">Class 10</option>
            <option value="Class 11">Class 11</option>
            <option value="Class 12">Class 12</option>
          </select>
        </div>
        <div class="form-group">
          <label>Search Title</label>
          <input type="text" id="filter-search" placeholder="Type to search..." oninput="onFilterChange()">
        </div>
      </div>
    </div>

    <div class="pub-grid" id="resourcesGrid">
      <!-- Loaded dynamically -->
    </div>
  </section>
</div>

<!-- ── PORTAL PAGE (DYNAMIC BY ROLE) ────────────────────────── -->
<div id="portalPage" class="page">
  <section style="padding: 2rem 5%;">
    <div class="dashboard-layout">
      <!-- SIDEBAR -->
      <div class="dashboard-sidebar" id="dashboard-sidebar">
        <!-- Rendered based on user role -->
      </div>
      
      <!-- MAIN PANEL -->
      <div class="dashboard-content">
        <div class="dashboard-header">
          <div>
            <h2 id="portal-welcome-title">Welcome Back!</h2>
            <span class="admin-badge" id="portal-role-badge">Student</span>
          </div>
          <div style="font-size: .8rem; color: var(--muted);" id="portal-joined-date">Joined: 10/10/2025</div>
        </div>

        <div id="portal-panels-container">
          <!-- Overview Tab -->
          <div id="tab-overview" class="dash-panel active">
            <div class="overview-stats" id="overview-stats-grid">
              <!-- Dynamically populated -->
            </div>
            
            <div style="background:var(--card); border:1px solid var(--border); border-radius:18px; padding:1.5rem;">
              <h4 style="font-family:'Syne',sans-serif; margin-bottom:1rem;">Your Quick Access Directory</h4>
              <p style="color:var(--muted); font-size:.85rem; line-height:1.6;">Navigate using the sidebar options to manage your downloads, favorites checklist, custom test generation tools, and administrative database parameters.</p>
            </div>
          </div>

          <!-- Favourites Tab -->
          <div id="tab-favourites" class="dash-panel">
            <h4 style="font-family:'Syne',sans-serif; margin-bottom:1.2rem;">Favourited Materials</h4>
            <div class="fav-grid" id="favouritesGrid">
              <!-- Loaded dynamically -->
            </div>
          </div>

          <!-- Downloads Tab -->
          <div id="tab-downloads" class="dash-panel">
            <h4 style="font-family:'Syne',sans-serif; margin-bottom:1.2rem;">Your Download History</h4>
            <div class="dl-list" id="downloadsList">
              <!-- Loaded dynamically -->
            </div>
          </div>

          <!-- Mock Test Generator Tab -->
          <div id="tab-test-generator" class="dash-panel">
            <div class="test-gen-card">
              <h4>Mock Test Generator</h4>
              <form id="testGenForm" onsubmit="generateTestSheet(event)">
                <div class="form-grid">
                  <div class="form-group">
                    <label>Board</label>
                    <select id="gen-board" required>
                      <option value="CBSE">CBSE</option>
                      <option value="ICSE">ICSE</option>
                      <option value="State">State Board</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Class Level</label>
                    <select id="gen-class" required>
                      <option value="Class 10">Class 10</option>
                      <option value="Class 12">Class 12</option>
                      <option value="Class 9">Class 9</option>
                      <option value="Class 11">Class 11</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Subject</label>
                    <input type="text" id="gen-subject" placeholder="e.g. Mathematics, Physics" required>
                  </div>
                  <div class="form-group">
                    <label>Topic / Chapter</label>
                    <input type="text" id="gen-topic" placeholder="e.g. Quadratic Equations, Optics" required>
                  </div>
                  <div class="form-group">
                    <label>Difficulty</label>
                    <select id="gen-diff">
                      <option value="Medium">Medium</option>
                      <option value="Easy">Easy</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Total Marks</label>
                    <input type="number" id="gen-marks" value="20" min="5" max="100" required>
                  </div>
                  <div class="form-group full">
                    <label>Question Formats</label>
                    <div class="qtype-grid">
                      <div class="qtype-opt">
                        <input type="checkbox" id="q-mcq" checked>
                        <label for="q-mcq">Multiple Choice (MCQ)</label>
                      </div>
                      <div class="qtype-opt">
                        <input type="checkbox" id="q-sa" checked>
                        <label for="q-sa">Short Answer (SA)</label>
                      </div>
                      <div class="qtype-opt">
                        <input type="checkbox" id="q-la">
                        <label for="q-la">Long Answer (LA)</label>
                      </div>
                      <div class="qtype-opt">
                        <input type="checkbox" id="q-fib">
                        <label for="q-fib">Fill in the Blanks (FIB)</label>
                      </div>
                    </div>
                  </div>
                  <div class="form-group full">
                    <label>Special Instructions (Optional)</label>
                    <textarea id="gen-instructions" rows="2" placeholder="e.g., Focus on numerical proofs..."></textarea>
                  </div>
                </div>
                <button type="submit" class="form-submit" id="btn-submit-test-gen">✦ Generate Test Sheet</button>
              </form>
            </div>

            <!-- Generated Test Display Container -->
            <div id="testDisplayContainer"></div>
          </div>

          <!-- Saved Tests Tab -->
          <div id="tab-saved-tests" class="dash-panel">
            <h4 style="font-family:'Syne',sans-serif; margin-bottom:1.2rem;">Generated Tests Archive</h4>
            <div class="dl-list" id="savedTestsList">
              <!-- Loaded dynamically -->
            </div>
            
            <div id="archivedTestDisplay" style="margin-top:2rem;"></div>
          </div>

          <!-- Admin Resource Upload -->
          <div id="tab-admin-upload" class="dash-panel">
            <div class="add-form">
              <h4>Publish New Material</h4>
              <form id="resourceUploadForm" onsubmit="handleResourceUpload(event)">
                <div class="form-grid">
                  <div class="form-group">
                    <label>Title</label>
                    <input type="text" name="title" placeholder="e.g. Electrostatics Notes" required>
                  </div>
                  <div class="form-group">
                    <label>Board</label>
                    <select name="board" required>
                      <option value="CBSE">CBSE</option>
                      <option value="ICSE">ICSE</option>
                      <option value="State">State Board</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Class Level</label>
                    <select name="classLevel" required>
                      <option value="Class 10">Class 10</option>
                      <option value="Class 12">Class 12</option>
                      <option value="Class 9">Class 9</option>
                      <option value="Class 11">Class 11</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Subject</label>
                    <input type="text" name="subject" placeholder="e.g. Physics" required>
                  </div>
                  <div class="form-group">
                    <label>Resource Type</label>
                    <select name="type" required>
                      <option value="Note">Note</option>
                      <option value="Mock Paper">Mock Paper</option>
                      <option value="Syllabus">Syllabus Guide</option>
                      <option value="Textbook">Textbook</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Price</label>
                    <input type="text" name="price" value="Free">
                  </div>
                  <div class="form-group full">
                    <label>Description</label>
                    <textarea name="description" rows="3" placeholder="Brief outline of contents..."></textarea>
                  </div>
                  <div class="form-group full">
                    <label>File Upload (PDF, Word, Images)</label>
                    <div class="upload-zone" id="dropzone">
                      <span class="uz-icon">📁</span>
                      <p>Drag and drop your file here, or <span>browse files</span></p>
                      <input type="file" name="file" id="fileInput" required onchange="onFileSelected()">
                    </div>
                    <div class="file-chosen" id="selectedFileName"></div>
                    <div class="upload-progress" id="uploadProgress">
                      <div class="upload-progress-bar" id="uploadProgressBar"></div>
                    </div>
                  </div>
                </div>
                <button type="submit" class="form-submit">✦ Publish Resource</button>
              </form>
            </div>
          </div>

          <!-- Admin Manage Resources -->
          <div id="tab-admin-resources" class="dash-panel">
            <h4 style="font-family:'Syne',sans-serif; margin-bottom:1.2rem;">All Published Materials</h4>
            <div class="dl-list" id="adminResourcesList">
              <!-- Loaded dynamically -->
            </div>
          </div>

          <!-- Admin Manage Users -->
          <div id="tab-admin-users" class="dash-panel">
            <h4 style="font-family:'Syne',sans-serif; margin-bottom:1.2rem;">Registered Accounts</h4>
            <div id="adminUsersList">
              <!-- Loaded dynamically -->
            </div>
          </div>

          <!-- Admin Feedback -->
          <div id="tab-admin-feedback" class="dash-panel">
            <div class="feedback-toolbar">
              <h4>Student Feedback & Requests</h4>
              <button class="btn btn-sm btn-green" onclick="exportFeedbackCsv()">⬇ Export Feedback (CSV)</button>
            </div>
            <div class="feedback-table-wrap">
              <table class="feedback-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>User</th>
                    <th>Message</th>
                    <th>Ref Topic</th>
                    <th>Rating</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody id="adminFeedbackBody">
                  <!-- Loaded dynamically -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>

<!-- ── AUTH MODAL ───────────────────────────────────────────── -->
<div class="modal-overlay" id="authModal">
  <div class="modal">
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <h3 id="authModalTitle">Sign In</h3>
      <button class="chat-close" style="font-size:1.4rem;" onclick="closeAuthModal()">×</button>
    </div>
    <div class="sub">Register or log in to customize dashboards and practice mock tests.</div>
    
    <div class="auth-tabs" id="authTabs">
      <button class="auth-tab active" onclick="switchAuthTab('login')">Log In</button>
      <button class="auth-tab" onclick="switchAuthTab('signup')">Register</button>
      <button class="auth-tab" onclick="switchAuthTab('admin')">Admin</button>
    </div>

    <!-- Login Form -->
    <form id="loginForm" onsubmit="handleAuthSubmit(event, 'login')">
      <div class="form-group">
        <label>Email Address</label>
        <input type="email" id="login-email" placeholder="student@nestiq.com" required>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="login-pass" placeholder="••••••••" required>
      </div>
      <div class="modal-error" id="login-error">Invalid details.</div>
      <div class="modal-btns">
        <button type="button" class="btn-cancel" onclick="closeAuthModal()">Cancel</button>
        <button type="submit" class="btn-login-go">Log In</button>
      </div>
    </form>

    <!-- Register Form -->
    <form id="signupForm" onsubmit="handleAuthSubmit(event, 'signup')" style="display:none;">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" id="signup-name" placeholder="e.g. Rohan Sharma" required>
      </div>
      <div class="form-group">
        <label>Email Address</label>
        <input type="email" id="signup-email" placeholder="name@domain.com" required>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="signup-pass" placeholder="Min 6 characters" required>
      </div>
      <div class="form-group">
        <label>I am a...</label>
        <div class="role-select">
          <div class="role-opt selected" id="opt-student" onclick="selectSignupRole('student')">
            <span class="r-icon">🎓</span>
            <h4>Student</h4>
            <p>Access & generate practice sheets</p>
          </div>
          <div class="role-opt" id="opt-teacher" onclick="selectSignupRole('teacher')">
            <span class="r-icon">👨‍🏫</span>
            <h4>Teacher</h4>
            <p>Review files & dashboard details</p>
          </div>
        </div>
      </div>
      <div class="modal-error" id="signup-error">Unable to register.</div>
      <div class="modal-btns">
        <button type="button" class="btn-cancel" onclick="closeAuthModal()">Cancel</button>
        <button type="submit" class="btn-login-go">Register</button>
      </div>
    </form>

    <!-- Admin Form -->
    <form id="adminForm" onsubmit="handleAuthSubmit(event, 'admin')" style="display:none;">
      <div class="form-group">
        <label>Admin Email</label>
        <input type="email" id="admin-email" placeholder="tarunbaalalingam@gmail.com" required>
      </div>
      <div class="form-group">
        <label>Secret Password</label>
        <input type="password" id="admin-pass" placeholder="••••••••" required>
      </div>
      <div class="modal-error" id="admin-error">Incorrect admin credentials.</div>
      <div class="modal-btns">
        <button type="button" class="btn-cancel" onclick="closeAuthModal()">Cancel</button>
        <button type="submit" class="btn-login-go">Admin Access</button>
      </div>
    </form>
  </div>
</div>

<!-- ── FLOATING FEEDBACK FORM ──────────────────────────────── -->
<button id="feedbackFab" onclick="openFeedbackModal()">
  <span>FEEDBACK</span> ✉
</button>

<div class="modal-overlay" id="feedbackModal">
  <div class="modal">
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <h3>Submit Feedback</h3>
      <button class="chat-close" style="font-size:1.4rem;" onclick="closeFeedbackModal()">×</button>
    </div>
    <div class="sub">Request resources, report issues, or suggest updates.</div>

    <form id="feedbackForm" onsubmit="handleFeedbackSubmit(event)">
      <label>Feedback Category</label>
      <div class="feedback-type-grid">
        <div class="ftype-opt selected" id="f-feedback" onclick="setFeedbackType('feedback')">
          <span class="ft-icon">💬</span>
          <h5>Feedback</h5>
        </div>
        <div class="ftype-opt" id="f-request" onclick="setFeedbackType('request')">
          <span class="ft-icon">📂</span>
          <h5>Request File</h5>
        </div>
        <div class="ftype-opt" id="f-bug" onclick="setFeedbackType('bug')">
          <span class="ft-icon">🐛</span>
          <h5>Report Bug</h5>
        </div>
        <div class="ftype-opt" id="f-suggestion" onclick="setFeedbackType('suggestion')">
          <span class="ft-icon">💡</span>
          <h5>Suggestion</h5>
        </div>
      </div>

      <div class="form-group">
        <label>Overall Rating</label>
        <div class="star-rating" id="star-container">
          <span class="star lit" onclick="setFeedbackRating(1)">★</span>
          <span class="star lit" onclick="setFeedbackRating(2)">★</span>
          <span class="star lit" onclick="setFeedbackRating(3)">★</span>
          <span class="star lit" onclick="setFeedbackRating(4)">★</span>
          <span class="star lit" onclick="setFeedbackRating(5)">★</span>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label>Subject (Optional)</label>
          <input type="text" id="f-subject" placeholder="e.g. Chemistry">
        </div>
        <div class="form-group">
          <label>Topic Reference (Optional)</label>
          <input type="text" id="f-topic" placeholder="e.g. Organic roadmap">
        </div>
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label>Your Name</label>
          <input type="text" id="f-name" placeholder="Anonymous">
        </div>
        <div class="form-group">
          <label>Your Email (Optional)</label>
          <input type="email" id="f-email" placeholder="name@domain.com">
        </div>
      </div>

      <div class="form-group">
        <label>Message details</label>
        <textarea id="f-message" rows="3" placeholder="Provide details here..." required></textarea>
      </div>

      <div class="modal-btns">
        <button type="button" class="btn-cancel" onclick="closeFeedbackModal()">Cancel</button>
        <button type="submit" class="btn-login-go">Submit</button>
      </div>
    </form>
  </div>
</div>

<!-- ── FLOATING AI TUTOR CHAT WIDGET ────────────────────────── -->
<button id="chatFab" onclick="toggleChatWindow()">🤖</button>

<div id="chatWindow">
  <div class="chat-header">
    <div class="chat-header-left">
      <div class="chat-av">IQ</div>
      <div>
        <div class="chat-title">Study Nest AI</div>
        <div class="chat-sub"><span class="online-dot"></span>NestIQ Academic Tutor</div>
      </div>
    </div>
    <button class="chat-close" onclick="toggleChatWindow()">×</button>
  </div>

  <div class="chat-messages" id="chat-messages-box">
    <div class="msg bot">
      <div class="msg-av">AI</div>
      <div class="msg-bubble">Hello! I am Study Nest AI, your academic tutor on NestIQ. Ask me anything about your CBSE, ICSE, or State Board subjects — I can solve numericals, explain concepts, and help you find study materials. 🇮🇳</div>
    </div>
  </div>

  <div class="chat-chips">
    <span class="chip" onclick="sendChipPrompt('Explain Quadratic Formula and derivation')">Explain Quadratic Formula</span>
    <span class="chip" onclick="sendChipPrompt('Important ICSE Class 10 Physics topics')">ICSE 10 Physics Topics</span>
    <span class="chip" onclick="sendChipPrompt('State Board revision tips')">Boards Revision Tips</span>
  </div>

  <div class="chat-input-area">
    <input type="text" id="chatInput" placeholder="Ask a science or maths question..." onkeydown="if(event.key==='Enter') sendChatFromInput()">
    <button id="chatSend" onclick="sendChatFromInput()">➔</button>
  </div>
</div>

<!-- TOAST FOR SYSTEM NOTIFICATIONS -->
<div class="toast" id="toastBox">Action complete!</div>

<!-- ══════════════════════════════════════════════════════════════
      JAVASCRIPT FRONTEND CONTROLLER
     ══════════════════════════════════════════════════════════════ -->
<script>
// --- CLIENT STATE ---
let userToken = localStorage.getItem('nestiq_token') || null;
let currentUser = null;
let cachedResources = [];
let signupRole = 'student';
let feedbackType = 'feedback';
let feedbackRating = 5;
let activePortalTab = 'overview';
let activeSignupRole = 'student';

// --- API FETCH HELPER ---
async function apiCall(endpoint, method = 'GET', body = null, isMultipart = false) {
  const headers = {};
  if (userToken) {
    headers['Authorization'] = 'Bearer ' + userToken;
  }
  if (!isMultipart && body) {
    headers['Content-Type'] = 'application/json';
  }

  const options = { method, headers };
  if (body) {
    options.body = isMultipart ? body : JSON.stringify(body);
  }

  const res = await fetch(endpoint, options);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Request failed with status ' + res.status);
  }
  return res.json();
}

// --- INITIAL BOOTSTRAPPING ---
window.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await checkUserSession();
  await loadResourcesHub();
  setupDragAndDrop();
});

// --- LOAD HOME STATS ---
async function loadStats() {
  try {
    // If admin is logged in, we fetch fresh stats, else show default counts
    if (currentUser && currentUser.role === 'admin') {
      const stats = await apiCall('/api/admin/stats');
      document.getElementById('stat-resources').innerText = stats.resources;
      document.getElementById('stat-students').innerText = stats.students;
      document.getElementById('stat-teachers').innerText = stats.teachers;
      document.getElementById('stat-downloads').innerText = stats.downloads;
    }
  } catch(e) {
    console.warn('Could not load dynamic admin stats:', e.message);
  }
}

// --- USER SESSION CHECK ---
async function checkUserSession() {
  if (!userToken) {
    updateNavUI(null);
    return;
  }
  try {
    // If the token is 'admin-token', set admin user locally
    if (localStorage.getItem('nestiq_role') === 'admin') {
      currentUser = { name: 'Portal Admin', email: CONFIG_ADMIN_EMAIL(), role: 'admin', joined: 'System Init' };
      updateNavUI(currentUser);
      return;
    }

    const userData = await apiCall('/api/auth/me');
    currentUser = userData;
    updateNavUI(currentUser);
  } catch(e) {
    console.error('Session validation error:', e.message);
    logout();
  }
}

function CONFIG_ADMIN_EMAIL() {
  return 'tarunbaalalingam@gmail.com';
}

function updateNavUI(user) {
  const loginBtn = document.getElementById('nav-login-btn');
  const userInfo = document.getElementById('nav-user-info');
  const portalBtn = document.getElementById('nav-portal');
  const nameLabel = document.getElementById('nav-user-name');

  if (user) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    portalBtn.style.display = 'inline-block';
    nameLabel.innerText = user.name || 'User';
    
    // Customize portal link label based on role
    if (user.role === 'admin') {
      portalBtn.innerText = 'Admin Control Panel';
    } else if (user.role === 'teacher') {
      portalBtn.innerText = 'Teacher Portal';
    } else {
      portalBtn.innerText = 'Student Dashboard';
    }
  } else {
    loginBtn.style.display = 'inline-block';
    userInfo.style.display = 'none';
    portalBtn.style.display = 'none';
  }
}

// --- LOGOUT ---
function logout() {
  localStorage.clear();
  userToken = null;
  currentUser = null;
  updateNavUI(null);
  showPage('home');
  showToast('Logged out successfully.', 'green');
}

// --- PAGE ROUTING CONTROLLER ---
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  
  const pageElement = document.getElementById(pageId + 'Page');
  if (pageElement) {
    pageElement.classList.add('active');
  }

  const navItem = document.getElementById('nav-' + pageId);
  if (navItem) {
    navItem.classList.add('active');
  }

  // Adjust content dynamically when dashboard portal is shown
  if (pageId === 'portal') {
    renderDashboardLayout();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToSection(id) {
  showPage('home');
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

// --- LOAD RESOURCE LIBRARY ---
async function loadResourcesHub() {
  try {
    const data = await apiCall('/api/resources');
    cachedResources = data;
    renderResourcesList(data);
  } catch(e) {
    console.error('Unable to fetch resources:', e.message);
  }
}

function renderResourcesList(list) {
  const container = document.getElementById('resourcesGrid');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="e-icon">📂</span><h3>No Resources Found</h3><p>Try clearing filters or check back later!</p></div>';
    return;
  }

  container.innerHTML = list.map(r => {
    const isFav = currentUser && currentUser.favourites && JSON.parse(JSON.stringify(currentUser.favourites)).includes(r.id);
    return '<div class="pub-card">' +
      '<button class="fav-btn ' + (isFav ? 'active' : '') + '" onclick="toggleFavourite(' + r.id + ')">★</button>' +
      '<div class="card-meta"><span class="tag tag-cyan">' + r.board + '</span><span class="tag">' + r.class + '</span></div>' +
      '<h5>' + escapeHtml(r.title) + '</h5>' +
      '<p class="desc">' + escapeHtml(r.description || 'No description provided.') + '</p>' +
      '<div class="card-meta" style="margin-bottom: 1.2rem;"><span class="tag tag-green">' + escapeHtml(r.subject) + '</span><span class="tag tag-yellow">' + escapeHtml(r.type) + '</span></div>' +
      '<div class="pub-card-actions">' +
        '<span class="file-size-badge">' + (r.file_size || 'N/A') + '</span>' +
        '<button class="btn btn-sm btn-grad" data-rid="' + r.id + '" data-url="' + escapeHtml(r.file_url) + '" data-title="' + escapeHtml(r.title) + '" onclick="downloadFile(this.dataset.rid, this.dataset.url, this.dataset.title)">⬇ Download</button>' +
      '</div>' +
      '<div style="margin-top:.6rem;display:flex;justify-content:space-between;align-items:center;">' +
        '<span class="dl-count">Downloads: <strong>' + r.downloads + '</strong></span>' +
        '<span class="dl-count" style="font-size:.65rem;color:var(--muted);">' + r.created_at + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

// --- FILTER CONTROLS ---
function onFilterChange() {
  const board = document.getElementById('filter-board').value;
  const type = document.getElementById('filter-type').value;
  const classVal = document.getElementById('filter-class').value;
  const search = document.getElementById('filter-search').value.toLowerCase();

  let filtered = cachedResources;

  if (board !== 'all') filtered = filtered.filter(r => r.board === board);
  if (type !== 'all') filtered = filtered.filter(r => r.type === type);
  if (classVal !== 'all') filtered = filtered.filter(r => r.class === classVal);
  if (search) {
    filtered = filtered.filter(r => 
      r.title.toLowerCase().includes(search) || 
      r.subject.toLowerCase().includes(search) ||
      (r.description && r.description.toLowerCase().includes(search))
    );
  }

  renderResourcesList(filtered);
}

function selectBoardAndLoad(boardName) {
  showPage('resources');
  const select = document.getElementById('filter-board');
  if (select) {
    select.value = boardName;
    onFilterChange();
  }
}

// --- ACTION LOGICS: DOWNLOADS & FAVS ---
async function toggleFavourite(id) {
  if (!currentUser) {
    showToast('Please log in to bookmark resources.', 'red');
    openAuthModal();
    return;
  }
  try {
    let favs = currentUser.favourites || [];
    if (typeof favs === 'string') favs = JSON.parse(favs);
    
    const index = favs.indexOf(id);
    if (index > -1) {
      favs.splice(index, 1);
      showToast('Removed from favourites', 'green');
    } else {
      favs.push(id);
      showToast('Added to favourites', 'green');
    }

    currentUser.favourites = favs;
    await apiCall('/api/users/favourites', 'PUT', { favourites: favs });
    onFilterChange();
    
    // Reload dynamically if we are in portal favourites view
    if (activePortalTab === 'favourites') {
      loadFavouritesDashboard();
    }
  } catch(e) {
    showToast(e.message, 'red');
  }
}

async function downloadFile(id, url, title) {
  try {
    // Record download stats
    await fetch('/api/resources/' + id + '/download', { method: 'POST' });
    
    if (currentUser) {
      const today = new Date().toLocaleDateString('en-IN');
      await apiCall('/api/users/downloads', 'POST', { id, title, date: today });
      // Update local state downloads
      if (!currentUser.downloads) currentUser.downloads = [];
      if (!currentUser.downloads.find(d => d.id === id)) {
        currentUser.downloads.unshift({ id, title, date: today });
      }
    }

    // Trigger local download link
    const link = document.createElement('a');
    link.href = url;
    link.download = title || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Download started!', 'green');
    await loadResourcesHub(); // Refresh counts
  } catch(e) {
    showToast('Download logged locally, file downloading...', 'green');
  }
}

// --- MODAL CONTROLS ---
function openAuthModal() {
  document.getElementById('authModal').classList.add('open');
}
function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('adminForm').style.display = 'none';

  if (tab === 'login') {
    document.getElementById('loginForm').style.display = 'block';
    document.querySelectorAll('.auth-tab')[0].classList.add('active');
  } else if (tab === 'signup') {
    document.getElementById('signupForm').style.display = 'block';
    document.querySelectorAll('.auth-tab')[1].classList.add('active');
  } else {
    document.getElementById('adminForm').style.display = 'block';
    document.querySelectorAll('.auth-tab')[2].classList.add('active');
  }
}

function selectSignupRole(role) {
  signupRole = role;
  document.getElementById('opt-student').classList.remove('selected');
  document.getElementById('opt-teacher').classList.remove('selected');
  document.getElementById('opt-' + role).classList.add('selected');
}

// --- AUTH SUBMISSION ---
async function handleAuthSubmit(e, action) {
  e.preventDefault();
  const errDiv = document.getElementById(action + '-error');
  errDiv.style.display = 'none';

  try {
    if (action === 'login') {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-pass').value;
      const data = await apiCall('/api/auth/login', 'POST', { email, password });
      
      userToken = data.token;
      currentUser = data.user;
      localStorage.setItem('nestiq_token', data.token);
      localStorage.setItem('nestiq_role', data.user.role);
      
      showToast('Logged in successfully!', 'green');
      closeAuthModal();
      updateNavUI(currentUser);
      showPage('portal');
    } else if (action === 'signup') {
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-pass').value;
      
      const data = await apiCall('/api/auth/signup', 'POST', { name, email, password, role: signupRole });
      
      userToken = data.token;
      currentUser = data.user;
      localStorage.setItem('nestiq_token', data.token);
      localStorage.setItem('nestiq_role', data.user.role);

      showToast('Registered successfully!', 'green');
      closeAuthModal();
      updateNavUI(currentUser);
      showPage('portal');
    } else if (action === 'admin') {
      const email = document.getElementById('admin-email').value;
      const password = document.getElementById('admin-pass').value;
      
      const data = await apiCall('/api/auth/admin', 'POST', { email, password });
      
      userToken = data.token;
      currentUser = { name: 'Portal Admin', email, role: 'admin', joined: new Date().toLocaleDateString('en-IN') };
      localStorage.setItem('nestiq_token', data.token);
      localStorage.setItem('nestiq_role', 'admin');

      showToast('Admin access granted.', 'green');
      closeAuthModal();
      updateNavUI(currentUser);
      showPage('portal');
    }
  } catch(err) {
    errDiv.innerText = err.message;
    errDiv.style.display = 'block';
  }
}

// --- PORTAL DASHBOARD MANAGER ---
function renderDashboardLayout() {
  if (!currentUser) {
    showPage('home');
    return;
  }

  // Populate basic header metadata
  document.getElementById('portal-welcome-title').innerText = 'Hello, ' + currentUser.name + '!';
  document.getElementById('portal-role-badge').innerText = currentUser.role.toUpperCase();
  document.getElementById('portal-joined-date').innerText = 'Member Since: ' + currentUser.joined;

  const sidebar = document.getElementById('dashboard-sidebar');
  let navItems = '';

  if (currentUser.role === 'admin') {
    navItems = '<button class="db-tab-btn active" id="btn-tab-overview" onclick="switchDashboardTab(&apos;overview&apos;)">📊 Stats Overview</button>' +
               '<button class="db-tab-btn" id="btn-tab-admin-upload" onclick="switchDashboardTab(&apos;admin-upload&apos;)">📁 Publish Material</button>' +
               '<button class="db-tab-btn" id="btn-tab-admin-resources" onclick="switchDashboardTab(&apos;admin-resources&apos;)">📂 Managed Files</button>' +
               '<button class="db-tab-btn" id="btn-tab-admin-users" onclick="switchDashboardTab(&apos;admin-users&apos;)">👥 User Accounts</button>' +
               '<button class="db-tab-btn" id="btn-tab-admin-feedback" onclick="switchDashboardTab(&apos;admin-feedback&apos;)">✉ Feedback Feed</button>';
  } else if (currentUser.role === 'teacher') {
    navItems = '<button class="db-tab-btn active" id="btn-tab-overview" onclick="switchDashboardTab(&apos;overview&apos;)">📊 Teacher Overview</button>' +
               '<button class="db-tab-btn" id="btn-tab-favourites" onclick="switchDashboardTab(&apos;favourites&apos;)">★ Bookmarked Notes</button>' +
               '<button class="db-tab-btn" id="btn-tab-admin-upload" onclick="switchDashboardTab(&apos;admin-upload&apos;)">📁 Upload Syllabus</button>';
  } else {
    // Student
    navItems = '<button class="db-tab-btn active" id="btn-tab-overview" onclick="switchDashboardTab(&apos;overview&apos;)">📊 Student Overview</button>' +
               '<button class="db-tab-btn" id="btn-tab-favourites" onclick="switchDashboardTab(&apos;favourites&apos;)">★ Favourites Checklist</button>' +
               '<button class="db-tab-btn" id="btn-tab-downloads" onclick="switchDashboardTab(&apos;downloads&apos;)">📥 Downloads Log</button>' +
               '<button class="db-tab-btn" id="btn-tab-test-generator" onclick="switchDashboardTab(&apos;test-generator&apos;)">📝 AI Mock Tests</button>' +
               '<button class="db-tab-btn" id="btn-tab-saved-tests" onclick="switchDashboardTab(&apos;saved-tests&apos;)">📂 Saved Test History</button>';
  }

  sidebar.innerHTML = navItems;
  switchDashboardTab('overview');
}

async function switchDashboardTab(tabId) {
  activePortalTab = tabId;
  document.querySelectorAll('.db-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(panel => panel.classList.remove('active'));

  const activeBtn = document.getElementById('btn-tab-' + tabId);
  if (activeBtn) activeBtn.classList.add('active');

  const activePanel = document.getElementById('tab-' + tabId);
  if (activePanel) activePanel.classList.add('active');

  // Trigger data loader for the active tab panel
  if (tabId === 'overview') {
    await loadOverviewStats();
  } else if (tabId === 'favourites') {
    loadFavouritesDashboard();
  } else if (tabId === 'downloads') {
    loadDownloadsDashboard();
  } else if (tabId === 'saved-tests') {
    await loadSavedTestsHistory();
  } else if (tabId === 'admin-resources') {
    await loadAdminResources();
  } else if (tabId === 'admin-users') {
    await loadAdminUsers();
  } else if (tabId === 'admin-feedback') {
    await loadAdminFeedback();
  }
}

// --- PORTAL DATA LOADERS ---
async function loadOverviewStats() {
  const container = document.getElementById('overview-stats-grid');
  if (currentUser.role === 'admin') {
    try {
      const stats = await apiCall('/api/admin/stats');
      container.innerHTML = '<div class="stat-card"><div class="stat-card-info"><h6>Resources</h6><p>' + stats.resources + '</p></div><div class="stat-card-icon">📂</div></div><div class="stat-card"><div class="stat-card-info"><h6>Students</h6><p>' + stats.students + '</p></div><div class="stat-card-icon">🎓</div></div><div class="stat-card"><div class="stat-card-info"><h6>Teachers</h6><p>' + stats.teachers + '</p></div><div class="stat-card-icon">👨‍🏫</div></div><div class="stat-card"><div class="stat-card-info"><h6>Total Downloads</h6><p>' + stats.downloads + '</p></div><div class="stat-card-icon">📥</div></div>';
    } catch(e) { console.error(e); }
  } else {
    // Normal User Stats
    let favs = currentUser.favourites || [];
    if (typeof favs === 'string') favs = JSON.parse(favs);
    let dls = currentUser.downloads || [];
    if (typeof dls === 'string') dls = JSON.parse(dls);

    container.innerHTML = '<div class="stat-card"><div class="stat-card-info"><h6>Bookmarked Notes</h6><p>' + favs.length + '</p></div><div class="stat-card-icon">★</div></div><div class="stat-card"><div class="stat-card-info"><h6>Downloaded files</h6><p>' + dls.length + '</p></div><div class="stat-card-icon">📥</div></div><div class="stat-card"><div class="stat-card-info"><h6>Account Status</h6><p>Active</p></div><div class="stat-card-icon">✅</div></div>';
  }
}

function loadFavouritesDashboard() {
  const container = document.getElementById('favouritesGrid');
  let favs = currentUser.favourites || [];
  if (typeof favs === 'string') favs = JSON.parse(favs);

  const matched = cachedResources.filter(r => favs.includes(r.id));
  if (matched.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="e-icon">★</span><p>No favourites saved yet. Explore the resources page to add files!</p></div>';
    return;
  }

  container.innerHTML = matched.map(r => '<div class="pub-card"><button class="fav-btn active" onclick="toggleFavourite(' + r.id + ')">★</button><div class="card-meta"><span class="tag tag-cyan">' + r.board + '</span><span class="tag">' + r.class + '</span></div><h5>' + escapeHtml(r.title) + '</h5><p class="desc">' + escapeHtml(r.description || 'No description.') + '</p><div class="pub-card-actions"><span class="file-size-badge">' + r.file_size + '</span><button class="btn btn-sm btn-grad" data-rid="' + r.id + '" data-url="' + escapeHtml(r.file_url) + '" data-title="' + escapeHtml(r.title) + '" onclick="downloadFile(this.dataset.rid, this.dataset.url, this.dataset.title)">⬇ Download</button></div></div>').join('');
}

function loadDownloadsDashboard() {
  const container = document.getElementById('downloadsList');
  let dls = currentUser.downloads || [];
  if (typeof dls === 'string') dls = JSON.parse(dls);

  if (dls.length === 0) {
    container.innerHTML = '<div class="empty-state"><span class="e-icon">📥</span><p>No download logs found.</p></div>';
    return;
  }

  container.innerHTML = dls.map(d => '<div class="dl-item"><div class="dl-item-info"><h5>' + escapeHtml(d.title) + '</h5><p>Downloaded on: ' + d.date + '</p></div><button class="btn btn-xs btn-outline" onclick="redownloadItem(' + d.id + ')">⬇ Redownload</button></div>').join('');
}

function redownloadItem(id) {
  const res = cachedResources.find(r => r.id === id);
  if (res) {
    downloadFile(res.id, res.file_url, res.title);
  } else {
    showToast('File details unavailable, download via library catalog.', 'red');
  }
}

// --- ADMIN CONTROL PANELS CONTROLLERS ---
async function loadAdminResources() {
  const container = document.getElementById('adminResourcesList');
  try {
    const list = await apiCall('/api/resources');
    if (list.length === 0) {
      container.innerHTML = '<p class="empty-state">No materials found.</p>';
      return;
    }
    container.innerHTML = list.map(r => '<div class="resource-item"><div class="resource-item-info"><h5>' + escapeHtml(r.title) + '</h5><div class="meta-tags" style="margin-top: .4rem;"><span class="meta-tag">' + r.board + '</span><span class="meta-tag">' + r.class + '</span><span class="meta-tag">' + r.subject + '</span><span class="meta-tag">' + r.type + '</span><span class="meta-tag" style="background:rgba(255,255,255,.05); border-color:transparent; color:var(--muted);">' + r.file_size + '</span></div></div><button class="btn-delete" onclick="deleteResource(' + r.id + ')">❌ Delete</button></div>').join('');
  } catch(e) { showToast(e.message, 'red'); }
}

async function deleteResource(id) {
  if (!confirm('Are you sure you want to delete this resource permanently?')) return;
  try {
    await apiCall('/api/resources/' + id, 'DELETE');
    showToast('Resource deleted successfully', 'green');
    await loadResourcesHub();
    await loadAdminResources();
  } catch(e) { showToast(e.message, 'red'); }
}

async function loadAdminUsers() {
  const container = document.getElementById('adminUsersList');
  try {
    const list = await apiCall('/api/admin/users');
    container.innerHTML = list.map(u => '<div class="user-list-item"><div><h5>' + escapeHtml(u.name) + '</h5><p>' + escapeHtml(u.email) + '</p></div><div><span class="tag ' + (u.role === 'teacher' ? 'tag-green' : 'tag-cyan') + '">' + u.role.toUpperCase() + '</span><span style="font-size: .72rem; color: var(--muted); margin-left: .5rem;">Joined: ' + u.joined + '</span></div></div>').join('');
  } catch(e) { showToast(e.message, 'red'); }
}

async function loadAdminFeedback() {
  const container = document.getElementById('adminFeedbackBody');
  try {
    const list = await apiCall('/api/feedback');
    if (list.length === 0) {
      container.innerHTML = '<tr><td colspan="6" class="empty-state">No feedback submitted yet.</td></tr>';
      return;
    }
    const badges = {
      feedback: 'type-feedback',
      request: 'type-request',
      bug: 'type-bug',
      suggestion: 'type-suggestion'
    };
    const labels = {
      feedback: 'Feedback',
      request: 'Request',
      bug: 'Bug',
      suggestion: 'Idea'
    };

    container.innerHTML = list.map(f => '<tr><td><span class="type-pill ' + (badges[f.type] || 'type-feedback') + '">' + (labels[f.type] || f.type) + '</span></td><td><div style="font-weight:600;">' + escapeHtml(f.name) + '</div><div style="font-size:.72rem; color:var(--muted);">' + escapeHtml(f.email || 'N/A') + ' - ' + escapeHtml(f.user_role) + '</div></td><td style="max-width:300px; line-height:1.4;">' + escapeHtml(f.message) + '</td><td><div style="font-weight:500;">' + escapeHtml(f.subject || 'N/A') + '</div><div style="font-size:.72rem; color:var(--muted);">' + escapeHtml(f.topic || 'N/A') + '</div></td><td><div style="color:var(--yellow); font-weight:700;">' + (f.rating ? '★'.repeat(f.rating) : 'N/A') + '</div></td><td><div>' + f.created_at + '</div><div style="font-size:.72rem; color:var(--muted);">' + f.time + '</div></td></tr>').join('');
  } catch(e) { showToast(e.message, 'red'); }
}

async function exportFeedbackCsv() {
  try {
    const res = await fetch('/api/feedback/export', {
      headers: { 'Authorization': 'Bearer ' + userToken }
    });
    if (!res.ok) throw new Error('Feedback export failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NestIQ_Feedback_' + new Date().toLocaleDateString('en-IN').split('/').join('-') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Feedback exported as CSV.', 'green');
  } catch(e) {
    showToast(e.message, 'red');
  }
}

// --- FILE UPLOADER & DRAG-DROP ---
function setupDragAndDrop() {
  const zone = document.getElementById('dropzone');
  if (!zone) return;

  ['dragenter', 'dragover'].forEach(name => {
    zone.addEventListener(name, (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(name => {
    zone.addEventListener(name, (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
    }, false);
  });

  zone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) {
      document.getElementById('fileInput').files = files;
      onFileSelected();
    }
  }, false);
}

function onFileSelected() {
  const input = document.getElementById('fileInput');
  const label = document.getElementById('selectedFileName');
  if (input.files.length) {
    label.innerText = 'Selected: ' + input.files[0].name + ' (' + Math.round(input.files[0].size/1024) + ' KB)';
  } else {
    label.innerText = '';
  }
}

async function handleResourceUpload(e) {
  e.preventDefault();
  const form = e.target;
  const progressDiv = document.getElementById('uploadProgress');
  const progressBar = document.getElementById('uploadProgressBar');
  
  const fd = new FormData(form);
  const fileInput = document.getElementById('fileInput');
  if (!fileInput.files.length) {
    showToast('Please select a file to upload.', 'red');
    return;
  }

  progressDiv.style.display = 'block';
  progressBar.style.width = '0%';

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/resources');
    xhr.setRequestHeader('Authorization', 'Bearer ' + userToken);
    
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const percent = Math.round((evt.loaded / evt.total) * 100);
        progressBar.style.width = percent + '%';
      }
    };

    xhr.onload = async () => {
      progressDiv.style.display = 'none';
      if (xhr.status === 200) {
        showToast('Resource uploaded successfully!', 'green');
        form.reset();
        document.getElementById('selectedFileName').innerText = '';
        await loadResourcesHub();
        await switchDashboardTab('admin-resources');
      } else {
        const err = JSON.parse(xhr.responseText || '{}');
        showToast(err.error || 'Upload failed', 'red');
      }
    };

    xhr.onerror = () => {
      progressDiv.style.display = 'none';
      showToast('Network error during upload', 'red');
    };

    xhr.send(fd);
  } catch(err) {
    progressDiv.style.display = 'none';
    showToast(err.message, 'red');
  }
}

// --- FEEDBACK INTERACTIVE LOGICS ---
function openFeedbackModal() {
  document.getElementById('feedbackModal').classList.add('open');
}
function closeFeedbackModal() {
  document.getElementById('feedbackModal').classList.remove('open');
}

function setFeedbackType(type) {
  feedbackType = type;
  document.querySelectorAll('.ftype-opt').forEach(opt => opt.classList.remove('selected'));
  document.getElementById('f-' + type).classList.add('selected');
}

function setFeedbackRating(val) {
  feedbackRating = val;
  const stars = document.querySelectorAll('#star-container .star');
  stars.forEach((star, idx) => {
    if (idx < val) {
      star.classList.add('lit');
    } else {
      star.classList.remove('lit');
    }
  });
}

async function handleFeedbackSubmit(e) {
  e.preventDefault();
  const message = document.getElementById('f-message').value;
  const subject = document.getElementById('f-subject').value;
  const topic = document.getElementById('f-topic').value;
  const name = document.getElementById('f-name').value || 'Anonymous';
  const email = document.getElementById('f-email').value;
  const userRole = currentUser ? currentUser.role : 'Guest';

  try {
    await apiCall('/api/feedback', 'POST', {
      type: feedbackType,
      message,
      subject,
      topic,
      rating: feedbackRating,
      name,
      email,
      userRole
    });
    
    showToast('Feedback submitted! Thank you.', 'green');
    document.getElementById('feedbackForm').reset();
    setFeedbackRating(5);
    closeFeedbackModal();
  } catch(err) {
    showToast(err.message, 'red');
  }
}

// --- AI TUTOR CHAT CONTROLLERS ---
function toggleChatWindow() {
  document.getElementById('chatWindow').classList.toggle('open');
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const box = document.getElementById('chat-messages-box');
  if (box) {
    box.scrollTop = box.scrollHeight;
  }
}

async function sendChatFromInput() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await sendChatMessage(text);
}

async function sendChipPrompt(text) {
  await sendChatMessage(text);
}

let aiChatMessages = [];

async function sendChatMessage(userText) {
  const box = document.getElementById('chat-messages-box');
  
  // Append User message bubble
  box.innerHTML += '<div class="msg user"><div class="msg-av">Me</div><div class="msg-bubble">' + escapeHtml(userText) + '</div></div>';
  
  // Append Typing bubble
  const typingId = 'typing-' + Date.now();
  box.innerHTML += '<div class="msg bot" id="' + typingId + '"><div class="msg-av">AI</div><div class="typing-bubble"><span></span><span></span><span></span></div></div>';
  
  scrollChatToBottom();

  aiChatMessages.push({ role: 'user', content: userText });

  try {
    const data = await apiCall('/api/ai/chat', 'POST', { messages: aiChatMessages.slice(-8) });
    document.getElementById(typingId)?.remove();
    
    // Add bot reply bubble
    box.innerHTML += '<div class="msg bot"><div class="msg-av">AI</div><div class="msg-bubble">' + formatAiResponse(data.reply) + '</div></div>';
    
    aiChatMessages.push({ role: 'assistant', content: data.reply });
  } catch(e) {
    document.getElementById(typingId)?.remove();
    box.innerHTML += '<div class="msg bot"><div class="msg-av">AI</div><div class="msg-bubble" style="color:var(--red);">Study Nest AI is offline. Make sure Ollama is running on this server (<code>ollama serve</code>).</div></div>';
  }
  scrollChatToBottom();
}

function formatAiResponse(txt) {
  // Format AI markdown-style response for display in chat bubble
  var nl = String.fromCharCode(10);
  return txt
    .split(nl).join('<br>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/✦([^<]+)(<br>|$)/g, '<li>$1</li>');
}

// --- AI MOCK TEST GENERATOR ---
async function generateTestSheet(e) {
  e.preventDefault();
  const subject = document.getElementById('gen-subject').value;
  const board = document.getElementById('gen-board').value;
  const cls = document.getElementById('gen-class').value;
  const topic = document.getElementById('gen-topic').value;
  const diff = document.getElementById('gen-diff').value;
  const marks = document.getElementById('gen-marks').value;
  const instr = document.getElementById('gen-instructions').value;

  const btn = document.getElementById('btn-submit-test-gen');
  btn.disabled = true;

  const types = [];
  if (document.getElementById('q-mcq').checked) types.push('MCQ');
  if (document.getElementById('q-sa').checked) types.push('SA');
  if (document.getElementById('q-la').checked) types.push('LA');
  if (document.getElementById('q-fib').checked) types.push('FIB');

  const container = document.getElementById('testDisplayContainer');
  container.innerHTML = '<div class="gen-loading"><div class="spinner"></div><span>Study Nest AI is generating your test paper...</span></div>';

  try {
    const data = await apiCall('/api/ai/generate-test', 'POST', {
      subject, board, cls, topic, diff, marks, qtypes: types.join(','), instr
    });
    
    btn.disabled = false;
    currentTest = data.test;
    renderTestSheet(data.test, 'testDisplayContainer');
  } catch(e) {
    btn.disabled = false;
    container.innerHTML = '<div class="ai-tutor-banner"><span class="icon">⚠️</span><div>Test generation failed. Make sure Ollama is running on this server (<strong>ollama serve</strong>) and the <strong>studynestai</strong> model is installed.</div></div>';
  }
}

let currentTest = null;

function renderTestSheet(test, containerId, isArchive = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const duration = test.duration || '45 Mins';
  
  let qHtml = test.questions.map((q, idx) => {
    let optionsHtml = '';
    if (q.type === 'MCQ' && q.options) {
      optionsHtml = '<div class="q-options">' + q.options.map((opt, oIdx) => {
            const letter = opt.substring(0, 2);
            const textVal = opt.substring(2);
            return '<label class="q-option"><input type="radio" name="q-' + idx + '" value="' + letter.replace('.','') + '"><span class="opt-label">' + letter + '</span> ' + escapeHtml(textVal) + '</label>';
          }).join('') + '</div>';
    } else {
      optionsHtml = '<div class="q-answer-space">Write your solution here...</div>';
    }

    return '<div class="test-q"><div style="display:flex; justify-content:space-between; align-items:flex-start;"><div class="q-num">Question ' + (idx + 1) + '</div><span class="q-type-badge" style="background:rgba(255,255,255,.05); font-size:.65rem;">' + q.type + ' - ' + q.marks + ' Mark(s)</span></div><div class="q-text">' + escapeHtml(q.text) + '</div>' + optionsHtml + '<div class="q-answer-reveal" id="ans-' + containerId + '-' + idx + '"><strong>Correct Answer:</strong> ' + escapeHtml(q.answer) + '</div></div>';
  }).join('');

  container.innerHTML = '<div class="generated-test"><div class="test-header-info"><div><h3>' + escapeHtml(test.title) + '</h3><div class="test-meta-pills" style="margin-top:.4rem;"><span class="tag tag-cyan">' + test.board + '</span><span class="tag">' + test.class + '</span><span class="tag tag-green">' + escapeHtml(test.subject) + '</span><span class="tag tag-yellow">' + escapeHtml(test.topic) + '</span></div></div><div style="text-align:right;"><div style="font-weight:700; color:var(--accent);">Max Marks: ' + test.totalMarks + '</div><div style="font-size:.78rem; color:var(--muted);">Time Limit: ' + duration + '</div></div></div><div class="test-qs-list">' + qHtml + '</div><div class="test-actions"><button class="btn btn-sm btn-outline" onclick="toggleAnswersReveal(&apos;' + containerId + '&apos;, ' + test.questions.length + ')">👁 Show/Hide Key</button><button class="btn btn-sm btn-outline" onclick="window.print()">🖨 Print Paper</button>' + (!isArchive ? '<button class="btn btn-sm btn-grad" id="btn-save-test" onclick="saveGeneratedTest()">💾 Save Paper</button>' : '') + '</div></div>';
}

function toggleAnswersReveal(containerId, count) {
  for (let i = 0; i < count; i++) {
    const el = document.getElementById('ans-' + containerId + '-' + i);
    if (el) el.classList.toggle('show');
  }
}

async function saveGeneratedTest() {
  if (!currentTest) return;
  const btn = document.getElementById('btn-save-test');
  btn.disabled = true;
  try {
    await apiCall('/api/tests', 'POST', {
      title: currentTest.title,
      data: currentTest
    });
    showToast('Mock test paper saved to history.', 'green');
    btn.innerHTML = 'Saved ✓';
  } catch(e) {
    showToast(e.message, 'red');
    btn.disabled = false;
  }
}

// --- SAVED TEST ARCHIVE VIEWER ---
async function loadSavedTestsHistory() {
  const container = document.getElementById('savedTestsList');
  try {
    const list = await apiCall('/api/tests');
    if (list.length === 0) {
      container.innerHTML = '<p class="empty-state">No saved tests found. Generate one in the AI Mock Tests tab!</p>';
      return;
    }
    container.innerHTML = list.map(t => '<div class="dl-item"><div class="dl-item-info"><h5>' + escapeHtml(t.title) + '</h5><p>Created on: ' + t.created_at + ' - Subject: ' + escapeHtml(t.data.subject) + '</p></div><button class="btn btn-xs btn-grad" onclick="viewArchivedTest(' + t.id + ')">👁 View Test</button></div>').join('');
  } catch(e) { showToast(e.message, 'red'); }
}

async function viewArchivedTest(id) {
  try {
    const list = await apiCall('/api/tests');
    const match = list.find(t => t.id === id);
    if (match) {
      renderTestSheet(match.data, 'archivedTestDisplay', true);
      document.getElementById('archivedTestDisplay').scrollIntoView({ behavior: 'smooth' });
    }
  } catch(e) { showToast(e.message, 'red'); }
}

// --- SYSTEM TOAST NOTIFICATION ---
function showToast(message, type = 'green') {
  const box = document.getElementById('toastBox');
  box.innerText = message;
  box.className = 'toast show';
  if (type === 'red') {
    box.classList.add('error');
  }
  setTimeout(() => {
    box.classList.remove('show');
  }, 3500);
}

// --- UTILITIES ---
function escapeHtml(string) {
  if (!string) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return string.replace(/[&<>"']/g, c => map[c]);
}
</script>
</body>
</html>`;

// Serve Frontend client
app.use((req, res) => {
  res.send(HTML);
});

// ── Start Server ──────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 NestIQ Server Running at http://localhost:${CONFIG.PORT}`);
  console.log(`  📂 Database Path: ${path.join(__dirname, 'nestiq.db')}`);
  console.log(`  📂 Upload Folder: ${UPLOAD_DIR_PATH}`);
  console.log(`======================================================\n`);
});