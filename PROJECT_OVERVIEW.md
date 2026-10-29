# MediQuery: Project Overview and Data-Security Notes

This document explains what MediQuery is, how it is built, and how it stores
and protects data. It is based on reading the code in this repository. Where
something is a gap rather than a strength, it says so.

---

## 1. What the project is

MediQuery is a cross-platform (Android/iOS) medicine-enquiry app built with
React Native and Expo. Users can:

| Feature | What it does |
|---|---|
| **Medicine search** | Type-ahead suggestions and a detail page (composition, manufacturer, price, uses, side effects, habit-forming and prescription flags) |
| **Similar medicines** | Finds alternatives with the same composition, plus listed substitutes |
| **Nearby pharmacies** | Uses the phone's location to list and map pharmacies within 10 km |
| **Medicine reminders** | Local notifications (daily or one-off, before or after food) and a one-tap "share my list" |
| **Health profile** | Age, height, weight and gender, with BMI and BMR calculation |
| **Accounts** | Email and password sign-up and sign-in (Supabase Auth). The app is only reachable when signed in |

The medicine data comes from a public A-Z dataset of Indian medicines and a
Pakistani dataset. The `scraper/` folder holds a Python scraper (Dawaai) that
extends the Pakistani one.

## 2. Architecture

```
┌──────────────────────────┐        HTTPS         ┌──────────────────────┐
│  Expo / React Native app │ ───────────────────▶ │  Supabase            │
│  (Frontend/)             │   sign-up / sign-in  │  Auth + Postgres     │
│                          │                      │  `profiles` table    │
│  On-device storage:      │                      │  (Row Level Security)│
│   - SecureStore (secrets,│                      └──────────────────────┘
│     health profile)      │
│   - AsyncStorage (history│        HTTP (config)  ┌──────────────────────┐
│     reminders, API URL)  │ ───────────────────▶ │  Express API         │
└──────────────────────────┘  search / location   │  (Backend/services)  │
                                                  │                      │
                                                  │  MongoDB  ◀── or ──▶ │
                                                  │  in-memory CSV       │
                                                  └─────────┬────────────┘
                                                            │ HTTPS
                                                            ▼
                                              OpenStreetMap Overpass / Nominatim
```

### Frontend (`Frontend/`)
- Expo SDK 54, React Native 0.81, `expo-router` file-based navigation.
- `app/(auth)/` holds the sign-in and sign-up screens. `app/(tabs)/` holds
  Home (search), Maps, Reminder and Profile.
- `app/_layout.tsx` uses `Stack.Protected` so the tab screens are not
  reachable without a session.
- `context/AuthContext.jsx` wraps Supabase Auth (sign in, sign up, sign out,
  session restore).
- `config.js` holds the backend URL. It comes from the build-time
  `EXPO_PUBLIC_API_BASE`, from the Metro host in development, or from a
  user-editable override on the Profile screen.

### Backend (`Backend/services/`)
- Node/Express. Endpoints:
  - `GET /suggestions?q=` returns up to 6 name matches.
  - `GET /medicine?name=` returns the detail record.
  - `GET /similar?comp1=&comp2=` returns up to 50 same-composition medicines.
  - `POST /get_medical_shops` takes `{latitude, longitude}` and returns nearby
    pharmacies. It queries several Overpass mirrors in parallel, falls back to
    Nominatim, and caches results for 30 minutes per ~1 km cell.
- Data is read from MongoDB. If MongoDB is unreachable or empty, it falls
  back to loading the CSV into memory (`memoryStore.js`). That fallback also
  hot-reloads when the scraper rewrites the CSV.
- `import_data.js` loads the CSVs into MongoDB.

### Supabase (`supabase/migrations/`)
- One `public.profiles` table (id, email, full_name, timestamps), linked to
  `auth.users` with `on delete cascade`.
- A `security definer` trigger creates the profile row when a user signs up.
- By design, **health metrics never go to the server**. Only identity is
  stored in Supabase.

## 3. Secure storage: how data is handled today

### 3.1 What is stored where

| Data | Location | Protection |
|---|---|---|
| Auth session (access and refresh tokens, user JSON) | `expo-secure-store` | **Encrypted**: iOS Keychain, Android Keystore-backed storage |
| Health profile (age, height, weight, gender) | `expo-secure-store`, key `profile_<userId>` | **Encrypted**, and separate per account |
| Account email, full name, password hash | Supabase (Postgres/Auth) | Server-side. Passwords are hashed by Supabase Auth, never stored by the app |
| Medicine reminders (medicine names, times) | `AsyncStorage` (`@reminders_v1`) | **Not encrypted** (app-sandbox only) |
| Search history | `AsyncStorage` (`MED_SEARCH_HISTORY`) | **Not encrypted** |
| Backend URL override | `AsyncStorage` | Not encrypted (not sensitive) |
| Medicine dataset | Server (MongoDB or CSV) | Public reference data |

### 3.2 What is done well

1. **Tokens in the Keychain/Keystore, not plain storage.** `lib/supabase.js`
   passes a custom `secureStorage` adapter to the Supabase client. The default
   in React Native would be AsyncStorage, which is plaintext.
2. **Chunking for SecureStore's size limit** (`lib/secureStorage.js`). A
   Supabase session is bigger than the ~2 KB value limit, so it is split into
   1800-character pieces with a count key. A missing chunk (an interrupted
   write) is treated as "signed out" rather than returning corrupt data.
3. **Strict accessibility class on iOS.** The storage options use
   `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Tokens can refresh while the app is
   backgrounded, are **not** synced to iCloud, and are **not** restored onto
   another device.
4. **Health data stays on the device and is per-user.** `profileStore.js`
   keys it by user ID, so a second account on a shared phone cannot read it.
   It also migrates any legacy plaintext profile out of AsyncStorage into
   SecureStore and deletes the plaintext copy.
5. **Row Level Security** on `profiles`. Policies allow `select` and `update`
   only where `auth.uid() = id`. There are no insert or delete policies, so
   clients cannot create or delete rows directly. Rows are created only by the
   trigger.
6. **Safe use of Supabase keys.** The app ships only the *publishable* key,
   and RLS enforces access. The `.env.example` files tell contributors never
   to use the `service_role` key.
7. **Hardened trigger functions.** `security definer` functions set
   `search_path = ''`, which prevents search-path hijacking.
8. **Refresh only in the foreground.** Token auto-refresh stops when the app
   is backgrounded and restarts on resume.
9. **Secrets kept out of git.** `.env` is in `.gitignore`, and only
   `.env.example` templates are committed.
10. **Regex input is escaped** (`escapeRegex`) in the search endpoints, which
    prevents ReDoS and regex injection.
11. **Password rules and route guard.** The sign-up screen enforces a minimum
    of 8 characters. Unauthenticated users cannot navigate to the tabs.

### 3.3 Gaps and risks (recommended fixes, highest priority first)

| # | Issue | Why it matters | Suggested fix |
|---|---|---|---|
| 1 | **A MongoDB Atlas connection string with a username and password is committed** in `add_data_mongodb_atlas_A_Z.ipynb`. `README.md` also publishes a `root:root` URI. | Anyone with repo access, including through git history, can try the credentials against the Atlas cluster. | **Rotate or delete that Atlas user now.** Remove the credentials from both files. Purge them from git history (`git filter-repo` or BFG) or treat the history as burned. Read the URI from an env var in the notebook. |
| 2 | **Reminders and search history are in plaintext AsyncStorage.** Medicine names are health data, and they are not tied to the signed-in user. | Readable on rooted or jailbroken devices and in unencrypted backups. They stay on the device after sign-out and are visible to the next account. | Store them with `setSecureJSON` keyed by `userId` (as the profile already is). Clear them on sign-out. Keep large histories in an encrypted store (SQLCipher or MMKV with a key held in SecureStore). |
| 3 | **Cleartext HTTP is allowed** (`usesCleartextTraffic: true`, and `config.js` defaults to `http://`). | The search queries and, importantly, **the user's GPS coordinates** travel unencrypted. A network attacker can read or alter them. | Serve the API over HTTPS (the Render URL already supports it). Set `usesCleartextTraffic` to `false` for release builds. Add an iOS ATS exception only for local dev. Reject non-HTTPS values in the Profile "server address" field for release builds. |
| 4 | **The user can point the app at any server**, via a stored override. | A tampered or phished URL could return malicious data or harvest the user's location. | Hide the override in production builds, or pin it to an allow-list. |
| 5 | **The backend has no authentication, rate limiting or hardening.** CORS is `*`, there is no `helmet`, and it does not verify the Supabase JWT. | Anyone can call the API. The "sign-in required" gate exists only inside the client app. | Verify the Supabase access token on the API (JWT middleware), restrict CORS, add `helmet` and `express-rate-limit`, and cap request sizes. |
| 6 | **Possible NoSQL injection in `/similar`.** `req.query.comp1` goes straight into the Mongo filter. With Express's extended query parser, `?comp1[$ne]=x` becomes an object. | An attacker can turn an equality match into an operator query (data over-read or an expensive query). | Require `typeof comp1 === 'string'` (and the same for `comp2`, `name`, `q`) before querying, or use `express.query` with `simple` parsing. |
| 7 | **Location is sent to third parties.** The backend forwards exact coordinates to the public Overpass and Nominatim servers. | It is a privacy disclosure that users are not told about. | Round coordinates before forwarding (the cache already uses ~1 km cells). Add a privacy notice. Log nothing precise server-side. |
| 8 | **Android backup is enabled** (`allowBackup="true"`), and the manifest references `@xml/secure_store_backup_rules`, which is not present in this repository. | Backup rules decide whether SecureStore and AsyncStorage data is copied to Google backups. A missing file can break the build or leave the defaults in place. | Confirm the rules file is generated by `expo prebuild`. Explicitly exclude SecureStore and AsyncStorage from cloud backup. |
| 9 | **Web builds fall back to `localStorage`** for the "secure" store. | Tokens in `localStorage` are readable by any XSS. | Do not ship the web target for real users, or use httpOnly-cookie sessions for web. |
| 10 | **Unneeded Android permissions**: `READ/WRITE_EXTERNAL_STORAGE` and `SYSTEM_ALERT_WINDOW`. | Extra attack surface and a worse store-review posture. | Remove them. Keep location, notifications and internet. |
| 11 | **Release hygiene.** `android/app/debug.keystore` is committed, and the production EAS profile builds an `apk`. | The debug keystore is public, so it must never sign a release. | Use EAS-managed signing for release. Prefer an `aab` for the Play Store. |
| 12 | **`SECURITY.md` is still the GitHub template** (it lists fake versions and has no reporting contact). | Researchers have no way to report problems. | Fill in a real contact and supported versions. |
| 13 | **Password policy and email flow.** There is only a length check, and sign-up errors are shown verbatim. | Weak passwords are allowed, and detailed errors can leak whether an email exists. | Raise the minimum length and complexity in the Supabase dashboard (leaked-password protection). Show generic messages. |

### 3.4 Suggested target model

```
Secrets / tokens / health data  →  SecureStore (Keychain/Keystore), per user
Non-sensitive preferences       →  AsyncStorage
Account identity                →  Supabase, guarded by RLS
All network traffic             →  HTTPS only, API verifies the Supabase JWT
Credentials                     →  Environment variables only; rotated if ever committed
Sign-out                        →  Clear session, reminders, history, cached profile
```

## 4. Running the project (summary)

**Backend**
```bash
cd Backend
npm install
cp services/.env.example services/.env   # set MONGO_URI, DB_NAME, COLLECTION
npm run import                           # optional: load CSV into MongoDB
npm start                                # falls back to in-memory CSV if Mongo is down
```

**Frontend**
```bash
cd Frontend
npm install
cp .env.example .env    # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npx expo start          # or: npx expo run:android
```

**Database:** apply `supabase/migrations/20261027000000_auth_profiles.sql` in
your Supabase project.

## 5. Repository map

```
MediQuery/
├── Frontend/            Expo app (screens, auth context, secure storage, config)
├── Backend/services/    Express API, CSV importer, in-memory fallback store
├── supabase/migrations/ Postgres schema + RLS for profiles
├── scraper/             Python scraper that extends the Pakistan dataset
├── *.csv                Medicine datasets (India A-Z, Pakistan, cleaned variants)
├── snaps/               README screenshots and logo
└── README.md, SECURITY.md, CONTRIBUTING.md, LICENSE (MIT)
```

> **Disclaimer:** MediQuery shows reference information only. It is not a
> substitute for professional medical advice.
