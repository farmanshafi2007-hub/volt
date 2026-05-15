/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import * as React from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  setDoc, 
  doc, 
  serverTimestamp,
  orderBy,
  addDoc,
  getDocs,
  limit,
  Timestamp,
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { handleFirestoreError, cn, OperationType } from './lib/utils';
import { UserProfile, Conversation, Message } from './types';
import { 
  MessageSquare, 
  Search, 
  Plus, 
  Settings, 
  LogOut, 
  Send, 
  MoreVertical,
  ChevronLeft,
  User as UserIcon,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { GoogleGenAI } from '@google/genai';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchEmail, setSearchEmail] = useState('');
  const [searchRoomCode, setSearchRoomCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Auth & Profile Listener
  useEffect(() => {
    // Safety timeout for loading
    const loadTimeout = setTimeout(() => {
      if (loading) setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      clearTimeout(loadTimeout);
      try {
        if (u) {
          const userDocRef = doc(db, 'users', u.uid);
          
          const generateRoomCode = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) {
              code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return code;
          };

          // Try to get existing profile first
          const userDocSnap = await getDoc(userDocRef);
          let currentRoomCode = generateRoomCode();
          
          if (userDocSnap.exists()) {
            const existingData = userDocSnap.data() as UserProfile;
            if (existingData.roomCode) {
              currentRoomCode = existingData.roomCode;
            }
          }

          const p: Partial<UserProfile> = {
            uid: u.uid,
            displayName: u.displayName || 'Anonymous',
            photoURL: u.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.uid}`,
            email: u.email || '',
            roomCode: currentRoomCode,
            status: 'online',
            lastSeen: serverTimestamp() as any
          };
          
          await setDoc(userDocRef, p, { merge: true });
          setUser(u);

          const unsubProfile = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              setProfile(docSnap.data() as UserProfile);
            }
          }, (e) => {
            console.warn('Profile snapshot error:', e);
          });
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (e) {
        console.error('Auth sync error:', e);
        // Fallback: set user anyway so app is usable
        if (u) setUser(u);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Conversations Listener
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'conversations'),
      where('participants', 'array-contains', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Conversation));
      setConversations(convos);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'conversations'));

    return () => unsubscribe();
  }, [user]);

  // Messages Listener
  useEffect(() => {
    if (!selectedConvo) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, `conversations/${selectedConvo.id}/messages`),
      orderBy('timestamp', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Message));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (e) => handleFirestoreError(e, OperationType.LIST, `conversations/${selectedConvo.id}/messages`));

    return () => unsubscribe();
  }, [selectedConvo]);

  // Typing Indicators Listener
  useEffect(() => {
    if (!selectedConvo || !user) return;

    const q = collection(db, `conversations/${selectedConvo.id}/typing`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const typing: Record<string, boolean> = {};
      snapshot.docs.forEach(doc => {
        if (doc.id !== user.uid) {
          const data = doc.data();
          // Only show as typing if updated in the last 10 seconds
          const updatedAt = data.updatedAt as Timestamp | null;
          if (data.isTyping && updatedAt && (Date.now() - updatedAt.toMillis() < 10000)) {
            typing[doc.id] = true;
          }
        }
      });
      setTypingUsers(typing);
    }, (e) => {
      console.warn('Typing indicator error:', e);
      // Non-blocking
    });

    return () => unsubscribe();
  }, [selectedConvo, user]);

  // Handle Current User Typing State
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!selectedConvo || !user || !inputText.trim()) {
      if (user && selectedConvo) {
        setDoc(doc(db, `conversations/${selectedConvo.id}/typing`, user.uid), {
          isTyping: false,
          updatedAt: serverTimestamp(),
          participants: selectedConvo.participants
        }, { merge: true }).catch(console.error);
      }
      return;
    }

    // Set typing to true
    setDoc(doc(db, `conversations/${selectedConvo.id}/typing`, user.uid), {
      isTyping: true,
      updatedAt: serverTimestamp(),
      participants: selectedConvo.participants
    }, { merge: true }).catch(console.error);

    // Clear existing timeout
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    // Set timeout to stop typing
    typingTimeoutRef.current = setTimeout(() => {
      setDoc(doc(db, `conversations/${selectedConvo.id}/typing`, user.uid), {
        isTyping: false,
        updatedAt: serverTimestamp(),
        participants: selectedConvo.participants
      }, { merge: true }).catch(console.error);
    }, 3000);

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [inputText, selectedConvo, user]);

  // AI Setup
  const aiRef = useRef<GoogleGenAI | null>(null);
  useEffect(() => {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "undefined" && key !== "") {
      aiRef.current = new GoogleGenAI({ apiKey: key });
    }
  }, []);

  // AI Suggestions
  const generateAiSuggestions = async () => {
    if (!messages.length || isAiLoading || !aiRef.current) return;
    setIsAiLoading(true);
    try {
      const lastMessages = messages.slice(-5).map(m => `${m.senderId === user?.uid ? 'Me' : 'Them'}: ${m.text}`).join('\n');
      
      const response = await aiRef.current.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Given this conversation history:\n${lastMessages}\n\nSuggest 3 short, helpful, and natural sounding replies for "Me". Return as a JSON array of strings.`,
        config: {
          responseMimeType: 'application/json'
        }
      });
      
      const suggestions = JSON.parse(response.text || '[]');
      setAiSuggestions(suggestions);
    } catch (e) {
      console.error('AI Suggestion error:', e);
    } finally {
      setIsAiLoading(false);
    }
  };

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].senderId !== user?.uid) {
       generateAiSuggestions();
    } else {
      setAiSuggestions([]);
    }
  }, [messages, user]);

  const handleSendMessage = async (e?: React.FormEvent, text?: string) => {
    e?.preventDefault();
    const messageText = text || inputText;
    if (!messageText.trim() || !user || !selectedConvo) return;

    const newMessage = {
      senderId: user.uid,
      text: messageText,
      timestamp: serverTimestamp(),
      type: 'text',
      participants: selectedConvo.participants
    };

    try {
      if (!text) setInputText('');
      await addDoc(collection(db, `conversations/${selectedConvo.id}/messages`), newMessage);
      await updateDoc(doc(db, 'conversations', selectedConvo.id), {
        lastMessage: {
          text: messageText,
          senderId: user.uid,
          timestamp: serverTimestamp()
        },
        updatedAt: serverTimestamp()
      });
      setAiSuggestions([]);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `conversations/${selectedConvo.id}/messages`);
    }
  };

  const startConversation = async (participantEmail: string) => {
    if (!user || participantEmail === user.email) return;
    
    try {
      // Find user by email
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', participantEmail), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert('User not found');
        return;
      }

      const targetUser = querySnapshot.docs[0].data() as UserProfile;
      
      // Check if conversation already exists
      const existing = conversations.find(c => 
        c.participants.includes(targetUser.uid) && c.participants.length === 2
      );

      if (existing) {
        setSelectedConvo(existing);
        setShowNewChat(false);
        return;
      }

      const newConvoData = {
        participants: [user.uid, targetUser.uid],
        participantDetails: {
          [user.uid]: { displayName: user.displayName || 'Anonymous', photoURL: user.photoURL || '' },
          [targetUser.uid]: { displayName: targetUser.displayName, photoURL: targetUser.photoURL }
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'conversations'), newConvoData);
      setSelectedConvo({ id: docRef.id, ...newConvoData } as any);
      setShowNewChat(false);
      setSearchEmail('');
      setSearchRoomCode('');
    } catch (e) {
      console.error('Conversation start error:', e);
      alert('Failed to start conversation. Please check your connection or ensure the user exists.');
      handleFirestoreError(e, OperationType.WRITE, 'conversations');
    }
  };

  const joinByRoomCode = async (code: string) => {
    if (!user || !code.trim()) return;
    
    try {
      const q = query(collection(db, 'users'), where('roomCode', '==', code.trim().toUpperCase()), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert('Invalid room code');
        return;
      }

      const targetUser = querySnapshot.docs[0].data() as UserProfile;
      if (targetUser.uid === user.uid) {
        alert("You can't chat with yourself!");
        return;
      }

      await startConversation(targetUser.email);
    } catch (e) {
      console.error('Join room error:', e);
      alert('Failed to join room.');
    }
  };

  if (loading) return <div className="h-screen w-full flex items-center justify-center bg-black"><motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity }} className="h-12 w-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /></div>;

  if (!user) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-black p-4 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/20 blur-[120px] rounded-full pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass p-8 rounded-3xl max-w-sm w-full text-center space-y-6 relative z-10"
      >
        <div className="mx-auto w-20 h-20 bg-indigo-600 rounded-[28px] flex items-center justify-center shadow-indigo-500/40 shadow-2xl relative">
          <motion.div 
            animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 4 }}
          >
            <MessageSquare className="text-white w-10 h-10" />
          </motion.div>
          <motion.div 
            animate={{ opacity: [0, 1, 0], y: [-20, -40, -60], x: [20, 40, 20] }}
            transition={{ repeat: Infinity, duration: 3 }}
            className="absolute -top-2 -right-2 bg-emerald-500 p-1.5 rounded-lg shadow-lg"
          >
             <Sparkles className="w-4 h-4 text-white" />
          </motion.div>
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl font-black tracking-tighter text-white">VOLT</h1>
          <p className="text-slate-400 text-sm leading-relaxed px-4">Secure, lightning-fast communication powered by Pulse engine. Connect instantly with room codes.</p>
        </div>
        <button 
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-black font-semibold rounded-2xl hover:bg-slate-100 transition-all active:scale-95"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/pwa/google.svg" alt="Google" className="w-5 h-5" />
          Continue with Google
        </button>
        <p className="text-xs text-slate-500">By continuing, you agree to our Terms of Service.</p>
      </motion.div>
    </div>
  );

  return (
    <div className="h-screen w-full flex bg-black overflow-hidden relative font-sans selection:bg-indigo-500/30">
      {/* Animated Starfield Background */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[#020202]" />
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ 
              opacity: Math.random(), 
              x: Math.random() * window.innerWidth, 
              y: Math.random() * window.innerHeight 
            }}
            animate={{ 
              opacity: [0.2, 0.8, 0.2],
              scale: [1, 1.5, 1],
            }}
            transition={{ 
              duration: 2 + Math.random() * 4, 
              repeat: Infinity,
              delay: Math.random() * 5
            }}
            className="absolute w-0.5 h-0.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]"
          />
        ))}
      </div>
      {/* Mobile Header Overlay if convo selected */}
      <AnimatePresence>
        {selectedConvo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed top-0 left-0 right-0 h-16 glass z-50 flex items-center px-4 gap-3"
          >
            <button onClick={() => setSelectedConvo(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <ChevronLeft className="w-6 h-6 text-slate-300" />
            </button>
            <div className="flex items-center gap-3">
              <img 
                src={selectedConvo.participantDetails[Object.keys(selectedConvo.participantDetails).find(id => id !== user.uid)!].photoURL} 
                className="w-10 h-10 rounded-full object-cover" 
                alt="Avatar" 
              />
              <span className="font-semibold text-white">
                {selectedConvo.participantDetails[Object.keys(selectedConvo.participantDetails).find(id => id !== user.uid)!].displayName}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar - Desktop Layout */}
      <aside className={cn(
        "w-full md:w-[380px] lg:w-[420px] flex-shrink-0 border-r border-white/5 flex flex-col h-full bg-[#050505] transition-all",
        selectedConvo ? "hidden md:flex" : "flex"
      )}>
        {/* Profile Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img src={profile?.photoURL} className="w-10 h-10 rounded-full object-cover border border-white/10" alt="Avatar" />
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#050505] rounded-full" />
            </div>
            <div>
              <h2 className="font-semibold text-white leading-tight">{profile?.displayName}</h2>
              <button 
                onClick={() => profile?.roomCode && copyToClipboard(profile.roomCode)}
                className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/10 hover:border-indigo-500/50 hover:bg-white/10 transition-all group/code cursor-pointer active:scale-95"
              >
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  <span className="text-indigo-400">ID:</span> {profile?.roomCode || '...'}
                </p>
                <span className={cn(
                  "text-[8px] uppercase font-black transition-all",
                  copyFeedback ? "text-emerald-400" : "text-transparent group-hover/code:text-white/40"
                )}>
                  {copyFeedback ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setShowNewChat(true)} className="p-2 hover:bg-white/5 text-slate-400 hover:text-white rounded-full transition-all">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => auth.signOut()} className="p-2 hover:bg-red-500/10 text-slate-400 hover:text-red-500 rounded-full transition-all">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 mb-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..." 
              className="w-full bg-[#111] border border-white/5 rounded-2xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-hide">
          {(() => {
            const sessions = conversations.filter(convo => {
              const otherId = Object.keys(convo.participantDetails).find(uid => uid !== user?.uid) || '';
              const details = convo.participantDetails[otherId];
              const nameMatch = details?.displayName?.toLowerCase().includes(searchQuery.toLowerCase());
              const messageMatch = convo.lastMessage?.text?.toLowerCase().includes(searchQuery.toLowerCase());
              return nameMatch || messageMatch;
            });

            if (sessions.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center h-48 text-center px-8">
                  <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4">
                    {searchQuery ? <Search className="text-indigo-400 w-6 h-6" /> : <Plus className="text-indigo-400 w-6 h-6" />}
                  </div>
                  <p className="text-sm text-slate-400">
                    {searchQuery ? `No results for "${searchQuery}"` : "No conversations yet.\nStart messaging your friends!"}
                  </p>
                </div>
              );
            }

            return sessions.map(convo => {
              const otherId = Object.keys(convo.participantDetails).find(uid => uid !== user?.uid) || user?.uid || '';
              const details = convo.participantDetails[otherId];
              const isSelected = selectedConvo?.id === convo.id;
              
              if (!details) return null;

              return (
                <button 
                  key={convo.id}
                  onClick={() => setSelectedConvo(convo)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-2xl transition-all group relative",
                    isSelected ? "bg-indigo-600 text-white" : "hover:bg-white/5 text-slate-400 hover:text-slate-200"
                  )}
                >
                  {isSelected && (
                    <motion.div 
                      layoutId="active-highlight" 
                      className="absolute inset-0 bg-indigo-600/10 rounded-2xl z-0" 
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <div className="relative shrink-0 z-10">
                    <img src={details.photoURL} alt={details.displayName} className="w-12 h-12 rounded-full object-cover border border-white/10 group-hover:border-indigo-500/50 transition-colors" />
                    {!isSelected && <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#050505] rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
                  </div>
                  <div className="flex-1 text-left min-w-0 z-10">
                    <div className="flex justify-between items-start">
                      <h4 className={cn("font-semibold truncate tracking-tight", isSelected ? "text-white" : "text-slate-200")}>{details.displayName}</h4>
                      <span className={cn("text-[10px] uppercase tracking-wider font-bold opacity-60 ml-2 whitespace-nowrap", isSelected ? "text-indigo-100" : "text-slate-500")}>
                        {convo.updatedAt ? format((convo.updatedAt as Timestamp).toDate(), 'HH:mm') : ''}
                      </span>
                    </div>
                    <p className={cn("text-xs truncate font-medium flex items-center gap-1", isSelected ? "text-indigo-100/70" : "text-slate-500")}>
                      {convo.lastMessage?.senderId === user?.uid && (
                        <span className="text-emerald-500">✓</span>
                      )}
                      {convo.lastMessage?.text || 'No messages yet'}
                    </p>
                  </div>
                  {isSelected && <motion.div layoutId="active-pill" className="absolute left-0 top-1/3 bottom-1/3 w-1 bg-white rounded-full z-10" />}
                </button>
              );
            });
          })()}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className={cn(
        "flex-1 flex flex-col h-full bg-[#030303] relative shadow-2xl",
        !selectedConvo ? "hidden md:flex items-center justify-center p-12" : "flex"
      )}>
        <AnimatePresence mode="wait">
          {selectedConvo ? (
            <motion.div 
              key={selectedConvo.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="flex-1 flex flex-col h-full overflow-hidden"
            >
              {/* Header Desktop */}
              <header className="hidden md:flex h-20 glass-dark items-center px-8 justify-between z-10 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img 
                      src={selectedConvo.participantDetails[Object.keys(selectedConvo.participantDetails).find(id => id !== user.uid)!].photoURL} 
                      className="w-10 h-10 rounded-full object-cover border border-white/10" 
                      alt="Recipient" 
                    />
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-[#030303] rounded-full" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white tracking-tight">
                      {selectedConvo.participantDetails[Object.keys(selectedConvo.participantDetails).find(id => id !== user.uid)!].displayName}
                    </h3>
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">
                      Active Now
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-2.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-full transition-all">
                    <Search className="w-5 h-5" />
                  </button>
                  <button className="p-2.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-full transition-all">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
              </header>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 md:pt-4 pt-20 scrollbar-hide">
                <AnimatePresence initial={false}>
                  {messages.map((msg, i) => {
                    const isMe = msg.senderId === user.uid;
                    const prevMsg = messages[i-1];
                    const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;

                    return (
                      <motion.div 
                        layout
                        initial={{ opacity: 0, x: isMe ? 20 : -20, scale: 0.8 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ 
                          type: 'spring', 
                          damping: 25, 
                          stiffness: 300,
                          layout: { duration: 0.2 }
                        }}
                        key={msg.id}
                        className={cn(
                          "flex items-end gap-3",
                          isMe ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        {!isMe && (
                          <div className="w-8 h-8 flex-shrink-0">
                            {showAvatar ? (
                              <motion.img 
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                src={selectedConvo.participantDetails[msg.senderId].photoURL} 
                                className="w-8 h-8 rounded-full object-cover border border-white/10" 
                                alt="Avatar" 
                              />
                            ) : <div className="w-8" />}
                          </div>
                        )}
                        <div className={cn(
                          "max-w-[80%] md:max-w-[70%] group relative",
                          isMe ? "items-end" : "items-start"
                        )}>
                          <motion.div 
                            layout
                            className={cn(
                              "px-5 py-3.5 rounded-[22px] text-sm leading-relaxed shadow-lg relative",
                              isMe 
                                ? "bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-br-none" 
                                : "bg-[#1A1A1A] text-slate-200 rounded-bl-none border border-white/5"
                            )}
                          >
                            {msg.text}
                            {isMe && (
                              <div className="absolute -bottom-1 -right-1 flex gap-0.5">
                                <span className={cn(
                                  "text-[10px]",
                                  msg.timestamp ? "text-emerald-400" : "text-white/40"
                                )}>✓✓</span>
                              </div>
                            )}
                          </motion.div>
                          <p className={cn(
                            "text-[10px] text-slate-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap",
                            isMe ? "text-right" : "text-left"
                          )}>
                            {msg.timestamp ? format((msg.timestamp as Timestamp).toDate(), 'HH:mm') : ''}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                
                <AnimatePresence>
                  {Object.keys(typingUsers).length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      className="flex items-center gap-2 text-slate-500 text-[10px] font-medium"
                    >
                      <div className="flex gap-1">
                        <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1 h-1 bg-slate-500 rounded-full" />
                        <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1 h-1 bg-slate-500 rounded-full" />
                        <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1 h-1 bg-slate-500 rounded-full" />
                      </div>
                      {Object.keys(typingUsers).map(uid => selectedConvo?.participantDetails[uid]?.displayName).join(', ')} is typing...
                    </motion.div>
                  )}
                </AnimatePresence>

                <div ref={scrollRef} />
              </div>

              {/* Input Area */}
              <footer className="p-6 md:px-8 pb-10 md:pb-8 flex flex-col gap-4 z-10 glass-dark shrink-0">
                <AnimatePresence>
                  {aiSuggestions.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex flex-wrap gap-2 mb-2"
                    >
                      <motion.div 
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20 text-[10px] font-bold uppercase tracking-wider"
                      >
                        <Sparkles className="w-3 h-3 text-indigo-400" />
                        Smart Replies
                      </motion.div>
                      {aiSuggestions.map((s, i) => (
                        <motion.button 
                          key={i}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: i * 0.1 }}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleSendMessage(undefined, s)}
                          className="px-4 py-2 bg-[#1A1A1A] hover:bg-[#252525] text-slate-300 text-xs rounded-full border border-white/5 transition-all shadow-sm"
                        >
                          {s}
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSendMessage} className="relative flex items-center gap-3">
                  <input 
                    type="text" 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a secure message..." 
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-slate-600"
                  />
                  <button 
                    type="submit"
                    disabled={!inputText.trim()}
                    className={cn(
                      "p-4 rounded-2xl transition-all shadow-xl",
                      inputText.trim() ? "pulse-primary shadow-indigo-500/20" : "bg-white/5 text-slate-600 cursor-not-allowed"
                    )}
                  >
                    <Send className="w-6 h-6" />
                  </button>
                </form>
              </footer>
            </motion.div>
          ) : (
            <motion.div 
              key="empty"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center text-center space-y-6"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                <div className="relative w-24 h-24 bg-[#111] border border-white/5 rounded-[32px] flex items-center justify-center shadow-2xl">
                  <MessageSquare className="w-10 h-10 text-indigo-500" />
                </div>
              </div>
              <div className="space-y-2 max-w-xs">
                <h1 className="text-2xl font-bold text-white tracking-tight">Select a Chat</h1>
                <p className="text-sm text-slate-500">Pick an existing conversation or start a new one to begin messaging securely.</p>
              </div>
              <button 
                onClick={() => setShowNewChat(true)}
                className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold rounded-2xl transition-all"
              >
                <Plus className="w-4 h-4" />
                New Conversation
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Background Animated Gradient */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <motion.div 
          animate={{ 
            opacity: [0.05, 0.1, 0.05],
            scale: [1, 1.1, 1] 
          }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-indigo-600/30 blur-[160px] rounded-full"
        />
        <motion.div 
          animate={{ 
            opacity: [0.03, 0.07, 0.03],
            scale: [1, 1.2, 1] 
          }}
          transition={{ duration: 15, repeat: Infinity, delay: 2 }}
          className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-purple-600/20 blur-[140px] rounded-full"
        />
      </div>
      <AnimatePresence>
        {showNewChat && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="glass p-8 rounded-3xl max-w-sm w-full space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">Start New Chat</h3>
                <button onClick={() => setShowNewChat(false)} className="text-slate-500 hover:text-white">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Connect by Room Code</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={searchRoomCode}
                      onChange={(e) => setSearchRoomCode(e.target.value)}
                      placeholder="Enter 6-digit code"
                      className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all uppercase placeholder:normal-case"
                    />
                    <button 
                      onClick={() => joinByRoomCode(searchRoomCode)}
                      className="px-6 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold transition-all active:scale-95"
                    >
                      Join
                    </button>
                  </div>
                </div>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-[#111] px-2 text-slate-500 font-bold tracking-widest leading-none">OR</span></div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Invite by Email</label>
                  <input 
                    type="email" 
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    placeholder="friend@example.com"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <button 
                  onClick={() => startConversation(searchEmail)}
                  className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl font-semibold transition-all"
                >
                  Start Messaging
                </button>
              </div>
              <div className="pt-4 border-t border-white/5">
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <Search className="w-3 h-3" />
                  Searching user database...
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
