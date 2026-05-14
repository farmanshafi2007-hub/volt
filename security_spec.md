# Security Specification for Volt Message

## Data Invariants
1. A message must belong to a conversation.
2. A user can only see conversations they are a participant of.
3. A user can only send messages as themselves.
4. Timestamps must be server-generated.
5. User profiles can only be updated by the owner.

## The "Dirty Dozen" Payloads (Target: Firestore)
1. **Payload**: `setDoc(doc(db, 'users', 'other-user-id'), { displayName: 'Hacker' })`
   * **Target**: Identity Spoofing
   * **Expected**: `PERMISSION_DENIED`
2. **Payload**: `addDoc(collection(db, 'conversations'), { participants: ['me'], createdAt: ... })` (where 'me' is current user, attempting to create a solo conversation to bypass participant logic)
   * **Target**: Relational Sync
   * **Expected**: OK (Valid for self-chat, but check logic)
3. **Payload**: `addDoc(collection(db, 'conversations/other-convo/messages'), { text: 'Spam', senderId: 'me', ... })` (where current user is NOT in 'other-convo')
   * **Target**: The "Master Gate"
   * **Expected**: `PERMISSION_DENIED`
4. **Payload**: `updateDoc(doc(db, 'users', 'my-id'), { isAdmin: true })`
   * **Target**: Privilege Escalation
   * **Expected**: `PERMISSION_DENIED` (isAdmin not in schema, but checked for shadow updates)
5. **Payload**: `setDoc(doc(db, 'messages', 'id'), { text: 'A'.repeat(2000000) })`
   * **Target**: Denial of Wallet (Size exhaustion)
   * **Expected**: `PERMISSION_DENIED`
6. **Payload**: `updateDoc(doc(db, 'messages', 'msg-id'), { text: 'Edited' })`
   * **Target**: Message Integrity (Immutability)
   * **Expected**: `PERMISSION_DENIED` (Messages should be immutable)
7. **Payload**: `getDocs(collection(db, 'users'))`
   * **Target**: Public Scraping
   * **Expected**: `PERMISSION_DENIED` (Listing all users should be restricted)
8. **Payload**: `setDoc(doc(db, 'conversations', 'id'), { participants: [], ... })`
   * **Target**: Orphaned Resource
   * **Expected**: `PERMISSION_DENIED` (Must have participants)
9. **Payload**: `setDoc(doc(db, 'users', 'my-id'), { email: 'fake@email.com' })`
   * **Target**: PII Tampering
   * **Expected**: `PERMISSION_DENIED` (Email should match auth email)
10. **Payload**: `addDoc(collection(db, 'messages'), { timestamp: Date.now() })`
    * **Target**: Temporal Integrity
    * **Expected**: `PERMISSION_DENIED` (Must use server timestamp)
11. **Payload**: `setDoc(doc(db, 'conversations', 'id'), { participantDetails: { 'other-id': 'junk' } })`
    * **Target**: Resource Poisoning
    * **Expected**: `PERMISSION_DENIED` (Schema violations)
12. **Payload**: `deleteDoc(doc(db, 'conversations', 'id'))`
    * **Target**: Destructive Write
    * **Expected**: `PERMISSION_DENIED` (Ownership check)
