// VOLT - Pure Static JavaScript v1.2
// Using Firebase CDN Modules

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, where, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- GLOBAL ERROR LOGGING ---
window.onerror = function(msg, url, line, col, error) {
    console.error("Global Error:", msg, "at", url, line);
    showToast("System Error: " + msg);
    return false;
};

window.onunhandledrejection = function(event) {
    console.error("Unhandled Promise Rejection:", event.reason);
    showToast("Promise Error: " + (event.reason ? event.reason.message : "Unknown"));
};

// --- CONFIGURATION ---
const firebaseConfig = {
    projectId: "direct-bivouac-s07pf",
    appId: "1:1004274449142:web:a1c433d1c869532d254ad7",
    apiKey: "AIzaSyCUD3Lk0IQd0VSxHloJaHjkLBjQVJmSY80",
    authDomain: "direct-bivouac-s07pf.firebaseapp.com",
    storageBucket: "direct-bivouac-s07pf.firebasestorage.app",
    messagingSenderId: "1004274449142",
};

// --- INITIALIZATION ---
let db, auth, provider;
try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, "ai-studio-c7f24d3c-f8c2-4954-a163-6bc91b462494");
    provider = new GoogleAuthProvider();
} catch (err) {
    console.error("Firebase init error:", err);
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.pointerEvents = 'none';
        setTimeout(() => loadingScreen.classList.add('hidden'), 500);
    }
    setTimeout(() => showToast("Init Error: " + err.message), 1000);
}

// --- DOM ELEMENTS ---
const loadingScreen = document.getElementById('loading-screen');
const toastContainer = document.getElementById('toast-container');
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginBtn = document.getElementById('login-button');
const logoutBtn = document.getElementById('logout-button');
const userAvatar = document.getElementById('user-avatar');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const chatForm = document.getElementById('chat-form');
const currentRoomName = document.getElementById('current-room-name');
const roomCodeInput = document.getElementById('room-code-input');
const joinBtn = document.getElementById('btn-join-room');
const showJoinBtn = document.getElementById('btn-show-join');
const joinModal = document.getElementById('join-modal');
const closeModalBtn = document.getElementById('btn-close-modal');
const roomsList = document.getElementById('rooms-container');
const btnBack = document.getElementById('btn-back');
const sidebar = document.getElementById('sidebar');

// --- TOAST SYSTEM ---
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- STATE ---
let currentUser = null;
let currentRoomId = 'general'; // Default 
let unsubscribeMessages = null;

// --- AUTH LOGIC ---
if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        console.log("Attempting Google Login...");
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="spinner w-5 h-5 border-2 border-slate-400 border-t-black"></div>';
        
        signInWithPopup(auth, provider)
            .then((result) => {
                console.log("Login success:", result.user.email);
                showToast("Welcome, " + result.user.displayName, "success");
            })
            .catch(err => {
                console.error("Login error:", err);
                loginBtn.disabled = false;
                loginBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pwa/google.svg" alt="Google" class="w-5 h-5"> Sign in with Google';
                
                if (err.code === 'auth/popup-blocked') {
                    showToast("Please allow popups for this site.");
                } else {
                    showToast(err.code + ": " + err.message);
                }
            });
    });
}

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        showToast("Logged out successfully", "success");
    }).catch(err => showToast(err.message));
});

onAuthStateChanged(auth, async (user) => {
    // Reveal app and hide loading
    if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        loadingScreen.style.pointerEvents = 'none';
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            document.body.style.overflow = 'auto'; // Re-enable scroll
        }, 500);
    }

    if (user) {
        currentUser = user;
        userAvatar.src = user.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.uid;
        
        // Non-blocking profile sync
        setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            lastSeen: serverTimestamp()
        }, { merge: true }).catch(e => console.warn("Profile sync delay:", e));

        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        
        loadRooms();
        switchRoom('general', 'General Room');
    } else {
        currentUser = null;
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        
        // Reset button state
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pwa/google.svg" alt="Google" class="w-5 h-5"> Sign in with Google';
    }
});

// --- UI HELPERS ---
function switchRoom(id, name) {
    currentRoomId = id;
    currentRoomName.innerText = name;
    
    // UI mobile toggle
    if (window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
    }

    // Load messages
    if (unsubscribeMessages) unsubscribeMessages();
    
    const messagesQuery = query(
        collection(db, 'conversations', id, 'messages'),
        orderBy('createdAt', 'asc')
    );

    unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        messagesContainer.innerHTML = '<div class="flex-1"></div>';
        snapshot.forEach(doc => {
            const msg = doc.data();
            renderMessage(msg);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

function renderMessage(msg) {
    const isMe = msg.userId === currentUser.uid;
    const div = document.createElement('div');
    div.className = `msg-container ${isMe ? 'msg-me' : 'msg-other'} animate-fade-in mb-2`;
    
    div.innerHTML = `
        <div class="bubble ${isMe ? 'bubble-me' : 'bubble-other'}">
            ${!isMe ? `<p class="text-[10px] font-bold text-indigo-400 mb-1">${msg.displayName || 'User'}</p>` : ''}
            <p>${msg.text}</p>
        </div>
    `;
    messagesContainer.appendChild(div);
}

// --- ROOM LOGIC ---
async function loadRooms() {
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', currentUser.uid));
    onSnapshot(q, (snapshot) => {
        roomsList.innerHTML = '';
        
        // Static General Room Always Visible
        const generalDiv = document.createElement('div');
        generalDiv.className = `p-4 rounded-2xl glass hover:bg-white/5 cursor-pointer transition-all border ${currentRoomId === 'general' ? 'border-indigo-500/50' : 'border-transparent'}`;
        generalDiv.innerHTML = `<h3 class="font-bold text-white text-sm">General Room</h3><p class="text-[10px] text-indigo-400 uppercase">System</p>`;
        generalDiv.onclick = () => switchRoom('general', 'General Room');
        roomsList.appendChild(generalDiv);

        snapshot.forEach(doc => {
            if (doc.id === 'general') return;
            const room = doc.data();
            const div = document.createElement('div');
            div.className = `p-4 rounded-2xl glass hover:bg-white/5 cursor-pointer transition-all border ${currentRoomId === doc.id ? 'border-indigo-500/50' : 'border-transparent'}`;
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-bold text-white text-sm">${room.name || 'Private Room'}</h3>
                    <span class="text-[10px] text-emerald-400 font-bold uppercase">Chat</span>
                </div>
                <p class="text-[10px] text-slate-500 mt-1">${doc.id}</p>
            `;
            div.onclick = () => switchRoom(doc.id, room.name || 'Private Room');
            roomsList.appendChild(div);
        });
    });
}

// --- EVENT HANDLERS ---
chatForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;

    messageInput.value = '';
    
    try {
        await addDoc(collection(db, 'conversations', currentRoomId, 'messages'), {
            text: text,
            userId: currentUser.uid,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
        });

        // Update metadata for room
        await setDoc(doc(db, 'conversations', currentRoomId), {
            lastMessage: text,
            updatedAt: serverTimestamp()
        }, { merge: true });

    } catch (err) {
        console.error(err);
        showToast("Permission denied or error sending message.");
    }
};

joinBtn.onclick = async () => {
    const code = roomCodeInput.value.trim();
    if (!code) return;

    try {
        const roomRef = doc(db, 'conversations', code);
        const roomSnap = await getDoc(roomRef);

        if (!roomSnap.exists()) {
            // Create if doesn't exist
            await setDoc(roomRef, {
                name: "Private Room",
                participants: [currentUser.uid],
                createdAt: serverTimestamp()
            });
        } else {
            // Join existing
            const participants = roomSnap.data().participants || [];
            if (!participants.includes(currentUser.uid)) {
                await setDoc(roomRef, {
                    participants: [...participants, currentUser.uid]
                }, { merge: true });
            }
        }
        
        switchRoom(code, "Private Room");
        joinModal.classList.add('hidden');
        roomCodeInput.value = '';
    } catch (err) {
        showToast("Failed to join: " + err.message);
    }
};

// Modal controls
showJoinBtn.onclick = () => joinModal.classList.remove('hidden');
closeModalBtn.onclick = () => joinModal.classList.add('hidden');
btnBack.onclick = () => sidebar.classList.remove('-translate-x-full');

// Auto-focus input on switch
currentRoomName.onclick = () => {
    if(window.innerWidth < 768) sidebar.classList.remove('-translate-x-full');
};
