# Phase 11 — Super-admin password change

Status: in progress  
Updated: 2026-11-17

## Goal

Let the signed-in super admin change their own password from the account page.
The form asks for the current password, then the new password twice. A
successful change keeps the current browser session and signs out other
sessions.

## Locked decisions

- Only the super admin can use the password-change endpoint. Member passwords
  and recovery remain out of scope.
- The endpoint is `POST /api/v1/me/password` and requires a browser session. API
  project keys cannot call it.
- The request is `{ "currentPassword", "newPassword" }`. The client repeats the
  new password and checks the two values match before sending. The server
  validates the current password, the 12–200 character password length and that
  the new password differs from the current one.
- A wrong current password returns `403 invalid_credentials` so the current
  session stays active. A non-super-admin session or an API key returns `403
  forbidden`; a missing or expired session returns `401 unauthenticated`.
- A successful change returns `204`, keeps the current session, and deletes the
  user's other sessions. All API project keys are unaffected.
- The password-change route uses the login rate-limit window keyed by IP and
  user id.
- The super-admin password in `.env` becomes bootstrap-only. It creates the
  super admin on a fresh database but no longer overwrites a password changed
  through the account page. Email and display-name synchronization from `.env`
  continue to work.
- Password recovery, member self-service changes and admin resets remain
  deferred under P-17.

## API and data model

`authStore.updateUserPassword(userId, passwordHash)` updates `password_hash` and
`updated_at`. No migration is required.

Add `changePasswordSchema` with:

- `currentPassword`: 1–200 characters;
- `newPassword`: 12–200 characters.

The route verifies the current hash with Argon2id, hashes the new password,
stores it, calls `deleteOtherSessions(userId, currentSessionId)` and returns
`204`. Errors do not reveal whether the account exists.

## UI

The account page gains a **Change password** section visible only to the super
admin:

- Current password
- New password
- Confirm new password
- Submit button

Client validation rejects mismatched values and passwords shorter than 12
characters. Success clears the fields and shows a notice that other sessions
were signed out. The form uses the existing account form styling and remains
keyboard accessible.

## Bootstrap behavior

`ensureSuperAdmin` still creates the singleton super admin when missing and
still synchronizes email and display name. It no longer verifies or replaces the
stored password from `.env`. Changing the env password on an existing database
does not alter the login password; use the account page.

## Tests and acceptance criteria

1. Super admin changes the password with the correct current password; the
   current session remains valid, other sessions are revoked, the old password
   fails and the new password signs in.
2. Wrong current password, short new password, same password and mismatched
   client confirmation are rejected without changing the hash.
3. Members, API keys and unauthenticated requests cannot change the password.
4. A later bootstrap with a different `LAYERS_SUPER_ADMIN_PASSWORD` does not
   overwrite the password changed through the UI, while email and display-name
   changes still sync.
5. Account page E2E test covers the form, validation, success notice, sign-out
   of other sessions and login with the new password.
6. OpenAPI, generated types, README, docs and the agent guide are updated.
7. Quality gate: lint, format:check, typecheck, unit, API, contract, API lint,
   build, E2E and production smoke.

## Boundaries

No password recovery, email delivery, member password change, admin reset,
password history, composition rules or MFA. No new database table or external
service.
