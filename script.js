'use strict';

// ==========================================
// 1. CONSTANTS AND CONFIGURATION
// ==========================================
const DB_NAME = 'RDCoachingCenter';
const DB_VERSION = 1;
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Global application state
let db = null;
let currentMonthView = null;   // Which month dashboard is open
let currentProfileId = null;   // Which student profile is open
let currentFilter = 'all';     // Filter state for month dashboard
let currentSort = 'name-asc';  // Sort state for month dashboard
let editingPaymentId = null;   // Payment being edited (null = adding new)
let editingStudentId = null;   // Student being edited
let confirmCallback = null;    // Callback for confirmation dialog
let previousPage = 'dashboardPage'; // For back navigation

// ==========================================
// 2. INDEXEDDB SETUP AND OPERATIONS
// ==========================================

/** Open or create the IndexedDB database */
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Students store
            if (!database.objectStoreNames.contains('students')) {
                database.createObjectStore('students', { keyPath: 'id' });
            }

            // Payments store with indexes
            if (!database.objectStoreNames.contains('payments')) {
                const payStore = database.createObjectStore('payments', { keyPath: 'id' });
                payStore.createIndex('studentId', 'studentId', { unique: false });
                payStore.createIndex('month', 'month', { unique: false });
            }

            // Settings store
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }

            // Auth store
            if (!database.objectStoreNames.contains('auth')) {
                database.createObjectStore('auth', { keyPath: 'key' });
            }
        };
    });
};

/** Get all records from a store */
const dbGetAll = (storeName) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

/** Get a single record by key */
const dbGet = (storeName, key) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

/** Insert or update a record */
const dbPut = (storeName, data) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

/** Delete a record by key */
const dbDelete = (storeName, key) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

/** Get payments for a specific month */
const getPaymentsByMonth = (month) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['payments'], 'readonly');
        const store = tx.objectStore('payments');
        const index = store.index('month');
        const req = index.getAll(month);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

/** Get all payments for a specific student */
const getPaymentsByStudent = (studentId) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['payments'], 'readonly');
        const store = tx.objectStore('payments');
        const index = store.index('studentId');
        const req = index.getAll(studentId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

/** Clear an entire store */
const dbClearStore = (storeName) => {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// ==========================================
// 15. UTILITY FUNCTIONS
// ==========================================

/** Generate a UUID v4 */
const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/** Format a number as Indian Rupee currency */
const formatCurrency = (amount) => {
    return '₹' + Number(amount).toLocaleString('en-IN');
};

/** Format a date string nicely */
const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
        const d = new Date(dateString);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
        return dateString;
    }
};

/** Hash a password using SHA-256 */
const hashPassword = async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Get current month name */
const getCurrentMonth = () => MONTHS[new Date().getMonth()];

/** Determine payment status from amounts */
const getPaymentStatus = (paidAmount, monthlyFee) => {
    const paid = Number(paidAmount);
    const fee = Number(monthlyFee);
    if (paid >= fee) return 'PAID';
    if (paid <= 0) return 'PENDING';
    return 'PARTIALLY PAID';
};

/** Get first letter(s) for avatar */
const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
};

/** Safely get element by ID */
const $ = (id) => document.getElementById(id);

// ==========================================
// DATA SEEDING (first-time setup)
// ==========================================

/** Seed default data on first launch */
const seedDataIfNeeded = async () => {
    const auth = await dbGet('auth', 'owner');
    if (auth) return; // Already seeded

    // Create default owner credentials
    const hashedPassword = await hashPassword('admin123');
    await dbPut('auth', { key: 'owner', name: 'Rudra Debnath', password: hashedPassword });

    // Create default settings
    await dbPut('settings', { key: 'coachingName', value: 'RD Coaching Center' });
    await dbPut('settings', { key: 'ownerName', value: 'Rudra Debnath' });
    await dbPut('settings', { key: 'defaultFee', value: 800 });
    await dbPut('settings', { key: 'defaultClass', value: 'Class 10' });
    await dbPut('settings', { key: 'theme', value: 'dark' });

    // Create 8 sample students
    const sampleStudents = [
        { name: 'Aarav Sharma', phone: '9876543210', studentClass: 'Class 10', monthlyFee: 800 },
        { name: 'Priya Patel', phone: '9876543211', studentClass: 'Class 9', monthlyFee: 750 },
        { name: 'Rohan Gupta', phone: '9876543212', studentClass: 'Class 10', monthlyFee: 800 },
        { name: 'Sneha Das', phone: '9876543213', studentClass: 'Class 11', monthlyFee: 900 },
        { name: 'Amit Kumar', phone: '9876543214', studentClass: 'Class 10', monthlyFee: 800 },
        { name: 'Neha Singh', phone: '9876543215', studentClass: 'Class 9', monthlyFee: 750 },
        { name: 'Vikram Roy', phone: '9876543216', studentClass: 'Class 12', monthlyFee: 1000 },
        { name: 'Ananya Bose', phone: '9876543217', studentClass: 'Class 11', monthlyFee: 900 }
    ];

    // Predefined payment patterns for realistic data
    const paymentPatterns = [
        [1, 1, 1, 1, 1, 1, 1, 1, 1],       // All paid
        [1, 1, 1, 0.5, 1, 1, 0, 1, 1],      // Mix
        [1, 1, 1, 1, 1, 1, 1, 0.5, 0],      // Recent pending
        [1, 1, 0, 1, 1, 1, 1, 1, 1],        // One month missed
        [1, 1, 1, 1, 0.5, 0.5, 1, 1, 0],    // Multiple partial
        [1, 1, 1, 1, 1, 0, 0, 1, 1],        // Two months missed
        [1, 1, 1, 1, 1, 1, 1, 1, 0.5],      // Current partial
        [1, 1, 1, 1, 1, 1, 1, 0, 0]         // Recent unpaid
    ];

    for (let i = 0; i < sampleStudents.length; i++) {
        const s = sampleStudents[i];
        const studentId = generateId();

        await dbPut('students', {
            id: studentId,
            name: s.name,
            phone: s.phone,
            studentClass: s.studentClass,
            monthlyFee: s.monthlyFee,
            createdAt: new Date().toISOString()
        });

        // Create payments for Jan–Sep using patterns
        const pattern = paymentPatterns[i];
        for (let m = 0; m < 9; m++) {
            const paidRatio = pattern[m];
            const paidAmount = Math.round(s.monthlyFee * paidRatio);
            const status = getPaymentStatus(paidAmount, s.monthlyFee);
            const payDate = new Date(2026, m, Math.floor(Math.random() * 15) + 1);

            await dbPut('payments', {
                id: generateId(),
                studentId: studentId,
                month: MONTHS[m],
                paidAmount: paidAmount,
                paymentDate: payDate.toISOString(),
                note: '',
                status: status
            });
        }
    }
};

// ==========================================
// 14. TOAST NOTIFICATIONS
// ==========================================

/** Show a toast notification */
const showToast = (message, type = 'success') => {
    const container = $('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-circle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('show'));

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// ==========================================
// 3. AUTHENTICATION FUNCTIONS
// ==========================================

/** Check if user is authenticated and show correct screen */
const checkAuth = () => {
    const isLoggedIn = sessionStorage.getItem('rd_auth') === 'true';
    const loginScreen = $('loginScreen');
    const mainApp = $('mainApp');

    if (isLoggedIn) {
        loginScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        loadDashboard();
        startClock();
    } else {
        loginScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
};

/** Handle login attempt */
const handleLogin = async () => {
    const nameInput = $('loginName');
    const passInput = $('loginPassword');
    const name = nameInput.value.trim();
    const pass = passInput.value;

    if (!name || !pass) {
        showToast('Please enter both name and password', 'warning');
        return;
    }

    try {
        const auth = await dbGet('auth', 'owner');
        const hashedPass = await hashPassword(pass);

        if (auth && auth.name === name && auth.password === hashedPass) {
            sessionStorage.setItem('rd_auth', 'true');
            showToast('Welcome back, ' + name + '! 🎉', 'success');
            checkAuth();
        } else {
            showToast('Invalid credentials! ❌', 'error');
            passInput.value = '';
        }
    } catch (e) {
        console.error('Login error:', e);
        showToast('Login failed. Please try again.', 'error');
    }
};

/** Handle logout */
const handleLogout = () => {
    sessionStorage.removeItem('rd_auth');
    showToast('Logged out successfully', 'info');
    checkAuth();
};

// ==========================================
// 4. CLOCK FUNCTIONS
// ==========================================

let clockInterval = null;

/** Start the live ring clock */
const startClock = () => {
    if (clockInterval) clearInterval(clockInterval);

    const updateClock = () => {
        const now = new Date();

        // Time
        const hours = now.getHours();
        const h12 = hours % 12 || 12;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${String(h12).padStart(2, '0')}:${mins}:${secs} ${ampm}`;

        // Date
        const day = now.getDate();
        const monthName = MONTHS[now.getMonth()];
        const year = now.getFullYear();
        const dateStr = `${day} ${monthName} ${year}`;

        // Day of week
        const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });

        // Update DOM
        const clockTime = $('clockTime');
        const clockDate = $('clockDate');
        const clockDay = $('clockDay');

        if (clockTime) clockTime.textContent = timeStr;
        if (clockDate) clockDate.textContent = dateStr;
        if (clockDay) clockDay.textContent = dayName;

        // Animate SVG ring based on seconds (0-59 → 0-full circle)
        const progress = $('clockProgress');
        if (progress) {
            const circumference = 2 * Math.PI * 90; // r=90
            const offset = circumference - (now.getSeconds() / 60) * circumference;
            progress.style.strokeDasharray = circumference;
            progress.style.strokeDashoffset = offset;
        }
    };

    updateClock();
    clockInterval = setInterval(updateClock, 1000);
};

// ==========================================
// 13. NAVIGATION FUNCTIONS
// ==========================================

/** Navigate to a page by its element ID */
const navigateTo = (pageId) => {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));

    // Show target page
    const target = $(pageId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }

    // Update bottom nav active state
    const navMap = {
        'dashboardPage': 'dashboard',
        'monthDashboard': 'months',
        'searchPage': 'search',
        'pendingPage': 'pending',
        'settingsPage': 'settings'
    };

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === navMap[pageId]) {
            item.classList.add('active');
        }
    });

    // Load page-specific data
    switch (pageId) {
        case 'dashboardPage':
            loadDashboard();
            break;
        case 'searchPage':
            loadSearchPage();
            break;
        case 'pendingPage':
            loadPendingPage();
            break;
        case 'settingsPage':
            loadSettingsPage();
            break;
    }
};

// ==========================================
// 5. DASHBOARD FUNCTIONS
// ==========================================

/** Load and render the main dashboard */
const loadDashboard = async () => {
    try {
        const students = await dbGetAll('students');
        const payments = await dbGetAll('payments');
        const currentMonth = getCurrentMonth();

        // Load settings for header
        const coachingName = await dbGet('settings', 'coachingName');
        const ownerName = await dbGet('settings', 'ownerName');
        if (coachingName) $('appName').textContent = coachingName.value;
        if (ownerName) $('ownerDisplay').textContent = ownerName.value;

        // Calculate summaries
        let monthCol = 0, monthPen = 0, totalPaid = 0, totalPen = 0;

        for (const p of payments) {
            const student = students.find(s => s.id === p.studentId);
            if (!student) continue;

            const paid = Number(p.paidAmount);
            const fee = Number(student.monthlyFee);
            const pending = Math.max(0, fee - paid);

            totalPaid += paid;
            totalPen += pending;

            if (p.month === currentMonth) {
                monthCol += paid;
                monthPen += pending;
            }
        }

        // Update summary cards
        $('totalStudents').textContent = students.length;
        $('monthCollection').textContent = formatCurrency(monthCol);
        $('monthPending').textContent = formatCurrency(monthPen);
        $('totalPaid').textContent = formatCurrency(totalPaid);
        $('totalPending').textContent = formatCurrency(totalPen);

        // Render month cards
        renderMonthGrid(payments, students);

        // Update pending badge
        updatePendingBadge(payments);

    } catch (e) {
        console.error('Dashboard load error:', e);
        showToast('Failed to load dashboard', 'error');
    }
};

/** Render the 12 permanent month cards */
const renderMonthGrid = async (payments, students) => {
    const grid = $('monthsGrid');
    if (!grid) return;

    const currentMonth = getCurrentMonth();
    grid.innerHTML = '';

    const monthIcons = [
        'fa-snowflake', 'fa-heart', 'fa-leaf', 'fa-seedling',
        'fa-sun', 'fa-umbrella-beach', 'fa-cloud-rain', 'fa-flag',
        'fa-book', 'fa-ghost', 'fa-cloud', 'fa-gift'
    ];

    MONTHS.forEach((month, i) => {
        // Count students for this month
        const monthPayments = payments.filter(p => p.month === month);
        const studentCount = monthPayments.length;

        const card = document.createElement('div');
        card.className = `month-card glass-panel${month === currentMonth ? ' current' : ''}`;
        card.dataset.month = month;
        card.innerHTML = `
            <div class="month-icon"><i class="fas ${monthIcons[i]}"></i></div>
            <h3 class="month-name">${month}</h3>
            <p class="month-status">${studentCount} Student${studentCount !== 1 ? 's' : ''}</p>
        `;
        card.addEventListener('click', () => openMonthDashboard(month));
        grid.appendChild(card);
    });
};

/** Update the pending notification badge */
const updatePendingBadge = (payments) => {
    const badge = $('pendingBadge');
    if (!badge) return;

    const pendingCount = payments.filter(p => p.status !== 'PAID').length;
    if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
};

// ==========================================
// 6. MONTH DASHBOARD FUNCTIONS
// ==========================================

/** Open a specific month's dashboard */
const openMonthDashboard = async (month) => {
    currentMonthView = month;
    currentFilter = 'all';
    currentSort = 'name-asc';
    previousPage = 'dashboardPage';

    // Update title
    $('monthTitle').textContent = month;

    // Show page
    navigateTo('monthDashboard');

    // Reset filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === 'all');
    });

    // Reset sort
    $('sortSelect').value = 'name-asc';

    // Clear search
    $('monthSearch').value = '';

    // Load data
    await renderMonthStudents();
};

/** Render student cards for the current month view */
const renderMonthStudents = async () => {
    const payments = await getPaymentsByMonth(currentMonthView);
    const students = await dbGetAll('students');
    const searchQuery = ($('monthSearch')?.value || '').toLowerCase();

    // Build combined data
    let data = payments.map(p => {
        const student = students.find(s => s.id === p.studentId);
        if (!student) return null;
        const pending = Math.max(0, Number(student.monthlyFee) - Number(p.paidAmount));
        return { ...p, student, pending };
    }).filter(Boolean);

    // Apply search filter
    if (searchQuery) {
        data = data.filter(d => d.student.name.toLowerCase().includes(searchQuery));
    }

    // Apply status filter
    if (currentFilter === 'paid') {
        data = data.filter(d => d.status === 'PAID');
    } else if (currentFilter === 'pending') {
        data = data.filter(d => d.status === 'PENDING');
    } else if (currentFilter === 'partial') {
        data = data.filter(d => d.status === 'PARTIALLY PAID');
    }

    // Apply sorting
    switch (currentSort) {
        case 'name-asc':
            data.sort((a, b) => a.student.name.localeCompare(b.student.name));
            break;
        case 'name-desc':
            data.sort((a, b) => b.student.name.localeCompare(a.student.name));
            break;
        case 'pending-high':
            data.sort((a, b) => b.pending - a.pending);
            break;
        case 'pending-low':
            data.sort((a, b) => a.pending - b.pending);
            break;
        case 'recent':
            data.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
            break;
    }

    // Update monthly summary cards
    const allMonthPayments = payments;
    const totalStudents = allMonthPayments.length;
    const paidCount = allMonthPayments.filter(p => p.status === 'PAID').length;
    const pendingCount = allMonthPayments.filter(p => p.status === 'PENDING').length;
    const partialCount = allMonthPayments.filter(p => p.status === 'PARTIALLY PAID').length;

    let totalCollected = 0, totalPendingAmt = 0;
    allMonthPayments.forEach(p => {
        const s = students.find(st => st.id === p.studentId);
        if (s) {
            totalCollected += Number(p.paidAmount);
            totalPendingAmt += Math.max(0, Number(s.monthlyFee) - Number(p.paidAmount));
        }
    });

    $('mTotal').textContent = totalStudents;
    $('mPaid').textContent = paidCount;
    $('mPending').textContent = pendingCount;
    $('mPartial').textContent = partialCount;
    $('mCollected').textContent = formatCurrency(totalCollected);
    $('mPendingAmt').textContent = formatCurrency(totalPendingAmt);

    // Render cards
    const container = $('studentCards');
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = `
            <div class="empty-state glass-panel" style="text-align:center; padding:40px;">
                <i class="fas fa-user-slash" style="font-size:48px; color:var(--text-muted); margin-bottom:15px;"></i>
                <p style="color:var(--text-secondary);">No students found for this filter.</p>
            </div>
        `;
        return;
    }

    data.forEach(d => {
        const card = document.createElement('div');
        card.className = 'student-card glass-panel';
        card.innerHTML = createStudentCardHTML(d);
        container.appendChild(card);
    });

    // Attach card event listeners
    attachStudentCardEvents();
};

/** Generate HTML for a student card */
const createStudentCardHTML = (d) => {
    const statusClass = d.status === 'PAID' ? 'status-paid' :
        d.status === 'PENDING' ? 'status-pending' : 'status-partial';

    const statusIcon = d.status === 'PAID' ? 'fa-check-circle' :
        d.status === 'PENDING' ? 'fa-clock' : 'fa-adjust';

    const statusLabel = d.status === 'PAID' ? '✓ PAID' :
        d.status === 'PENDING' ? '⏳ PENDING' : '◐ PARTIAL';

    return `
        <div class="student-avatar">${getInitials(d.student.name)}</div>
        <div class="student-info">
            <div class="student-name" data-student-id="${d.student.id}" style="cursor:pointer;">${d.student.name}</div>
            <div class="student-meta">
                <span><i class="fas fa-phone"></i> ${d.student.phone}</span>
                <span><i class="fas fa-graduation-cap"></i> ${d.student.studentClass}</span>
            </div>
            <div class="student-fee">
                Fee: ${formatCurrency(d.student.monthlyFee)} | 
                Paid: <span style="color:var(--success)">${formatCurrency(d.paidAmount)}</span> | 
                Pending: <span style="color:var(--warning)">${formatCurrency(d.pending)}</span>
            </div>
            ${d.note ? `<div style="font-size:12px; color:var(--text-muted); margin-top:4px;"><i class="fas fa-sticky-note"></i> ${d.note}</div>` : ''}
        </div>
        <div class="student-actions">
            <span class="status-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusLabel}</span>
            <div class="action-btns">
                <button class="icon-btn edit" data-payment-id="${d.id}" data-student-id="${d.student.id}" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="icon-btn delete" data-payment-id="${d.id}" data-student-name="${d.student.name}" title="Delete from this month">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
};

/** Attach event listeners to dynamically created student cards */
const attachStudentCardEvents = () => {
    // Click on student name → open profile
    document.querySelectorAll('.student-name[data-student-id]').forEach(el => {
        el.addEventListener('click', () => openStudentProfile(el.dataset.studentId));
    });

    // Edit button
    document.querySelectorAll('.icon-btn.edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(btn.dataset.paymentId, btn.dataset.studentId);
        });
    });

    // Delete button (from month only)
    document.querySelectorAll('.icon-btn.delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const paymentId = btn.dataset.paymentId;
            const name = btn.dataset.studentName;
            showConfirmDialog(
                `Are you sure you want to delete ${name} from ${currentMonthView}?`,
                async () => {
                    await dbDelete('payments', paymentId);
                    showToast(`${name} removed from ${currentMonthView}`, 'success');
                    await renderMonthStudents();
                }
            );
        });
    });
};

// ==========================================
// 7. STUDENT CRUD OPERATIONS
// ==========================================

/** Open the Add Student modal */
const openAddModal = async () => {
    editingPaymentId = null;
    editingStudentId = null;

    $('modalTitle').textContent = 'Add Student';
    $('formSubmit').textContent = 'Add Student';

    // Load defaults
    const defaultFee = await dbGet('settings', 'defaultFee');
    const defaultClass = await dbGet('settings', 'defaultClass');

    // Reset form
    $('studentForm').reset();
    $('formClass').value = defaultClass ? defaultClass.value : 'Class 10';
    $('formFee').value = defaultFee ? defaultFee.value : 800;
    $('formPaid').value = 0;
    $('formDate').value = new Date().toISOString().split('T')[0];

    // Show modal
    $('studentModal').classList.remove('hidden');
    $('studentModal').classList.add('active');
};

/** Open the Edit Student modal with pre-filled data */
const openEditModal = async (paymentId, studentId) => {
    editingPaymentId = paymentId;
    editingStudentId = studentId;

    $('modalTitle').textContent = 'Edit Student';
    $('formSubmit').textContent = 'Save Changes';

    try {
        const student = await dbGet('students', studentId);
        const payment = await dbGet('payments', paymentId);

        $('formName').value = student.name;
        $('formPhone').value = student.phone;
        $('formClass').value = student.studentClass;
        $('formFee').value = student.monthlyFee;
        $('formPaid').value = payment.paidAmount;
        $('formDate').value = payment.paymentDate ? payment.paymentDate.split('T')[0] : '';
        $('formNote').value = payment.note || '';

        $('studentModal').classList.remove('hidden');
        $('studentModal').classList.add('active');
    } catch (e) {
        console.error('Error loading edit data:', e);
        showToast('Failed to load student data', 'error');
    }
};

/** Close the student modal */
const closeModal = () => {
    $('studentModal').classList.remove('active');
    setTimeout(() => $('studentModal').classList.add('hidden'), 300);
    editingPaymentId = null;
    editingStudentId = null;
};

/** Handle student form submission (Add or Edit) */
const handleStudentSubmit = async (e) => {
    e.preventDefault();

    const name = $('formName').value.trim();
    const phone = $('formPhone').value.trim();
    const studentClass = $('formClass').value.trim();
    const monthlyFee = Number($('formFee').value);
    const paidAmount = Number($('formPaid').value);
    const paymentDate = $('formDate').value;
    const note = $('formNote').value.trim();

    if (!name) {
        showToast('Student name is required', 'warning');
        return;
    }

    if (paidAmount > monthlyFee) {
        showToast('Paid amount cannot exceed monthly fee', 'warning');
        return;
    }

    const status = getPaymentStatus(paidAmount, monthlyFee);
    const month = currentMonthView || getCurrentMonth();

    try {
        if (editingPaymentId && editingStudentId) {
            // EDIT existing student and payment
            const student = await dbGet('students', editingStudentId);
            student.name = name;
            student.phone = phone;
            student.studentClass = studentClass;
            student.monthlyFee = monthlyFee;
            await dbPut('students', student);

            const payment = await dbGet('payments', editingPaymentId);
            payment.paidAmount = paidAmount;
            payment.paymentDate = paymentDate || new Date().toISOString();
            payment.note = note;
            payment.status = status;
            await dbPut('payments', payment);

            showToast('Student updated successfully! ✏️', 'success');
        } else {
            // ADD new student
            // Check if student exists (by name + phone)
            const allStudents = await dbGetAll('students');
            let existingStudent = allStudents.find(
                s => s.name.toLowerCase() === name.toLowerCase()
            );

            let studentId;
            if (existingStudent) {
                // Student exists, just add payment for this month
                studentId = existingStudent.id;
                // Update student details in case they changed
                existingStudent.studentClass = studentClass;
                existingStudent.monthlyFee = monthlyFee;
                await dbPut('students', existingStudent);
            } else {
                // New student
                studentId = generateId();
                await dbPut('students', {
                    id: studentId,
                    name: name,
                    phone: phone,
                    studentClass: studentClass,
                    monthlyFee: monthlyFee,
                    createdAt: new Date().toISOString()
                });
            }

            // Check if payment already exists for this month
            const monthPayments = await getPaymentsByMonth(month);
            const existingPayment = monthPayments.find(p => p.studentId === studentId);

            if (existingPayment) {
                showToast(`${name} already has a payment record for ${month}`, 'warning');
                closeModal();
                return;
            }

            // Create payment record
            await dbPut('payments', {
                id: generateId(),
                studentId: studentId,
                month: month,
                paidAmount: paidAmount,
                paymentDate: paymentDate || new Date().toISOString(),
                note: note,
                status: status
            });

            showToast(`${name} added to ${month}! 🎉`, 'success');
        }

        closeModal();
        await renderMonthStudents();
    } catch (e) {
        console.error('Submit error:', e);
        showToast('Operation failed', 'error');
    }
};

/** Show confirmation dialog */
const showConfirmDialog = (message, callback) => {
    $('confirmMessage').textContent = message;
    confirmCallback = callback;
    $('confirmDialog').classList.remove('hidden');
    $('confirmDialog').classList.add('active');
};

/** Close confirmation dialog */
const closeConfirmDialog = () => {
    $('confirmDialog').classList.remove('active');
    setTimeout(() => $('confirmDialog').classList.add('hidden'), 300);
    confirmCallback = null;
};

// ==========================================
// 10. STUDENT PROFILE FUNCTIONS
// ==========================================

/** Open a student's full profile */
const openStudentProfile = async (studentId) => {
    currentProfileId = studentId;
    previousPage = document.querySelector('.page:not(.hidden)')?.id || 'dashboardPage';

    navigateTo('studentProfile');

    try {
        const student = await dbGet('students', studentId);
        if (!student) {
            showToast('Student not found', 'error');
            navigateTo('dashboardPage');
            return;
        }

        const payments = await getPaymentsByStudent(studentId);

        // Profile header
        $('profileAvatar').textContent = getInitials(student.name);
        $('profileName').textContent = student.name;
        $('profilePhone').innerHTML = `<i class="fas fa-phone"></i> ${student.phone}`;
        $('profileClass').innerHTML = `<i class="fas fa-graduation-cap"></i> ${student.studentClass}`;
        $('profileFee').innerHTML = `<i class="fas fa-indian-rupee-sign"></i> ${formatCurrency(student.monthlyFee)}/month`;

        // Payment history
        const historyContainer = $('paymentHistory');
        historyContainer.innerHTML = '';

        let totalAnnualFees = 0, totalPaidAmt = 0, totalPendingAmt = 0;

        MONTHS.forEach(month => {
            const payment = payments.find(p => p.month === month);
            const card = document.createElement('div');
            card.className = 'history-card glass-panel';

            if (payment) {
                const paid = Number(payment.paidAmount);
                const pending = Math.max(0, Number(student.monthlyFee) - paid);
                totalAnnualFees += Number(student.monthlyFee);
                totalPaidAmt += paid;
                totalPendingAmt += pending;

                const statusClass = payment.status === 'PAID' ? 'status-paid' :
                    payment.status === 'PENDING' ? 'status-pending' : 'status-partial';
                const statusIcon = payment.status === 'PAID' ? '✓' :
                    payment.status === 'PENDING' ? '⏳' : '◐';

                card.innerHTML = `
                    <div>
                        <div class="history-month">${month}</div>
                        <div class="history-amount">
                            Paid: ${formatCurrency(paid)}${pending > 0 ? ` / Pending: ${formatCurrency(pending)}` : ''}
                        </div>
                    </div>
                    <span class="status-badge ${statusClass}">${statusIcon} ${payment.status}</span>
                `;
            } else {
                card.innerHTML = `
                    <div>
                        <div class="history-month">${month}</div>
                        <div class="history-amount" style="color:var(--text-muted)">Not Enrolled</div>
                    </div>
                    <span style="color:var(--text-muted); font-size:12px;">—</span>
                `;
            }

            historyContainer.appendChild(card);
        });

        // Annual summary
        $('annualFees').textContent = formatCurrency(totalAnnualFees);
        $('annualPaid').textContent = formatCurrency(totalPaidAmt);
        $('annualPending').textContent = formatCurrency(totalPendingAmt);

    } catch (e) {
        console.error('Profile load error:', e);
        showToast('Failed to load profile', 'error');
    }
};

/** Delete a student completely (profile + all payments) */
const deleteStudentCompletely = async (studentId) => {
    try {
        const student = await dbGet('students', studentId);
        if (!student) return;

        // Delete all payments for this student
        const payments = await getPaymentsByStudent(studentId);
        for (const p of payments) {
            await dbDelete('payments', p.id);
        }

        // Delete student
        await dbDelete('students', studentId);

        showToast(`${student.name} deleted completely! 🗑️`, 'success');
        navigateTo('dashboardPage');
    } catch (e) {
        console.error('Delete error:', e);
        showToast('Failed to delete student', 'error');
    }
};

// ==========================================
// 8. SEARCH FUNCTIONS
// ==========================================

/** Load the search/students page */
const loadSearchPage = async () => {
    const query = ($('globalSearch')?.value || '').toLowerCase();
    await renderSearchResults(query);
};

/** Render search results */
const renderSearchResults = async (query) => {
    const students = await dbGetAll('students');
    const allPayments = await dbGetAll('payments');
    const container = $('searchResults');
    container.innerHTML = '';

    let filtered = students;
    if (query) {
        filtered = students.filter(s => s.name.toLowerCase().includes(query));
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state glass-panel" style="text-align:center; padding:40px; margin-top:20px;">
                <i class="fas fa-search" style="font-size:48px; color:var(--text-muted); margin-bottom:15px;"></i>
                <p style="color:var(--text-secondary);">No students found.</p>
            </div>
        `;
        return;
    }

    for (const student of filtered) {
        const payments = allPayments.filter(p => p.studentId === student.id);
        const card = document.createElement('div');
        card.className = 'search-result-card glass-panel';
        card.style.cssText = 'padding:20px; margin-bottom:15px; cursor:pointer;';

        let totalFees = 0, totalPaid = 0, totalPending = 0;
        let monthDetails = '';

        MONTHS.forEach(month => {
            const payment = payments.find(p => p.month === month);
            if (payment) {
                const paid = Number(payment.paidAmount);
                const pending = Math.max(0, Number(student.monthlyFee) - paid);
                totalFees += Number(student.monthlyFee);
                totalPaid += paid;
                totalPending += pending;

                const statusColor = payment.status === 'PAID' ? 'var(--success)' :
                    payment.status === 'PENDING' ? 'var(--warning)' : 'var(--partial)';
                const statusText = payment.status === 'PAID' ? `${formatCurrency(paid)} Paid ✓` :
                    payment.status === 'PENDING' ? `${formatCurrency(pending)} Pending ⏳` :
                    `${formatCurrency(paid)} Paid / ${formatCurrency(pending)} Pending ◐`;

                monthDetails += `<div style="display:flex; justify-content:space-between; padding:4px 0; font-size:13px;">
                    <span>${month}</span>
                    <span style="color:${statusColor}">${statusText}</span>
                </div>`;
            }
        });

        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:15px; margin-bottom:15px;">
                <div class="student-avatar" style="width:45px; height:45px; font-size:18px;">${getInitials(student.name)}</div>
                <div>
                    <div style="font-weight:600; font-size:16px;">${student.name}</div>
                    <div style="font-size:13px; color:var(--text-secondary);">
                        <i class="fas fa-phone"></i> ${student.phone} | 
                        <i class="fas fa-graduation-cap"></i> ${student.studentClass}
                    </div>
                </div>
            </div>
            <div style="border-top:1px solid var(--glass-border); padding-top:10px; margin-bottom:10px;">
                ${monthDetails || '<p style="color:var(--text-muted)">No payment records</p>'}
            </div>
            <div style="display:flex; justify-content:space-around; padding-top:10px; border-top:1px solid var(--glass-border);">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted);">Total Fees</div>
                    <div style="font-weight:600;">${formatCurrency(totalFees)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted);">Total Paid</div>
                    <div style="font-weight:600; color:var(--success);">${formatCurrency(totalPaid)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--text-muted);">Total Pending</div>
                    <div style="font-weight:600; color:var(--warning);">${formatCurrency(totalPending)}</div>
                </div>
            </div>
        `;

        card.addEventListener('click', () => openStudentProfile(student.id));
        container.appendChild(card);
    }
};

// ==========================================
// 9. PENDING FEES FUNCTIONS
// ==========================================

/** Load the pending fees page */
const loadPendingPage = async () => {
    const query = ($('pendingSearch')?.value || '').toLowerCase();
    await renderPendingList(query);
};

/** Render pending fees list */
const renderPendingList = async (query) => {
    const students = await dbGetAll('students');
    const allPayments = await dbGetAll('payments');
    const container = $('pendingList');
    container.innerHTML = '';

    // Filter to only non-PAID payments
    let pendingPayments = allPayments.filter(p => p.status !== 'PAID');

    // Apply search
    if (query) {
        pendingPayments = pendingPayments.filter(p => {
            const s = students.find(st => st.id === p.studentId);
            return s && s.name.toLowerCase().includes(query);
        });
    }

    // Sort by highest pending first
    pendingPayments.sort((a, b) => {
        const sA = students.find(s => s.id === a.studentId);
        const sB = students.find(s => s.id === b.studentId);
        if (!sA || !sB) return 0;
        const penA = Number(sA.monthlyFee) - Number(a.paidAmount);
        const penB = Number(sB.monthlyFee) - Number(b.paidAmount);
        return penB - penA;
    });

    // Calculate totals
    let totalPendingAmt = 0;
    const uniqueStudents = new Set();
    pendingPayments.forEach(p => {
        const s = students.find(st => st.id === p.studentId);
        if (s) {
            totalPendingAmt += Math.max(0, Number(s.monthlyFee) - Number(p.paidAmount));
            uniqueStudents.add(s.id);
        }
    });

    $('pendingCount').textContent = uniqueStudents.size;
    $('pendingTotal').textContent = formatCurrency(totalPendingAmt);

    if (pendingPayments.length === 0) {
        container.innerHTML = `
            <div class="empty-state glass-panel" style="text-align:center; padding:40px; margin-top:20px;">
                <i class="fas fa-check-double" style="font-size:48px; color:var(--success); margin-bottom:15px;"></i>
                <p style="color:var(--text-secondary);">All fees are paid! 🎉</p>
            </div>
        `;
        return;
    }

    pendingPayments.forEach(p => {
        const student = students.find(s => s.id === p.studentId);
        if (!student) return;

        const pending = Math.max(0, Number(student.monthlyFee) - Number(p.paidAmount));
        const statusClass = p.status === 'PENDING' ? 'status-pending' : 'status-partial';
        const statusLabel = p.status === 'PENDING' ? '⏳ PENDING' : '◐ PARTIAL';

        const card = document.createElement('div');
        card.className = 'student-card glass-panel';
        card.style.cursor = 'pointer';
        card.innerHTML = `
            <div class="student-avatar">${getInitials(student.name)}</div>
            <div class="student-info">
                <div class="student-name">${student.name}</div>
                <div class="student-meta">
                    <span><i class="fas fa-calendar"></i> ${p.month}</span>
                    <span><i class="fas fa-phone"></i> ${student.phone}</span>
                </div>
                <div class="student-fee">
                    Fee: ${formatCurrency(student.monthlyFee)} | 
                    Paid: <span style="color:var(--success)">${formatCurrency(p.paidAmount)}</span> | 
                    Pending: <span style="color:var(--warning)">${formatCurrency(pending)}</span>
                </div>
            </div>
            <div class="student-actions">
                <span class="status-badge ${statusClass}">${statusLabel}</span>
            </div>
        `;
        card.addEventListener('click', () => openStudentProfile(student.id));
        container.appendChild(card);
    });
};

// ==========================================
// 11. SETTINGS FUNCTIONS
// ==========================================

/** Load settings page with current values */
const loadSettingsPage = async () => {
    try {
        const cName = await dbGet('settings', 'coachingName');
        const oName = await dbGet('settings', 'ownerName');
        const dFee = await dbGet('settings', 'defaultFee');
        const dClass = await dbGet('settings', 'defaultClass');

        $('settingName').value = cName ? cName.value : 'RD Coaching Center';
        $('settingOwner').value = oName ? oName.value : 'Rudra Debnath';
        $('settingFee').value = dFee ? dFee.value : 800;
        $('settingClass').value = dClass ? dClass.value : 'Class 10';

        // Clear password fields
        $('currentPassword').value = '';
        $('newPassword').value = '';
        $('confirmPassword').value = '';
    } catch (e) {
        console.error('Settings load error:', e);
    }
};

/** Save settings */
const saveSettings = async () => {
    try {
        await dbPut('settings', { key: 'coachingName', value: $('settingName').value.trim() });
        await dbPut('settings', { key: 'ownerName', value: $('settingOwner').value.trim() });
        await dbPut('settings', { key: 'defaultFee', value: Number($('settingFee').value) });
        await dbPut('settings', { key: 'defaultClass', value: $('settingClass').value.trim() });

        // Update header
        $('appName').textContent = $('settingName').value.trim();
        $('ownerDisplay').textContent = $('settingOwner').value.trim();

        // Handle password change
        const currentPass = $('currentPassword').value;
        const newPass = $('newPassword').value;
        const confirmPass = $('confirmPassword').value;

        if (currentPass && newPass) {
            if (newPass !== confirmPass) {
                showToast('New passwords do not match', 'warning');
                return;
            }
            if (newPass.length < 4) {
                showToast('Password must be at least 4 characters', 'warning');
                return;
            }

            const auth = await dbGet('auth', 'owner');
            const hashedCurrent = await hashPassword(currentPass);

            if (auth.password !== hashedCurrent) {
                showToast('Current password is incorrect', 'error');
                return;
            }

            const hashedNew = await hashPassword(newPass);
            auth.password = hashedNew;
            auth.name = $('settingOwner').value.trim();
            await dbPut('auth', auth);

            $('currentPassword').value = '';
            $('newPassword').value = '';
            $('confirmPassword').value = '';

            showToast('Password changed successfully! 🔒', 'success');
        }

        showToast('Settings saved! ⚙️', 'success');
    } catch (e) {
        console.error('Save settings error:', e);
        showToast('Failed to save settings', 'error');
    }
};

// ==========================================
// 12. EXPORT & BACKUP FUNCTIONS
// ==========================================

/** Export data as CSV */
const exportCSV = async () => {
    try {
        const students = await dbGetAll('students');
        const payments = await dbGetAll('payments');

        let csv = 'Student Name,Phone,Class,Month,Monthly Fee,Paid Amount,Pending Amount,Status,Payment Date,Note\n';

        payments.forEach(p => {
            const s = students.find(x => x.id === p.studentId);
            if (!s) return;
            const pending = Math.max(0, Number(s.monthlyFee) - Number(p.paidAmount));
            csv += `"${s.name}","${s.phone}","${s.studentClass}","${p.month}",${s.monthlyFee},${p.paidAmount},${pending},"${p.status}","${formatDate(p.paymentDate)}","${p.note || ''}"\n`;
        });

        downloadFile(csv, `RD_Coaching_Payments_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
        showToast('CSV exported! 📄', 'success');
    } catch (e) {
        console.error('CSV export error:', e);
        showToast('Export failed', 'error');
    }
};

/** Export data as Excel-compatible CSV (with BOM for proper encoding) */
const exportExcel = async () => {
    try {
        const students = await dbGetAll('students');
        const payments = await dbGetAll('payments');

        // BOM for Excel UTF-8 compatibility
        let csv = '\uFEFF';
        csv += 'Student Name\tPhone\tClass\tMonth\tMonthly Fee\tPaid Amount\tPending Amount\tStatus\tPayment Date\tNote\n';

        payments.forEach(p => {
            const s = students.find(x => x.id === p.studentId);
            if (!s) return;
            const pending = Math.max(0, Number(s.monthlyFee) - Number(p.paidAmount));
            csv += `${s.name}\t${s.phone}\t${s.studentClass}\t${p.month}\t${s.monthlyFee}\t${p.paidAmount}\t${pending}\t${p.status}\t${formatDate(p.paymentDate)}\t${p.note || ''}\n`;
        });

        downloadFile(csv, `RD_Coaching_Payments_${new Date().toISOString().split('T')[0]}.xls`, 'application/vnd.ms-excel');
        showToast('Excel file exported! 📊', 'success');
    } catch (e) {
        console.error('Excel export error:', e);
        showToast('Export failed', 'error');
    }
};

/** Generate a PDF report (opens print dialog) */
const exportPDF = async () => {
    try {
        const students = await dbGetAll('students');
        const payments = await dbGetAll('payments');
        const coachingName = await dbGet('settings', 'coachingName');

        let html = `
        <html><head><title>Payment Report</title>
        <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; color: #333; }
            h1 { text-align: center; color: #4a3cc5; margin-bottom: 5px; }
            h3 { text-align: center; color: #666; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
            th { background: #4a3cc5; color: white; padding: 10px 8px; text-align: left; }
            td { padding: 8px; border-bottom: 1px solid #eee; }
            tr:nth-child(even) { background: #f8f8ff; }
            .paid { color: #10b981; font-weight: 600; }
            .pending { color: #f59e0b; font-weight: 600; }
            .partial { color: #3b82f6; font-weight: 600; }
            .summary { margin-top: 30px; text-align: right; font-size: 14px; }
            .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
        </style></head><body>
        <h1>${coachingName ? coachingName.value : 'RD Coaching Center'}</h1>
        <h3>Student Payment Report — Generated ${formatDate(new Date().toISOString())}</h3>
        <table>
            <tr><th>#</th><th>Student</th><th>Phone</th><th>Class</th><th>Month</th><th>Fee</th><th>Paid</th><th>Pending</th><th>Status</th></tr>
        `;

        let totalPaid = 0, totalPending = 0;
        let idx = 1;

        payments.forEach(p => {
            const s = students.find(x => x.id === p.studentId);
            if (!s) return;
            const pending = Math.max(0, Number(s.monthlyFee) - Number(p.paidAmount));
            totalPaid += Number(p.paidAmount);
            totalPending += pending;

            const statusClass = p.status === 'PAID' ? 'paid' : p.status === 'PENDING' ? 'pending' : 'partial';

            html += `<tr>
                <td>${idx++}</td>
                <td>${s.name}</td>
                <td>${s.phone}</td>
                <td>${s.studentClass}</td>
                <td>${p.month}</td>
                <td>₹${s.monthlyFee}</td>
                <td>₹${p.paidAmount}</td>
                <td>₹${pending}</td>
                <td class="${statusClass}">${p.status}</td>
            </tr>`;
        });

        html += `</table>
        <div class="summary">
            <p><strong>Total Collected:</strong> ₹${totalPaid.toLocaleString('en-IN')}</p>
            <p><strong>Total Pending:</strong> ₹${totalPending.toLocaleString('en-IN')}</p>
        </div>
        <div class="footer">This report was auto-generated by RD Coaching Center Payment Management System.</div>
        </body></html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        win.print();

        showToast('PDF report opened for printing! 🖨️', 'success');
    } catch (e) {
        console.error('PDF export error:', e);
        showToast('PDF generation failed', 'error');
    }
};

/** Backup all data as JSON */
const backupData = async () => {
    try {
        const data = {
            students: await dbGetAll('students'),
            payments: await dbGetAll('payments'),
            settings: await dbGetAll('settings'),
            auth: await dbGetAll('auth'),
            backupDate: new Date().toISOString(),
            version: 1
        };

        const json = JSON.stringify(data, null, 2);
        downloadFile(json, `RD_Coaching_Backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
        showToast('Backup downloaded! 💾', 'success');
    } catch (e) {
        console.error('Backup error:', e);
        showToast('Backup failed', 'error');
    }
};

/** Restore data from JSON backup */
const restoreData = async (file) => {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.students || !data.payments) {
            showToast('Invalid backup file', 'error');
            return;
        }

        showConfirmDialog(
            'This will REPLACE all current data with the backup. Are you sure?',
            async () => {
                // Clear all stores
                await dbClearStore('students');
                await dbClearStore('payments');
                await dbClearStore('settings');
                await dbClearStore('auth');

                // Restore data
                for (const s of data.students) await dbPut('students', s);
                for (const p of data.payments) await dbPut('payments', p);
                if (data.settings) for (const s of data.settings) await dbPut('settings', s);
                if (data.auth) for (const a of data.auth) await dbPut('auth', a);

                showToast('Data restored successfully! 🔄', 'success');
                loadDashboard();
                loadSettingsPage();
            }
        );
    } catch (e) {
        console.error('Restore error:', e);
        showToast('Restore failed. Check file format.', 'error');
    }
};

/** Helper to download a file */
const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// ==========================================
// 16. EVENT LISTENERS AND INITIALIZATION
// ==========================================

/** Set up all event listeners */
const initEventListeners = () => {
    // === LOGIN ===
    $('loginBtn').addEventListener('click', handleLogin);
    $('loginPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    $('loginName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('loginPassword').focus();
    });

    // Password toggle
    const passwordToggle = document.querySelector('.password-toggle');
    if (passwordToggle) {
        passwordToggle.addEventListener('click', () => {
            const input = $('loginPassword');
            const icon = passwordToggle.querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fas fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fas fa-eye';
            }
        });
    }

    // === LOGOUT ===
    $('logoutBtn').addEventListener('click', handleLogout);

    // === BOTTOM NAVIGATION ===
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            switch (page) {
                case 'dashboard':
                    navigateTo('dashboardPage');
                    break;
                case 'months':
                    navigateTo('dashboardPage');
                    // Scroll to months section
                    setTimeout(() => {
                        $('monthsGrid')?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                    break;
                case 'search':
                    navigateTo('searchPage');
                    break;
                case 'pending':
                    navigateTo('pendingPage');
                    break;
                case 'settings':
                    navigateTo('settingsPage');
                    break;
            }
        });
    });

    // === MONTH DASHBOARD ===
    $('monthBackBtn').addEventListener('click', () => navigateTo('dashboardPage'));
    $('addStudentBtn').addEventListener('click', openAddModal);

    // Search in month
    $('monthSearch').addEventListener('input', () => renderMonthStudents());

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderMonthStudents();
        });
    });

    // Sort select
    $('sortSelect').addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderMonthStudents();
    });

    // === STUDENT MODAL ===
    $('studentForm').addEventListener('submit', handleStudentSubmit);
    $('modalClose').addEventListener('click', closeModal);
    $('formCancel').addEventListener('click', closeModal);

    // Close modal on overlay click
    $('studentModal').addEventListener('click', (e) => {
        if (e.target === $('studentModal')) closeModal();
    });

    // === CONFIRM DIALOG ===
    $('confirmCancel').addEventListener('click', closeConfirmDialog);
    $('confirmDelete').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirmDialog();
    });

    // Close confirm on overlay click
    $('confirmDialog').addEventListener('click', (e) => {
        if (e.target === $('confirmDialog')) closeConfirmDialog();
    });

    // === STUDENT PROFILE ===
    $('profileBackBtn').addEventListener('click', () => {
        navigateTo(previousPage);
    });

    $('editProfileBtn').addEventListener('click', async () => {
        if (!currentProfileId) return;
        // Find first payment for this student to edit
        const payments = await getPaymentsByStudent(currentProfileId);
        const currentMonth = getCurrentMonth();
        const currentMonthPayment = payments.find(p => p.month === currentMonth);

        if (currentMonthPayment) {
            currentMonthView = currentMonth;
            openEditModal(currentMonthPayment.id, currentProfileId);
        } else {
            showToast('No payment record for current month. Add one first.', 'info');
        }
    });

    $('deleteProfileBtn').addEventListener('click', () => {
        if (!currentProfileId) return;
        showConfirmDialog(
            'Are you sure you want to COMPLETELY delete this student and ALL payment history?',
            () => deleteStudentCompletely(currentProfileId)
        );
    });

    // === GLOBAL SEARCH ===
    $('globalSearch').addEventListener('input', (e) => {
        renderSearchResults(e.target.value.toLowerCase());
    });

    // === PENDING SEARCH ===
    $('pendingSearch').addEventListener('input', (e) => {
        renderPendingList(e.target.value.toLowerCase());
    });

    // === SETTINGS ===
    $('saveSettings').addEventListener('click', saveSettings);

    // === EXPORT & BACKUP ===
    $('exportCSV').addEventListener('click', exportCSV);
    $('exportExcel').addEventListener('click', exportExcel);
    $('exportPDF').addEventListener('click', exportPDF);
    $('backupData').addEventListener('click', backupData);

    $('restoreData').addEventListener('click', () => {
        $('restoreFile').click();
    });

    $('restoreFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) restoreData(file);
        e.target.value = ''; // Reset file input
    });
};

// ==========================================
// APP INITIALIZATION
// ==========================================

/** Main entry point */
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize database
        await initDB();

        // Seed default data on first launch
        await seedDataIfNeeded();

        // Set up all event listeners
        initEventListeners();

        // Check authentication and show correct screen
        checkAuth();

        console.log('✅ RD Coaching Center App initialized successfully!');
    } catch (e) {
        console.error('❌ Initialization failed:', e);
        showToast('App initialization failed. Please refresh.', 'error');
    }
});
