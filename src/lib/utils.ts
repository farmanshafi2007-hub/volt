import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

import { auth } from './firebase';

export function getErrorMessage(error: any): string {
  if (!error) return 'An unknown error occurred';
  
  const code = error.code;
  const message = error.message || '';

  if (code === 'permission-denied') {
    return 'You don\'t have permission to perform this action. Please check if you\'re signed in correctly.';
  }
  if (code === 'unavailable') {
    return 'Network error. Please check your internet connection and try again.';
  }
  if (code === 'unauthenticated') {
    return 'Your session has expired. Please sign in again.';
  }
  if (code === 'resource-exhausted') {
    return 'Daily limit reached. Please try again tomorrow.';
  }
  if (message.includes('offline')) {
    return 'You appear to be offline. Reconnecting...';
  }

  return message || 'An unexpected error occurred';
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = getErrorMessage(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  // We throw a more readable error message combined with the technical part
  throw new Error(`${message} [${operationType}]`);
}
