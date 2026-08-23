
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
    const data = await apiCall('/api/ai/chat', 'POST', { messages: aiChatMessages.slice(-10) });
    document.getElementById(typingId).remove();
    
    // Add bot reply bubble
    box.innerHTML += '<div class="msg bot"><div class="msg-av">AI</div><div class="msg-bubble">' + formatAiResponse(data.reply) + '</div></div>';
    
    aiChatMessages.push({ role: 'assistant', content: data.reply });
  } catch(e) {
    document.getElementById(typingId).remove();
    box.innerHTML += '<div class="msg bot"><div class="msg-av">AI</div><div class="msg-bubble" style="color:var(--red);">Study Nest AI is offline. Make sure Ollama is running on this server (<code>ollama serve</code>).</div></div>';
  }
  scrollChatToBottom();
}

function formatAiResponse(txt) {
  // Format AI markdown-style response for display in chat bubble
  return txt
    .split('
').join('<br>')
    .replace(/**([^*]+)**/g, '<strong>$1</strong>')
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
