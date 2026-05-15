# Security Specification - Chat App

## Data Invariants
1. **Users**: Every user must have a `displayName`. UIDs are immutable.
2. **Conversations**: Must have a `participants` array. 
3. **Messages**: Must have `userId`, `text`, and `createdAt`. `userId` must match the authenticated user.
4. **Relational**: Users can only read/write messages in conversations where they are a participant.

## The "Dirty Dozen" Payloads
1. **Identity Spoofing**: Create a message with someone else's `userId`.
2. **Ghost Field**: Add `isVerified: true` to a user profile.
3. **ID Poisoning**: Use a 1MB string as a conversation ID.
4. **State Shortcutting**: Update a message's `createdAt` to a future time.
5. **Unauthorized Read**: List messages of a conversation the user isn't in.
6. **Self-Promotion**: Add another user to a conversation without being in it.
7. **Resource Exhaustion**: Send a message text that is 1MB in size.
8. **Orphaned Message**: Create a message in a non-existent conversation.
9. **Immutable Violation**: Change the `userId` of an existing message.
10. **Shadow Participant**: Update a conversation to remove all participants except yourself.
11. **Bypass Verification**: Perform writes without `email_verified` (if using Google).
12. **Null Auth**: Try to read conversations without being signed in.

## Test Runner (Logic)
The `firestore.rules` will be validated against these scenarios.
