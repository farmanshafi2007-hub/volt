// VOLT - Pure Static JavaScript v1.2
// Using Firebase CDN Modules

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signOut, updateProfile, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
let db, auth;
const googleProvider = new GoogleAuthProvider();
try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app, "ai-studio-c7f24d3c-f8c2-4954-a163-6bc91b462494");
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
const googleLoginBtn = document.getElementById('google-login-button');
const userNameInput = document.getElementById('user-name-input');
const initialRoomCodeInput = document.getElementById('initial-room-code');
const logoutBtn = document.getElementById('logout-button');
const userAvatar = document.getElementById('user-avatar');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const chatForm = document.getElementById('chat-form');
const currentRoomName = document.getElementById('current-room-name');

const joinRoomInput = document.getElementById('join-room-input');
const btnQuickJoin = document.getElementById('btn-quick-join');

const createModal = document.getElementById('create-modal');
const showCreateBtn = document.getElementById('show-create-room');
const closeCreateBtn = document.getElementById('btn-close-create');
const createBtn = document.getElementById('btn-create-room');
const createRoomNameInput = document.getElementById('create-room-name');
const createRoomDescInput = document.getElementById('create-room-desc');
const createRoomPublicInput = document.getElementById('create-room-public');

const roomsList = document.getElementById('rooms-container');
const peopleContainer = document.getElementById('people-container');
const usersList = document.getElementById('users-list');
const tabRooms = document.getElementById('tab-rooms');
const tabPeople = document.getElementById('tab-people');

const btnBack = document.getElementById('btn-back');
const btnCopyRoom = document.getElementById('btn-copy-room');
const roomIDDisplay = document.getElementById('current-room-id-display');
const sidebar = document.getElementById('sidebar');

const setupModal = document.getElementById('setup-modal');
const setupLink = document.getElementById('setup-link');
const projectId = firebaseConfig.projectId;

// --- TOAST SYSTEM ---
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <ion-icon name="${type === 'success' ? 'flash' : 'alert-circle'}"></ion-icon>
        <span>${message}</span>
    `;
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
  showToast(`Access Error: ${operationType} failed on ${path || 'unknown'}.`);
  // MANDATORY: Throw JSON error for system diagnostics
  throw new Error(JSON.stringify(errInfo));
}

// --- UTILS ---
function copyToClipboard(text, isLink = false) {
    const content = isLink ? `${window.location.origin}${window.location.pathname}?room=${text}` : text;
    navigator.clipboard.writeText(content).then(() => {
        showToast(isLink ? "Invite link copied!" : "Code copied!", "success");
    }).catch(() => {
        // Fallback for some environments
        const textArea = document.createElement("textarea");
        textArea.value = content;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast("Copied to clipboard", "success");
        } catch (err) {
            showToast("Failed to copy.");
        }
        document.body.removeChild(textArea);
    });
}

// --- STATE ---
let currentUser = null;
let currentRoomId = 'general'; // Default 
let unsubscribeMessages = null;
let unsubscribeRooms = null;
let unsubscribeUsers = null;

// --- TAB LOGIC ---
if (tabRooms && tabPeople) {
    tabRooms.onclick = () => {
        roomsList.classList.remove('hidden');
        peopleContainer.classList.add('hidden');
        tabRooms.classList.add('active-tab');
        tabRooms.classList.remove('text-slate-500');
        tabPeople.classList.add('text-slate-500');
        tabPeople.classList.remove('active-tab');
    };
    tabPeople.onclick = () => {
        roomsList.classList.add('hidden');
        peopleContainer.classList.remove('hidden');
        tabPeople.classList.add('active-tab');
        tabPeople.classList.remove('text-slate-500');
        tabRooms.classList.add('text-slate-500');
        tabRooms.classList.remove('active-tab');
        loadUsers();
    };
}

// --- AUTH LOGIC ---
async function joinRoom(roomCode, user = currentUser) {
    if (!roomCode || !user) return;
    try {
        const roomRef = doc(db, 'conversations', roomCode);
        const roomSnap = await getDoc(roomRef);
        
        let roomName = roomCode;
        if (!roomSnap.exists()) {
            roomName = roomCode === 'general' ? "HQ Terminal" : roomCode.charAt(0).toUpperCase() + roomCode.slice(1);
            await setDoc(roomRef, {
                name: roomName,
                participants: [user.uid],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                isPublic: roomCode === 'general'
            });
        } else {
            const data = roomSnap.data();
            roomName = data.name || roomCode;
            const participants = data.participants || [];
            if (!participants.includes(user.uid)) {
                await setDoc(roomRef, {
                    participants: [...participants, user.uid],
                    updatedAt: serverTimestamp()
                }, { merge: true });
            }
        }

        switchRoom(roomCode, roomName);
        return true;
    } catch (err) {
        console.error("Join room error:", err);
        showToast("Access Denied: " + roomCode);
        return false;
    }
}

async function joinInitialRoom(user) {
    const params = new URLSearchParams(window.location.search);
    const roomCodeFromUrl = params.get('room');
    const roomCodeFromInput = initialRoomCodeInput.value.trim();
    const targetRoom = roomCodeFromUrl || roomCodeFromInput || 'general';
    
    await joinRoom(targetRoom, user);
}

if (btnQuickJoin) {
    btnQuickJoin.onclick = async () => {
        const code = joinRoomInput.value.trim();
        if (!code) return;
        btnQuickJoin.disabled = true;
        const success = await joinRoom(code);
        if (success) joinRoomInput.value = '';
        btnQuickJoin.disabled = false;
    };
}

if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', async () => {
        googleLoginBtn.disabled = true;
        googleLoginBtn.innerHTML = '<div class="spinner w-5 h-5 border-2 border-slate-400 border-t-black"></div>';
        try {
            const result = await signInWithPopup(auth, googleProvider);
            showToast("Welcome, " + result.user.displayName, "success");
            await joinInitialRoom(result.user);
        } catch (err) {
            console.error("Google login error:", err);
            showToast(err.code + ": " + err.message);
        } finally {
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = `
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-5 h-5" alt="Google">
                SIGN IN WITH GOOGLE
            `;
        }
    });
}

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const displayName = userNameInput.value.trim();
        
        if(!displayName) return showToast("Please enter a name");

        console.log("Attempting Direct Access...");
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="spinner w-5 h-5 border-2 border-slate-400 border-t-white"></div>';
        
        try {
            const result = await signInAnonymously(auth);
            await updateProfile(result.user, {
                displayName: displayName,
                photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${result.user.uid}`
            });
            
            showToast("Welcome, " + displayName, "success");
            await joinInitialRoom(result.user);

            // Clean up inputs
            userNameInput.value = '';
            initialRoomCodeInput.value = '';
        } catch (err) {
            console.error("Login error:", err);
            loginBtn.disabled = false;
            loginBtn.innerHTML = 'ANONYMOUS JOIN';
            
            if (err.code === 'auth/admin-restricted-operation') {
                showToast("CRITICAL: Setup Required", "error");
                if (setupModal && setupLink) {
                    setupLink.href = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
                    setupModal.classList.remove('hidden');
                }
            } else {
                showToast(err.code + ": " + err.message);
            }
        }
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
            if (loadingScreen.parentNode) loadingScreen.classList.add('hidden');
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
                    name: "HQ Terminal",
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
        // Only auto-switch to general if no room is selected or we're still on default
        if (currentRoomId === 'general') {
            switchRoom('general', 'HQ Terminal');
        }
    } else {
        if (unsubscribeMessages) unsubscribeMessages();
        if (unsubscribeRooms) unsubscribeRooms();
        currentUser = null;
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        
        // Reset button state
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'ENTER ROOM';
    }
});

// --- UI HELPERS ---
function switchRoom(id, name) {
    currentRoomId = id;
    currentRoomName.innerText = name;
    
    // Update Header ID display
    if (roomIDDisplay) roomIDDisplay.innerText = `# ${id}`;
    if (btnCopyRoom) {
        btnCopyRoom.classList.remove('hidden');
        btnCopyRoom.onclick = () => copyToClipboard(id, true);
    }
    
    // UI mobile toggle
    if (window.innerWidth < 768) {
        sidebar.classList.add('closed');
    }

    // Load messages
    if (unsubscribeMessages) unsubscribeMessages();
    
    const messagesPath = `conversations/${id}/messages`;
    const messagesQuery = query(
        collection(db, 'conversations', id, 'messages'),
        orderBy('createdAt', 'asc')
    );

    unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        messagesContainer.innerHTML = '';
        
        if (snapshot.empty) {
            messagesContainer.innerHTML = `
                <div class="flex-1 flex flex-col justify-center items-center text-center py-20 opacity-40">
                    <ion-icon name="share-social-outline" class="text-5xl mb-4 text-indigo-500"></ion-icon>
                    <p class="text-xs font-black uppercase tracking-[0.2em] text-white">No Transmissions Detected</p>
                    <p class="text-[9px] font-bold text-slate-500 mt-2 italic uppercase tracking-tighter">Share frequency code [ <span class="text-indigo-400 select-all">${id}</span> ] to initiate link</p>
                    <button onclick="document.getElementById('btn-copy-room').click()" class="mt-4 px-4 py-2 border border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-white/5 transition-all italic">Copy Invite Link</button>
                </div>
            `;
            return;
        }

        const spacer = document.createElement('div');
        spacer.className = 'flex-1';
        messagesContainer.appendChild(spacer);
        
        snapshot.forEach(doc => {
            const msg = doc.data();
            renderMessage(msg);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, (error) => {
        if (currentUser) handleFirestoreError(error, OperationType.GET, messagesPath);
    });
}

function renderMessage(msg) {
    const uid = currentUser?.uid;
    const isMe = msg.userId === uid;
    const div = document.createElement('div');
    div.className = `flex ${isMe ? 'justify-end' : 'justify-start'} w-full`;
    
    const time = msg.createdAt ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    div.innerHTML = `
        <div class="message-bubble ${isMe ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none' : 'glass text-slate-100 rounded-2xl rounded-tl-none'} p-4 shadow-xl">
            ${!isMe ? `<p class="text-[10px] font-black text-indigo-400 mb-1 uppercase tracking-widest italic">${msg.displayName || 'Agent'}</p>` : ''}
            <p class="text-sm font-medium leading-relaxed font-mono tracking-tight">${msg.text}</p>
            <p class="text-[9px] mt-2 opacity-40 font-black text-right">${time}</p>
        </div>
    `;
    messagesContainer.appendChild(div);
}

async function startDM(otherUser) {
    if (!currentUser || !otherUser) return;
    
    // Sort UIDs to ensure consistent DM ID
    const uids = [currentUser.uid, otherUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    try {
        const roomRef = doc(db, 'conversations', dmId);
        const roomSnap = await getDoc(roomRef);
        
        if (!roomSnap.exists()) {
            await setDoc(roomRef, {
                type: 'dm',
                participants: uids,
                participantInfo: {
                    [currentUser.uid]: { displayName: currentUser.displayName || 'User' },
                    [otherUser.uid]: { displayName: otherUser.displayName || 'User' }
                },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }
        
        switchRoom(dmId, otherUser.displayName || 'Private Chat');
        if (tabRooms) tabRooms.click(); // Switch back to see it in list
    } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `conversations/${dmId}`);
    }
}

async function loadUsers() {
    if (unsubscribeUsers) unsubscribeUsers();
    const usersPath = 'users';
    // Load last 20 active users
    const q = query(collection(db, usersPath), orderBy('lastSeen', 'desc'), where('uid', '!=', currentUser.uid));
    
    unsubscribeUsers = onSnapshot(q, (snapshot) => {
        usersList.innerHTML = '';
        if (snapshot.empty) {
            usersList.innerHTML = '<p class="text-center text-slate-600 text-[10px] py-4">No other users found yet.</p>';
            return;
        }
        
        snapshot.forEach(doc => {
            const user = doc.data();
            const div = document.createElement('div');
            div.className = 'flex items-center gap-3 p-3 rounded-2xl hover:bg-white/5 cursor-pointer transition-all border border-transparent hover:border-white/5 group';
            div.innerHTML = `
                <img src="${user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`}" class="w-8 h-8 rounded-lg bg-black/40" alt="${user.displayName}">
                <div class="flex-1 overflow-hidden">
                    <h4 class="text-sm font-bold text-white truncate">${user.displayName || 'Anonymous User'}</h4>
                    <p class="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Available</p>
                </div>
                <div class="p-2 bg-indigo-600/10 text-indigo-400 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-all">
                    <ion-icon name="chatbubble-ellipses-outline"></ion-icon>
                </div>
            `;
            div.onclick = () => startDM(user);
            usersList.appendChild(div);
        });
    }, (error) => {
        if (currentUser) handleFirestoreError(error, OperationType.LIST, usersPath);
    });
}

// --- ROOM LOGIC ---
async function loadRooms() {
    if (unsubscribeRooms) unsubscribeRooms();
    const roomsPath = 'conversations';
    const q = query(collection(db, roomsPath), where('participants', 'array-contains', currentUser.uid));
    unsubscribeRooms = onSnapshot(q, (snapshot) => {
        roomsList.innerHTML = '';
        
        // General Room
        const generalActive = currentRoomId === 'general';
        const generalDiv = document.createElement('div');
        generalDiv.className = `p-4 rounded-2xl ${generalActive ? 'bg-indigo-600 text-white' : 'glass hover:bg-white/5'} cursor-pointer transition-all border ${generalActive ? 'border-indigo-500' : 'border-transparent'}`;
        generalDiv.innerHTML = `
            <div class="flex justify-between items-start">
                <h3 class="font-black text-xs uppercase italic tracking-tight">HQ TERMINAL</h3>
                <span class="text-[9px] font-black uppercase opacity-70">CORE</span>
            </div>
            <p class="text-[9px] mt-1 opacity-60 font-bold uppercase tracking-widest">Public Frequency</p>
        `;
        generalDiv.onclick = () => switchRoom('general', 'HQ Terminal');
        roomsList.appendChild(generalDiv);

        snapshot.forEach(doc => {
            if (doc.id === 'general') return;
            const room = doc.data();
            const isDM = room.type === 'dm';
            const isActive = currentRoomId === doc.id;
            
            let displayName = room.name || 'SecNode';
            if (isDM && room.participantInfo) {
                const otherUid = room.participants.find(uid => uid !== currentUser.uid);
                if (otherUid && room.participantInfo[otherUid]) {
                    displayName = room.participantInfo[otherUid].displayName;
                }
            }
            
            const div = document.createElement('div');
            div.className = `p-4 rounded-2xl ${isActive ? 'bg-white text-black' : 'glass hover:bg-white/10'} cursor-pointer transition-all border ${isActive ? 'border-indigo-500' : 'border-transparent'}`;
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <h3 class="font-black text-xs uppercase italic tracking-tight truncate pr-2">${displayName}</h3>
                    <span class="text-[9px] font-black uppercase ${isActive ? 'text-indigo-600' : (isDM ? 'text-indigo-400' : 'text-emerald-500')}">${isDM ? 'DM' : 'CHANNEL'}</span>
                </div>
                <p class="text-[9px] mt-1 opacity-60 font-bold uppercase tracking-widest truncate">${room.lastMessage || (isDM ? 'Establish Link' : 'No Data')}</p>
            `;
            div.onclick = () => switchRoom(doc.id, displayName);
            roomsList.appendChild(div);
        });
    }, (error) => {
        if (currentUser) handleFirestoreError(error, OperationType.LIST, roomsPath);
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
        const isPublic = createRoomPublicInput.checked;
        const roomRef = await addDoc(collection(db, 'conversations'), {
            name: name,
            description: desc,
            participants: [currentUser.uid],
            creatorId: currentUser.uid,
            isPublic: isPublic,
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
if (showCreateBtn) showCreateBtn.onclick = () => createModal.classList.remove('hidden');
if (closeCreateBtn) closeCreateBtn.onclick = () => createModal.classList.add('hidden');

if (btnBack) {
    btnBack.onclick = () => {
        sidebar.classList.toggle('closed');
    };
}

// handle URL parameters for room joining
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
        // If we have a room part in URL, we wait for auth then join
        window.addEventListener('load', () => {
             if (initialRoomCodeInput) {
                initialRoomCodeInput.value = roomParam;
                showToast("Room code detected from link!", "success");
             }
        });
    }
});

// Auto-focus input on switch
currentRoomName.onclick = () => {
    if(window.innerWidth < 768) sidebar.classList.remove('closed');
};
