// Find these in your Supabase project:
// Dashboard -> Project Settings -> API
//   "Project URL"        -> SUPABASE_URL
//   "anon" / "publishable" key -> SUPABASE_ANON_KEY
const SUPABASE_URL = "https://ausxlqhreelffwrruztx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8bpydENHrlg5pwFeuQAqcw_5tndJ_9s";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// DEV MODE
// Set to true to skip real login completely and walk through the
// app's screens with fake sample data. No Supabase auth or RLS
// checks happen while this is true, so live Students/Teachers/etc.
// counts will just show sample numbers, not your real database.
//
// Set back to false once real login is working, to go live again.
// ============================================================
const DEV_MODE = false;
