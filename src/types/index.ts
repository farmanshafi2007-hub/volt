import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  email: string;
  roomCode: string;
  status: 'online' | 'offline';
  lastSeen: Timestamp;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: Timestamp;
  type: 'text' | 'image';
}

export interface Conversation {
  id: string;
  participants: string[];
  participantDetails: Record<string, { displayName: string; photoURL: string }>;
  lastMessage?: {
    text: string;
    senderId: string;
    timestamp: Timestamp;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TypingInfo {
  isTyping: boolean;
  updatedAt: Timestamp;
}
