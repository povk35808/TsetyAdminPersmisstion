import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, doc, updateDoc, deleteDoc, collection, query, where, onSnapshot, serverTimestamp, Timestamp, setLogLevel,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Enable Firestore debug logging
setLogLevel('debug');

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyDjr_Ha2RxOWEumjEeSdluIW3JmyM76mVk",
    authDomain: "dipermisstion.firebaseapp.com",
    projectId: "dipermisstion",
    storageBucket: "dipermisstion.firebasestorage.app",
    messagingSenderId: "512999406057",
    appId: "1:512999406057:web:953a281ab9dde7a9a0f378",
    measurementId: "G-KDPHXZ7H4B"
};

// --- Global State & Element References ---
let db, auth;
let requestsUnsubscribe = null;
const ADMIN_NAME = "Admin Daro";
let globalAllRequests = []; // For detail modal
let allDepartments = new Set(); // [NEW] For department filter

// --- Firestore Collection Path ---
let leaveRequestsCollectionPath;
let outRequestsCollectionPath;

// --- Element References ---
let mainContentArea, requestListContainer, loadingIndicator, emptyPlaceholder, errorDisplay, footerNav;
let settingsPage, toggleMonthFilter, toggleCompactView;
let currentFilter = 'pending'; // Default filter

// --- [NEW] Settings Elements ---
let approvedFilterRadios, toggleDepartmentFilter, departmentFilterContainer, departmentSelect;
let darkModeRadios, themeSelect;

// --- [MODIFIED] Settings State ---
let settings = {
    filterCurrentMonth: false,
    compactViewApproved: false,
    approvedFilterType: 'all', // 'all', 'leave', 'out'
    filterByDepartment: false,
    selectedDepartment: 'all', // 'all', or 'IT Support', etc.
    darkMode: 'auto', // 'auto', 'light', 'dark'
    theme: 'original' // 'original', 'glass', 'ocean', etc.
};

// --- Modal References ---
let confirmationModal, confirmationTitle, confirmationMessage, confirmYesBtn, confirmNoBtn;
let customAlertModal, customAlertTitle, customAlertMessage, customAlertIconSuccess, customAlertIconWarning;
let requestDetailModal, detailModalContent, detailModalCloseBtn;


// --- Helper: Format Timestamp ---
function formatFirestoreTimestamp(timestamp, format = 'HH:mm dd/MM/yyyy') {
     let date;
     if (!timestamp) return "";
     if (timestamp instanceof Date) date = timestamp;
     else if (timestamp.toDate) date = timestamp.toDate();
     else if (typeof timestamp === 'string') { date = new Date(timestamp); if (isNaN(date.getTime())) return ""; }
     else if (timestamp.seconds) date = new Date(timestamp.seconds * 1000);
     else return "";
     const hours = String(date.getHours()).padStart(2, '0');
     const minutes = String(date.getMinutes()).padStart(2, '0');
     const day = String(date.getDate()).padStart(2, '0');
     const month = String(date.getMonth() + 1).padStart(2, '0');
     const year = date.getFullYear();
     if (format === 'HH:mm' || format === 'time') return `${hours}:${minutes}`;
     if (format === 'dd/MM/yyyy' || format === 'date') return `${day}/${month}/${year}`;
     return `${hours}:${minutes} ${day}/${month}/${year}`;
}

// --- [MODIFIED] Settings Functions ---
function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('adminSettings');
        if (savedSettings) {
            // Merge saved settings, keeping defaults for new/missing keys
            const parsed = JSON.parse(savedSettings);
            settings = { ...settings, ...parsed };
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
        localStorage.removeItem('adminSettings');
    }
    
    // Update UI elements based on loaded settings
    if (toggleMonthFilter) toggleMonthFilter.checked = settings.filterCurrentMonth;
    if (toggleCompactView) toggleCompactView.checked = settings.compactViewApproved;
    
    // Approved filter
    if (approvedFilterRadios) approvedFilterRadios.forEach(radio => radio.checked = (radio.value === settings.approvedFilterType));

    // Department filter
    if (toggleDepartmentFilter) toggleDepartmentFilter.checked = settings.filterByDepartment;
    if (departmentFilterContainer) departmentFilterContainer.classList.toggle('hidden', !settings.filterByDepartment);
    if (departmentSelect) departmentSelect.value = settings.selectedDepartment;

    // Dark mode
    if (darkModeRadios) darkModeRadios.forEach(radio => radio.checked = (radio.value === settings.darkMode));
    
    // Theme
    if (themeSelect) themeSelect.value = settings.theme;

    // Apply visual settings on load
    applyDarkMode();
    applyTheme();
}

function saveSettings() {
    try {
        localStorage.setItem('adminSettings', JSON.stringify(settings));
    } catch (e) {
        console.error("Failed to save settings:", e);
    }
}
 
// --- [NEW] Dark Mode & Theme Functions ---
function applyDarkMode() {
    const root = document.documentElement;
    if (settings.darkMode === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
    } else if (settings.darkMode === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
}
 
function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    // Show/hide bg image for glass theme
    document.getElementById('body-bg-image').classList.toggle('hidden', settings.theme !== 'glass');
}
 
// [NEW] Media query listener for auto dark mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (settings.darkMode === 'auto') {
        applyDarkMode();
    }
});

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', async () => {

    // --- Assign Element References ---
    mainContentArea = document.getElementById('main-content-area');
    requestListContainer = document.getElementById('request-list');
    loadingIndicator = document.getElementById('loading-indicator');
    emptyPlaceholder = document.getElementById('empty-placeholder');
    errorDisplay = document.getElementById('error-display');
    footerNav = document.getElementById('footer-nav');
    settingsPage = document.getElementById('settings-page');
    toggleMonthFilter = document.getElementById('toggle-month-filter');
    toggleCompactView = document.getElementById('toggle-compact-view');
    
    // --- [NEW] Assign Settings Elements ---
    approvedFilterRadios = document.querySelectorAll('input[name="approved-filter-type"]');
    toggleDepartmentFilter = document.getElementById('toggle-department-filter');
    departmentFilterContainer = document.getElementById('department-filter-container');
    departmentSelect = document.getElementById('department-select');
    darkModeRadios = document.querySelectorAll('input[name="dark-mode-select"]');
    themeSelect = document.getElementById('theme-select');

    // --- Assign Modal Elements ---
    customAlertModal = document.getElementById('custom-alert-modal');
    customAlertTitle = document.getElementById('custom-alert-title');
    customAlertMessage = document.getElementById('custom-alert-message');
    customAlertIconSuccess = document.getElementById('custom-alert-icon-success');
    customAlertIconWarning = document.getElementById('custom-alert-icon-warning');
    
    confirmationModal = document.getElementById('confirmation-modal');
    confirmationTitle = document.getElementById('confirmation-title');
    confirmationMessage = document.getElementById('confirmation-message');
    confirmYesBtn = document.getElementById('confirm-yes-btn');
    confirmNoBtn = document.getElementById('confirm-no-btn');

    requestDetailModal = document.getElementById('request-detail-modal');
    detailModalContent = document.getElementById('detail-modal-content');
    detailModalCloseBtn = document.getElementById('detail-modal-close-btn');
    
    const customAlertOkBtn = document.getElementById('custom-alert-ok-btn');

    // --- Load Settings from localStorage ---
    loadSettings();

    // --- Initialize Firebase ---
    try {
        if (!firebaseConfig.projectId) throw new Error("Firebase config is missing or invalid.");
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        const canvasAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        leaveRequestsCollectionPath = `/artifacts/${canvasAppId}/public/data/leave_requests`;
        outRequestsCollectionPath = `/artifacts/${canvasAppId}/public/data/out_requests`;
        console.log("Admin App Using Firestore Leave Path:", leaveRequestsCollectionPath);
        console.log("Admin App Using Firestore Out Path:", outRequestsCollectionPath);

        // --- Firebase Authentication ---
         onAuthStateChanged(auth, (user) => {
             if (user) {
                 console.log("Admin App: Signed in. UID:", user.uid);
                 setupRequestListener(currentFilter); // Use default filter
                 updateActiveNavButton(currentFilter); // Highlight active button
             } else {
                 console.log("Admin App: No user. Attempting anonymous sign-in...");
                 signInAnonymously(auth).catch(anonError => {
                     console.error("Admin App: Anonymous Sign-In Error:", anonError);
                     showError(`Critical Error: មិនអាច Sign In បានទេ។ ${anonError.message}។`);
                 });
             }
         });

    } catch (e) {
        console.error("Firebase Initialization Error:", e);
        showError(`Critical Error: មិនអាច​តភ្ជាប់ Firebase បាន​ទេ។ ${e.message}។ សូម Refresh ម្ដងទៀត។`);
    }

    // --- Footer Navigation Listener ---
    if (footerNav) {
        footerNav.addEventListener('click', (event) => {
            const navButton = event.target.closest('.filter-nav-btn');
            if (navButton && navButton.dataset.filter) {
                const newFilter = navButton.dataset.filter;
                
                // Handle Settings Page
                if (newFilter === 'settings') {
                    if (mainContentArea) mainContentArea.classList.add('hidden');
                    if (settingsPage) settingsPage.classList.remove('hidden');
                    currentFilter = 'settings';
                } else {
                    // Handle Request List Pages
                    if (mainContentArea) mainContentArea.classList.remove('hidden');
                    if (settingsPage) settingsPage.classList.add('hidden');
                    
                    if (newFilter !== currentFilter) {
                        console.log("Filter changed to:", newFilter);
                        currentFilter = newFilter;
                        setupRequestListener(currentFilter);
                    }
                }
                updateActiveNavButton(currentFilter);
            }
        });
    }

    // --- Event Listener for Card Action Buttons & Compact Cards ---
    if (requestListContainer) {
        requestListContainer.addEventListener('click', (event) => {
            const actionButton = event.target.closest('.action-btn');
            const compactCard = event.target.closest('.compact-card-btn');
            
            if (actionButton) {
                promptForAdminAction(actionButton); // Pass the button
            } else if (compactCard) {
                const { id, type } = compactCard.dataset;
                const request = globalAllRequests.find(r => r.id === id && r.type === type);
                if (request) {
                    showRequestDetailModal(request);
                }
            }
        });
    }


    // --- Listeners for Modals ---
    if (customAlertOkBtn) customAlertOkBtn.addEventListener('click', hideCustomAlert);
    if (confirmNoBtn) confirmNoBtn.addEventListener('click', () => confirmationModal.classList.add('hidden'));
    if (detailModalCloseBtn) detailModalCloseBtn.addEventListener('click', hideRequestDetailModal);
    if (requestDetailModal) requestDetailModal.addEventListener('click', (e) => { if(e.target === requestDetailModal) hideRequestDetailModal(); }); // Hide on backdrop click

    if (confirmYesBtn) {
        confirmYesBtn.addEventListener('click', () => {
            const { id, type, action } = confirmYesBtn.dataset;
            if (id && type && action) executeAdminAction(id, type, action); 
            confirmationModal.classList.add('hidden');
        });
    }

    // --- [MODIFIED] Listeners for Settings Toggles ---
    if (toggleMonthFilter) {
        toggleMonthFilter.addEventListener('change', (e) => {
            settings.filterCurrentMonth = e.target.checked;
            saveSettings();
            if (currentFilter !== 'settings') setupRequestListener(currentFilter);
        });
    }
    if (toggleCompactView) {
        toggleCompactView.addEventListener('change', (e) => {
            settings.compactViewApproved = e.target.checked;
            saveSettings();
            if (currentFilter === 'approved') sortAndRenderRequests(globalAllRequests, currentFilter);
        });
    }

    // --- [NEW] Listeners for New Settings ---
    if (approvedFilterRadios) {
        approvedFilterRadios.forEach(radio => radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                settings.approvedFilterType = e.target.value;
                saveSettings();
                if (currentFilter === 'approved') setupRequestListener(currentFilter);
            }
        }));
    }

    if (toggleDepartmentFilter) {
        toggleDepartmentFilter.addEventListener('change', (e) => {
            settings.filterByDepartment = e.target.checked;
            departmentFilterContainer.classList.toggle('hidden', !settings.filterByDepartment);
            saveSettings();
            // if disabled, reset filter and re-fetch
            if (!settings.filterByDepartment) {
                settings.selectedDepartment = 'all';
                departmentSelect.value = 'all';
                saveSettings();
            }
            if (currentFilter !== 'settings') setupRequestListener(currentFilter);
        });
    }

    if (departmentSelect) {
        departmentSelect.addEventListener('change', (e) => {
            settings.selectedDepartment = e.target.value;
            saveSettings();
            if (currentFilter !== 'settings') setupRequestListener(currentFilter);
        });
    }

    if (darkModeRadios) {
        darkModeRadios.forEach(radio => radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                settings.darkMode = e.target.value;
                saveSettings();
                applyDarkMode();
            }
        }));
    }

    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            settings.theme = e.target.value;
            saveSettings();
            applyTheme();
        });
    }

}); // End DOMContentLoaded

// --- Update Active Nav Button ---
function updateActiveNavButton(activeFilter) {
    if (!footerNav) return;
    const buttons = footerNav.querySelectorAll('.filter-nav-btn');
    buttons.forEach(btn => {
        if (btn.dataset.filter === activeFilter) {
            btn.classList.add('text-primary', 'bg-secondary');
            btn.classList.remove('text-secondary');
        } else {
            btn.classList.remove('text-primary', 'bg-secondary');
            btn.classList.add('text-secondary');
        }
    });
}


// --- Show Error Message ---
function showError(message) {
    if (errorDisplay) { errorDisplay.textContent = message; errorDisplay.classList.remove('hidden'); }
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
    if (requestListContainer) requestListContainer.innerHTML = '';
    if (emptyPlaceholder) emptyPlaceholder.classList.add('hidden');
}

// --- [NEW] Populate Department Filter Dropdown ---
function populateDepartmentDropdown() {
    if (!departmentSelect) return;
    const currentVal = departmentSelect.value;
    // Clear old options (except 'All')
    departmentSelect.innerHTML = '<option value="all">-- គ្រប់ផ្នែកទាំងអស់ --</option>';
    
    const sortedDepartments = [...allDepartments].filter(d => d).sort(); // Filter out null/empty and sort
    
    sortedDepartments.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        departmentSelect.appendChild(option);
    });
    // Restore previous selection if it still exists
    departmentSelect.value = currentVal;
}

// --- Setup Firestore Listener ---
function setupRequestListener(statusFilter = 'pending') {
    console.log(`Setting up listener for status: ${statusFilter}`);
    if (requestsUnsubscribe) { console.log("Unsubscribing previous listener."); requestsUnsubscribe(); }
    if (!db) { showError("Firestore is not initialized."); return; }

    if (loadingIndicator) loadingIndicator.classList.remove('hidden');
    if (emptyPlaceholder) emptyPlaceholder.classList.add('hidden');
    if (errorDisplay) errorDisplay.classList.add('hidden');
    if (requestListContainer) requestListContainer.innerHTML = '';
    
    const initialDepartmentCount = allDepartments.size;

    const collectionsToQuery = [leaveRequestsCollectionPath, outRequestsCollectionPath];
    let allRequests = [];
    let initialLoadsPending = collectionsToQuery.length;
    requestsUnsubscribe = () => { listeners.forEach(unsub => unsub()); };
    const listeners = [];

    collectionsToQuery.forEach(collectionPath => {
        let q;
        const baseCollectionRef = collection(db, collectionPath);
        if (statusFilter === 'all') q = query(baseCollectionRef);
        else if (statusFilter === 'pending') q = query(baseCollectionRef, where('status', 'in', ['pending', 'editing']));
        else q = query(baseCollectionRef, where('status', '==', statusFilter));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            console.log(`Snapshot received for ${collectionPath.split('/').pop()}, Status: ${statusFilter}, Size: ${snapshot.size}`);
            const type = collectionPath.includes('leave_requests') ? 'leave' : 'out';
            
            let currentDocs = [];
            snapshot.forEach(doc => { 
                const data = doc.data();
                currentDocs.push({ ...data, id: doc.id, type: type }); 
                // [NEW] Collect departments
                if(data.department) allDepartments.add(data.department);
            });

            // [MODIFIED] Apply client-side filters
            
            // 1. Month filter
            if (settings.filterCurrentMonth) {
                const now = new Date();
                const currentMonthYear = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; // e.g., "11/2025"
                
                currentDocs = currentDocs.filter(doc => {
                    const startsInMonth = doc.startDate && doc.startDate.endsWith(currentMonthYear);
                    const endsInMonth = doc.endDate && doc.endDate.endsWith(currentMonthYear);
                    return startsInMonth || endsInMonth;
                });
                console.log(`Client-side month filter (${currentMonthYear}) applied: ${currentDocs.length} results.`);
            }
            
            // 2. [NEW] Approved Type filter (only on 'approved' page)
            if (currentFilter === 'approved' && settings.approvedFilterType !== 'all') {
                currentDocs = currentDocs.filter(doc => doc.type === settings.approvedFilterType);
            }
            
            // 3. [NEW] Department filter (if enabled)
            if (settings.filterByDepartment && settings.selectedDepartment !== 'all') {
                currentDocs = currentDocs.filter(doc => doc.department === settings.selectedDepartment);
            }
            // End client-side filters

            allRequests = allRequests.filter(req => req.type !== type).concat(currentDocs);
            sortAndRenderRequests(allRequests, statusFilter);
            
            if (initialLoadsPending > 0) {
                initialLoadsPending--;
                if (initialLoadsPending === 0) {
                    if (loadingIndicator) loadingIndicator.classList.add('hidden');
                    if(allRequests.length === 0 && emptyPlaceholder) emptyPlaceholder.classList.remove('hidden');
                }
            }
            
            // [NEW] If department list grew, populate dropdown
            if (allDepartments.size > initialDepartmentCount) {
                populateDepartmentDropdown();
            }
            
        }, (error) => {
            console.error(`Error listening to ${collectionPath}:`, error);
            if (error.code === 'failed-precondition' && error.message.includes('index')) showError(`Error: Firestore index required for this query on ${collectionPath.split('/').pop()}. Please check console for link to create index, or simplify query.`);
            else showError(`Error loading ${collectionPath.split('/').pop()}: ${error.message}. Check Firestore Rules.`);
            if (initialLoadsPending > 0) { initialLoadsPending--; if (initialLoadsPending === 0 && loadingIndicator) loadingIndicator.classList.add('hidden'); }
        });
        listeners.push(unsubscribe);
    });
}

// --- Sort and Render Combined Requests ---
 function sortAndRenderRequests(requests, currentFilter) {
     globalAllRequests = [...requests]; // [NEW] Store for detail modal
     
     requests.sort((a, b) => {
         const statusPriority = { 'pending': 1, 'editing': 2, 'approved': 3, 'rejected': 4 };
         const priorityA = statusPriority[a.status] || 5;
         const priorityB = statusPriority[b.status] || 5;
         if (currentFilter !== 'approved' && currentFilter !== 'rejected' && priorityA !== priorityB) return priorityA - priorityB;
         const timeA = a.requestedAt?.toMillis() ?? 0;
         const timeB = b.requestedAt?.toMillis() ?? 0;
         return (currentFilter === 'pending') ? timeA - timeB : timeB - timeA;
     });
     renderRequestList(requests);
 }

// --- Render Request List ---
function renderRequestList(requests) {
    if (!requestListContainer || !loadingIndicator || !emptyPlaceholder) return;
    
    // [MODIFIED] Check for Compact View
    const isCompact = (currentFilter === 'approved' && settings.compactViewApproved);
    
    // Set container class
    requestListContainer.className = isCompact 
        ? "grid grid-cols-3 gap-2 pb-20" // 3-col grid
        : "space-y-4 pb-20"; // Reset to single col

    if (requests.length === 0) {
        if (loadingIndicator && loadingIndicator.classList.contains('hidden') && emptyPlaceholder) emptyPlaceholder.classList.remove('hidden');
        requestListContainer.innerHTML = ''; // Clear grid/space classes if empty
    } else {
        if(emptyPlaceholder) emptyPlaceholder.classList.add('hidden');
        // Render correct card type
        requestListContainer.innerHTML = requests.map(req => 
            isCompact ? renderCompactCard(req) : renderRequestCard(req)
        ).join('');
    }
}
 
// --- [NEW] Render Compact Card ---
// --- [BUG FIX] Changed 'classclass' to 'class' ---
function renderCompactCard(request) {
    const typeText = request.type === 'leave' ? 'ច្បាប់ឈប់' : 'ចេញក្រៅ';
    const typeColor = request.type === 'leave' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
    const typeDarkColor = request.type === 'leave' ? 'dark:bg-blue-900 dark:text-blue-200' : 'dark:bg-green-900 dark:text-green-200';
    
    return `
    <div class="compact-card-btn card-bg border border-primary rounded-lg p-2 shadow-sm hover:shadow-md hover:border-blue-400 cursor-pointer transition-all duration-150" data-id="${request.id}" data-type="${request.type}">
        <div class="flex items-center gap-2">
            ${request.photo ? `<img src="${request.photo}" class="w-8 h-8 rounded-full object-cover flex-shrink-0" onerror="this.onerror=null; this.src='https://placehold.co/32x32/e2e8f0/64748b?text=?';">` : `<div class="w-8 h-8 rounded-full bg-secondary text-secondary flex items-center justify-center flex-shrink-0"><i class="fas fa-user"></i></div>`}
            <div class="overflow-hidden min-w-0">
                <p class="text-xs font-semibold truncate text-primary">${request.name || 'N/A'}</p>
                <p class="text-xs text-secondary truncate">(${request.userId || 'N/A'})</p>
            </div>
        </div>
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded ${typeColor} ${typeDarkColor} mt-1.5 inline-block">${typeText}</span>
        <p class="text-xs text-primary mt-1 truncate">${request.startDate || ''}</p>
    </div>
    `;
}

// --- Render Single Request Card (Full Detail) ---
function renderRequestCard(request) {
    if (!request || !request.id) return '';
    
    const deleteButton = `
        <button data-id="${request.id}" data-type="${request.type}" data-action="delete" class="action-btn text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-500 transition-colors duration-150 p-1 rounded-full">
            <i class="fas fa-trash-alt fa-fw"></i>
        </button>
    `;

    let actionButtons = '';
    switch (request.status) {
        case 'pending':
        case 'editing':
            actionButtons = `
                <div class="flex flex-col sm:flex-row gap-2 mt-4 pt-3 border-t border-primary">
                    <button data-id="${request.id}" data-type="${request.type}" data-action="approve" class="flex-1 action-btn bg-green-500 hover:bg-green-600 text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition duration-150 ease-in-out flex items-center justify-center gap-1.5">
                        <i class="fas fa-check fa-fw"></i> អនុម័ត
                    </button>
                    <button data-id="${request.id}" data-type="${request.type}" data-action="reject" class="flex-1 action-btn bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition duration-150 ease-in-out flex items-center justify-center gap-1.5">
                        <i class="fas fa-times fa-fw"></i> បដិសេធ
                    </button>
                </div>`;
            break;
    }

    // [NEW] Use helper function to get inner HTML
    const detailHtml = getRequestDetailHtml(request, deleteButton); 

    return `
        <div class="card-bg border border-primary rounded-lg shadow-md p-4 mb-4 break-inside-avoid hover:shadow-lg transition-shadow duration-200">
            ${detailHtml}
            ${actionButtons}
        </div>`;
}
 
// --- [NEW] Helper to generate detail HTML for Full Card and Modal ---
function getRequestDetailHtml(request, extraHeaderHtml = '') {
    if (!request || !request.id) return '';

    const typeText = request.type === 'leave' ? 'ច្បាប់ឈប់សម្រាក' : 'ច្បាប់ចេញក្រៅ';
    const typeColor = request.type === 'leave' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800';
    const typeDarkColor = request.type === 'leave' ? 'dark:bg-blue-900 dark:text-blue-200' : 'dark:bg-green-900 dark:text-green-200';
    
    const dateString = (request.startDate === request.endDate) ? request.startDate : `${request.startDate} ដល់ ${request.endDate}`;
    const requestedAtFormatted = formatFirestoreTimestamp(request.requestedAt, 'HH:mm dd/MM/yyyy');

    let statusBadge = '';
    let statusText = request.status || 'N/A';
    let statusBgColor = 'bg-gray-100';
    let statusTextColor = 'text-gray-800';
    let statusDarkColor = 'dark:bg-gray-700 dark:text-gray-200';

    switch (request.status) {
        case 'pending': statusText = 'រង់ចាំ'; statusBgColor = 'bg-yellow-100'; statusTextColor = 'text-yellow-800'; statusDarkColor = 'dark:bg-yellow-900 dark:text-yellow-200'; break;
        case 'editing': statusText = 'កំពុងកែ'; statusBgColor = 'bg-yellow-100'; statusTextColor = 'text-yellow-800'; statusDarkColor = 'dark:bg-yellow-900 dark:text-yellow-200'; break;
        case 'approved': statusText = 'បានយល់ព្រម'; statusBgColor = 'bg-green-100'; statusTextColor = 'text-green-800'; statusDarkColor = 'dark:bg-green-900 dark:text-green-200'; break;
        case 'rejected': statusText = 'បានបដិសេធ'; statusBgColor = 'bg-red-100'; statusTextColor = 'text-red-800'; statusDarkColor = 'dark:bg-red-900 dark:text-red-200'; break;
    }
    statusBadge = `<span class="text-xs font-bold px-2.5 py-1 rounded-full ${statusBgColor} ${statusTextColor} ${statusDarkColor}">${statusText}</span>`;

    let decisionInfo = '';
    if (request.status === 'approved' || request.status === 'rejected') {
        decisionInfo = `<div class="text-xs text-secondary mt-2"><i class="fas fa-user-shield fa-fw mr-1"></i> ${request.decisionBy || 'N/A'} | <i class="far fa-clock fa-fw mr-1"></i> ${formatFirestoreTimestamp(request.decisionAt)}</div>`;
    }

     let returnInfo = '';
       if (request.type === 'out' && request.returnStatus === 'បានចូលមកវិញ') {
           returnInfo = `<div class="text-xs text-green-700 dark:text-green-400 font-medium mt-1.5"><i class="fas fa-door-open fa-fw mr-1"></i> បានចូលវិញ: ${request.returnedAt || ''}</div>`;
       }

    return `
        <div class="flex justify-between items-center mb-3 pb-2 border-b border-primary">
            <span class="text-xs font-semibold px-2 py-0.5 rounded ${typeColor} ${typeDarkColor}">${typeText}</span>
            <div class="flex items-center gap-2">
                ${statusBadge}
                ${extraHeaderHtml}
            </div>
        </div>
        
        <div class="mb-3 flex items-center gap-3">
            <div class="flex-shrink-0">
                ${ request.photo
                    ? `<img src="${request.photo}" alt="${request.name || 'Photo'}" class="w-12 h-12 rounded-full object-cover border-2 border-primary shadow-sm" onerror="this.onerror=null; this.src='https://placehold.co/48x48/e2e8f0/64748b?text=?';">`
                    : `<div class="w-12 h-12 rounded-full bg-secondary text-secondary flex items-center justify-center"><i class="fas fa-user fa-lg"></i></div>`
                }
            </div>
            <div>
                <p class="font-semibold text-lg text-primary">${request.name || 'N/A'} <span class="text-sm font-normal text-secondary">(${request.userId || 'N/A'})</span></p>
                <p class="text-sm text-secondary">${request.department || 'N/A'}</p>
            </div>
        </div>

        <div class="text-sm space-y-1.5 mb-3">
            <div class="flex"><strong class="font-medium text-secondary w-20 inline-block shrink-0"><i class="far fa-calendar-alt fa-fw mr-1.5 text-blue-500"></i>កាលបរិច្ឆេទ:</strong> <span class="text-primary">${dateString}</span></div>
            <div class="flex"><strong class="font-medium text-secondary w-20 inline-block shrink-0"><i class="far fa-clock fa-fw mr-1.5 text-blue-500"></i>រយៈពេល:</strong> <span class="text-primary">${request.duration || 'N/A'}</span></div>
            <div class="flex"><strong class="font-medium text-secondary w-20 inline-block shrink-0 align-top"><i class="fas fa-info-circle fa-fw mr-1.5 text-blue-500"></i>មូលហេតុ:</strong> <span class="whitespace-pre-line inline-block text-primary">${request.reason || 'N/A'}</span></div>
             <div class="flex"><strong class="font-medium text-secondary w-20 inline-block shrink-0"><i class="far fa-paper-plane fa-fw mr-1.5 text-blue-500"></i>សុំនៅ:</strong> <span class="text-primary text-xs">${requestedAtFormatted}</span></div>
        </div>
        ${decisionInfo}
        ${returnInfo}
    `;
}

// --- [NEW] Show/Hide Request Detail Modal ---
function showRequestDetailModal(request) {
    if (!requestDetailModal || !detailModalContent) return;
    // Generate detail HTML (without delete button in the modal)
    detailModalContent.innerHTML = getRequestDetailHtml(request, '');
    requestDetailModal.classList.remove('hidden');
}
function hideRequestDetailModal() {
    if (requestDetailModal) requestDetailModal.classList.add('hidden');
    if (detailModalContent) detailModalContent.innerHTML = ''; // Clear content
}


// --- Prompt for Admin Action (Handles Approve/Reject/Delete) ---
function promptForAdminAction(button) { // Now accepts the button element
    if (!button) return;

    const requestId = button.dataset.id;
    const requestType = button.dataset.type;
    const action = button.dataset.action;

    if (!requestId || !requestType || !action || !confirmationModal || !confirmYesBtn || !confirmationTitle || !confirmationMessage) {
        console.error("Missing data attributes or modal references.");
        return;
    }

    // --- Store data on the 'Yes' button ---
    confirmYesBtn.dataset.id = requestId;
    confirmYesBtn.dataset.type = requestType;
    confirmYesBtn.dataset.action = action;

    // --- Customize modal for action ---
    if (action === 'approve') {
        confirmationTitle.textContent = "បញ្ជាក់ការអនុម័ត";
        confirmationMessage.textContent = `តើអ្នកប្រាកដជាចង់ "អនុម័ត" សំណើ (ID: ${requestId}) នេះមែនទេ?`;
        confirmYesBtn.className = "bg-green-600 text-white py-2 px-6 rounded-lg font-semibold shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2";
        confirmYesBtn.textContent = "បាទ/ចាស, អនុម័ត";
    } else if (action === 'reject') {
        confirmationTitle.textContent = "បញ្ជាក់ការបដិសេធ";
        confirmationMessage.textContent = `តើអ្នកប្រាកដជាចង់ "បដិសេធ" សំណើ (ID: ${requestId}) នេះមែនទេ?`;
        confirmYesBtn.className = "bg-red-600 text-white py-2 px-6 rounded-lg font-semibold shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2";
        confirmYesBtn.textContent = "បាទ/ចាស, បដិសេធ";
    } else if (action === 'delete') {
        confirmationTitle.textContent = "បញ្ជាក់ការលុប";
        confirmationMessage.textContent = `តើអ្នកប្រាកដជាចង់ "លុប" សំណើ (ID: ${requestId}) នេះមែនទេ?\n\nចំណាំ៖ ទិន្នន័យនេះនឹងបាត់បង់ជាអចិន្ត្រៃយ៍។`;
        confirmYesBtn.className = "bg-red-600 text-white py-2 px-6 rounded-lg font-semibold shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2";
        confirmYesBtn.textContent = "បាទ/ចាស, លុប";
    }
    
    // --- Show the modal ---
    confirmationModal.classList.remove('hidden');
}


// --- Execute Admin Action (Handles Approve/Reject/Delete) ---
async function executeAdminAction(requestId, requestType, action) {
    
    if (!requestId || !requestType || !action) { 
        console.error("executeAdminAction called with missing parameters."); 
        return; 
    }
    
    console.log(`Executing Action: ${action}, Type: ${requestType}, ID: ${requestId}`);

    const originalButton = document.querySelector(`.action-btn[data-id="${requestId}"][data-action="${action}"]`);
    if (originalButton) {
        originalButton.disabled = true;
        originalButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
        if (action !== 'delete') {
           originalButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> កំពុងដំណើរការ...`;
        }
    } else {
        console.warn(`Could not find button for ${requestId} to disable.`);
    }

    const collectionPath = requestType === 'leave' ? leaveRequestsCollectionPath : outRequestsCollectionPath;
    const docRef = doc(db, collectionPath, requestId);

    try {
        if (action === 'approve' || action === 'reject') {
            const updateData = { 
                status: action === 'approve' ? 'approved' : 'rejected', 
                decisionAt: serverTimestamp(), 
                decisionBy: ADMIN_NAME 
            };
            await updateDoc(docRef, updateData);
            console.log(`Request ${requestId} successfully ${action}d.`);
            showCustomAlert("ជោគជ័យ!", `សំណើ (${requestId}) ត្រូវបាន ${action === 'approve' ? 'អនុម័ត' : 'បដិសេធ'} ដោយជោគជ័យ។`, "success");
        
        } else if (action === 'delete') {
            await deleteDoc(docRef);
            console.log(`Request ${requestId} successfully deleted.`);
            showCustomAlert("បានលុប!", `សំណើ (${requestId}) ត្រូវបានលុបចេញពីមូលដ្ឋានទិន្នន័យ។`, "success");
        }
    
    } catch (error) {
        console.error(`Error ${action}ing request ${requestId}:`, error);
        showCustomAlert("Error", `មានបញ្ហា ${action} សំណើ: ${error.message}`);
        
        if (originalButton) {
            originalButton.disabled = false; 
            if (action === 'approve') originalButton.innerHTML = `<i class="fas fa-check fa-fw"></i> អនុម័ត`;
            else if (action === 'reject') originalButton.innerHTML = `<i class="fas fa-times fa-fw"></i> បដិសេធ`;
            else if (action === 'delete') originalButton.innerHTML = `<i class="fas fa-trash-alt fa-fw"></i>`;
        }
    }
}

// --- Custom Alert Modal Logic ---
function showCustomAlert(title, message, type = 'warning') { 
    if (!customAlertModal || !customAlertTitle || !customAlertMessage || !customAlertIconSuccess || !customAlertIconWarning) {
         console.error("Custom alert elements not found.");
         return; 
    }
    customAlertTitle.textContent = title; 
    customAlertMessage.textContent = message; 
    if (type === 'success') { 
        customAlertIconSuccess.classList.remove('hidden'); 
        customAlertIconWarning.classList.add('hidden'); 
    } else { 
        customAlertIconSuccess.classList.add('hidden'); 
        customAlertIconWarning.classList.remove('hidden'); 
    } 
    customAlertModal.classList.remove('hidden'); 
}
function hideCustomAlert() { 
    if (customAlertModal) customAlertModal.classList.add('hidden'); 
}
