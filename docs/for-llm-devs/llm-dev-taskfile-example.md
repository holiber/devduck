
> Example of a final task file for the task:
> **Implement a “Contacts list” component with navigation to `/contacts/:contact_id`**

````md
# Task: Contacts list component with navigation

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 AgentMallard
- Stage: 6
- Branch: contacts-list-component
- PR: #456

## 1. Intake

We need to build a UI component that displays a list of user contacts.
When a contact is clicked, the app should navigate to
`/contacts/:contact_id`.

Contacts are expected to be loaded from the backend API endpoint
`GET /api/me/contacts`.

## 2. Status Log

- CHECKPOINT: Stage 0 pushed
- CHECKPOINT: Stage 1 pushed
- CHECKPOINT: Stage 2 pushed
- CHECKPOINT: Stage 3 pushed
- CHECKPOINT: Stage 4 pushed
- CHECKPOINT: Stage 5 pushed
- CHECKPOINT: Stage 6 pushed

## 3. Task

### Why we are doing this

The application already has a `/contacts/:contact_id` page, but users have
no convenient way to navigate to it.

Implementing a contacts list improves basic UX and unblocks further work
on contact details, editing, and messaging.

### What to do

- Fetch the current user’s contacts from `GET /api/me/contacts`
- Render a list of contacts (name + optional metadata)
- Make each contact clickable
- On click, navigate to `/contacts/:contact_id`

### Definition of Done

- Contacts are loaded from the backend API
- A list of contacts is rendered in the UI
- Clicking a contact navigates to `/contacts/:contact_id`
- No console errors during loading or navigation

### Out of scope

- Editing or deleting contacts
- Contact creation
- Styling polish beyond basic layout

## 4. Plan

### Goals

- Display user contacts in a reusable UI component
- Ensure navigation works reliably for each contact
- Keep the component simple and testable

### Changes

- Add a `ContactsList` React component
- Add API call to `GET /api/me/contacts`
- Use router navigation on item click

### Steps

1. Inspect existing routing to confirm `/contacts/:contact_id` exists
2. Implement API helper for `/api/me/contacts`
3. Create `ContactsList` component
4. Render list items with click handlers
5. Wire navigation to router
6. Manually verify behavior in the browser

## 5. Journal (Captain’s Log)

> Chronological log of what actually happened during implementation,
> including mistakes, false assumptions, and recoveries.

- Attempted to fetch contacts from `GET /api/me/contacts`
  - Request failed with a network error
- Suspected the endpoint or auth configuration
- Tried calling `GET /api/me`
  - This request also failed
- Considered the possibility of a backend regression
- Checked local environment and realized the backend server was **not running**
- Started the backend with:
  ```bash
  npm run server
````

* Retried `GET /api/me`

  * Request succeeded
* Retried `GET /api/me/contacts`

  * Request succeeded
* Contacts list rendered correctly
* Navigation to `/contacts/:contact_id` worked as expected

## 6. CI Attempts

### Attempt 1/5

* What failed: failed test
  `get contact info`
  (`tests/get-contact-info.test.ts`)
* What changed: fixed incorrect API path used in the test setup
* Links: <CI link>

### Attempt 2/5

* All checks are green ✅
* No further action required

## 7. Final Report

### What changed

* Added `ContactsList` component
* Integrated backend API call to load contacts
* Implemented navigation to `/contacts/:contact_id`
* Fixed incorrect API path discovered via CI

### How to verify

1. Start the backend server:

   ```bash
   npm run server
   ```
2. Start the frontend app
3. Navigate to the contacts page
4. Click any contact
5. Verify the URL changes to `/contacts/<contact_id>` and the page loads

### Result

The contacts list works as intended and provides a clear navigation path
to individual contact pages.

## 8. Recommendation

To avoid wasting time and API tokens in the future:

* **Always verify that the backend API server is running** before debugging
  failed API requests.
* If multiple endpoints (`/api/me`, `/api/me/contacts`) fail in the same way,
  suspect environment issues before assuming backend or client bugs.

This simple check can prevent repeated failed attempts and unnecessary
debugging cycles.

## 9. USER INPUT REQUIRED ⚠️

🦆 **KrYA**, I tried my best, but I need your help.

It looks like my access credentials are no longer valid:

* The `GITHUB_TOKEN` used for API calls is expired or missing permissions
* I cannot continue without updated credentials

### What I need from you

1. Generate a new GitHub token with **read and write access** to this repository
2. Add it to your environment configuration:

```env
GITHUB_TOKEN=<your_token_here>
```

3. Let me know once this is done, and I will continue from the last successful stage

Sorry for the interruption, and thank you! 🙏

```

