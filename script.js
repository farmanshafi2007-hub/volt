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
const closeJoinBtn = document.getElementById('btn-close-join');

const createModal = document.getElementById('create-modal');
const showCreateBtn = document.getElementById('btn-show-create');
const closeCreateBtn = document.getElementById('btn-close-create');
const createBtn = document.getElementById('btn-create-room');
const createRoomNameInput = document.getElementById('create-room-name');
const createRoomDescInput = document.getElementById('create-room-desc');

const roomsList = document.getElementById('rooms-container');
const btnBack = document.getElementById('btn-back');
const sidebar = document.getElementById('sidebar');

// --- TOAST SYSTEM ---
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    if (type === 'success') toast.style.borderLeft = '4px solid #10b981';
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- ERROR HANDLING ---
const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  showToast(`Firestore ${operationType} failed on ${path || 'unknown'}. See console for details.`);
  // We don't necessarily want to re-throw if we want the app to stay alive, 
  // but the guidelines say throw a new error with JSON message.
  // throw new Error(JSON.stringify(errInfo));
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
                } else if (err.code === 'auth/unauthorized-domain') {
                    showToast("Domain missing from Firebase. Open console and add: " + window.location.hostname);
                    console.error("FIREBASE ERROR: 'auth/unauthorized-domain'. \n1. Go to Firebase Console > Authentication > Settings > Authorized Domains. \n2. Add this domain: " + window.location.hostname);
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
        const userPath = `users/${user.uid}`;
        setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            lastSeen: serverTimestamp()
        }, { merge: true }).catch(e => handleFirestoreError(e, OperationType.UPDATE, userPath));

        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        
        // Ensure General Room exists
        const generalRoomRef = doc(db, 'conversations', 'general');
        getDoc(generalRoomRef).then(snap => {
            if (!snap.exists()) {
                setDoc(generalRoomRef, {
                    name: "General Room",
                    participants: [user.uid],
                    createdAt: serverTimestamp(),
                    isPublic: true
                }).catch(e => console.warn("General room init error:", e));
            } else {
                // Join if not already in participants
                const data = snap.data();
                if (!data.participants || !data.participants.includes(user.uid)) {
                    setDoc(generalRoomRef, {
                        participants: [...(data.participants || []), user.uid]
                    }, { merge: true }).catch(e => console.warn("General room join error:", e));
                }
            }
        });

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
    
    const messagesPath = `conversations/${id}/messages`;
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
    }, (error) => {
        handleFirestoreError(error, OperationType.GET, messagesPath);
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
    const roomsPath = 'conversations';
    const q = query(collection(db, roomsPath), where('participants', 'array-contains', currentUser.uid));
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
                    <h3 class="font-bold text-white text-sm truncate pr-2">${room.name || 'Private Room'}</h3>
                    <span class="text-[10px] text-emerald-400 font-bold uppercase shrink-0">Chat</span>
                </div>
                ${room.description ? `<p class="text-[10px] text-slate-400 mt-1 line-clamp-1">${room.description}</p>` : ''}
                <p class="text-[10px] text-slate-600 mt-1 uppercase tracking-tighter">${doc.id.substring(0, 8)}...</p>
            `;
            div.onclick = () => switchRoom(doc.id, room.name || 'Private Room');
            roomsList.appendChild(div);
        });
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, roomsPath);
    });
}

// --- EVENT HANDLERS ---
chatForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;

    messageInput.value = '';
    
    try {
        const msgPath = `conversations/${currentRoomId}/messages`;
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
        handleFirestoreError(err, OperationType.WRITE, `conversations/${currentRoomId}`);
    }
};

joinBtn.onclick = async () => {
    const code = roomCodeInput.value.trim();
    if (!code) return showToast("Enter a room code");

    try {
        const roomRef = doc(db, 'conversations', code);
        const roomSnap = await getDoc(roomRef);

        if (!roomSnap.exists()) {
            return showToast("Room does not exist. Use 'Create' if you want a new one.");
        } 
        
        // Join existing
        const participants = roomSnap.data().participants || [];
        if (!participants.includes(currentUser.uid)) {
            await setDoc(roomRef, {
                participants: [...participants, currentUser.uid],
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
        
        showToast("Joined successfully", "success");
        switchRoom(code, roomSnap.data().name || "Private Room");
        joinModal.classList.add('hidden');
        roomCodeInput.value = '';
    } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `conversations/${code}`);
    }
};

createBtn.onclick = async () => {
    const name = createRoomNameInput.value.trim();
    const desc = createRoomDescInput.value.trim();
    if (!name) return showToast("Room name is required");

    createBtn.disabled = true;
    createBtn.innerText = "Creating...";

    try {
        const roomRef = await addDoc(collection(db, 'conversations'), {
            name: name,
            description: desc,
            participants: [currentUser.uid],
            creatorId: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        
        showToast("Room created!", "success");
        switchRoom(roomRef.id, name);
        createModal.classList.add('hidden');
        createRoomNameInput.value = '';
        createRoomDescInput.value = '';
    } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'conversations');
    } finally {
        createBtn.disabled = false;
        createBtn.innerText = "Create";
    }
};

// Modal controls
showJoinBtn.onclick = () => joinModal.classList.remove('hidden');
closeJoinBtn.onclick = () => joinModal.classList.add('hidden');

showCreateBtn.onclick = () => createModal.classList.remove('hidden');
closeCreateBtn.onclick = () => createModal.classList.add('hidden');

btnBack.onclick = () => sidebar.classList.remove('-translate-x-full');

// Auto-focus input on switch
currentRoomName.onclick = () => {
    if(window.innerWidth < 768) sidebar.classList.remove('-translate-x-full');
};
