(() => {
  'use strict';

  const SUPABASE_URL = 'https://bstowbdynpstbzwdgmvz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_dyof24B6rO6eRJQtJ_5iHw_ycxJj68c';
  const QUEUE_KEY = 'scriptureCloudQueue';
  const META_KEY = 'scriptureCloudMeta';
  const LAST_SYNC_KEY = 'scriptureCloudLastSync';

  let client = null;
  let session = null;
  let syncing = false;

  const $ = (s) => document.querySelector(s);
  const parse = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  };
  const refKey = (book, chapter, verse) => `${book}|${chapter}|${verse}`;
  const rowKey = (r) => refKey(r.book, r.chapter, r.verse);
  const historyKey = (r) => `${r.book}|${r.chapter}|${r.translation_code || r.translation || 'BSB'}`;
  const isoNow = () => new Date().toISOString();
  const ms = (v) => v ? Date.parse(v) || 0 : 0;

  function getMeta() {
    const m = parse(META_KEY, {});
    for (const k of ['notes','bookmarks','highlights','preferences']) if (!m[k]) m[k] = {};
    return m;
  }
  function saveMeta(meta) { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
  function stamp(type, key, when = Date.now()) {
    const m = getMeta();
    m[type][key] = when;
    saveMeta(m);
    return when;
  }
  function queue(op) {
    const q = parse(QUEUE_KEY, []);
    const id = op.id || `${op.table}|${op.key || ''}`;
    const next = q.filter(x => x.id !== id);
    next.push({ ...op, id, queued_at: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next.slice(-500)));
    if (session && navigator.onLine) setTimeout(() => flushQueue(true), 0);
  }
  function setMessage(text, bad = false) {
    const el = $('#cloudMessage');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error-text', !!bad);
  }
  function lastSyncLabel() {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return 'Not synced yet';
    const d = new Date(Number(raw));
    return Number.isNaN(d.getTime()) ? 'Not synced yet' : `Last synced ${d.toLocaleString()}`;
  }
  function updateUI() {
    const signedIn = !!session?.user;
    const label = $('#accountLabel');
    const btn = $('#accountBtn');
    const out = $('#cloudSignedOut');
    const inside = $('#cloudSignedIn');
    const email = $('#cloudUserEmail');
    const syncStatus = $('#cloudSyncStatus');
    if (label) label.textContent = signedIn ? 'Synced' : 'Sign in';
    if (btn) btn.title = signedIn ? `Cloud sync · ${session.user.email || 'signed in'}` : 'Sign in for optional cloud sync';
    if (out) out.hidden = signedIn;
    if (inside) inside.hidden = !signedIn;
    if (email) email.textContent = signedIn ? (session.user.email || 'Signed in') : '';
    if (syncStatus) syncStatus.textContent = lastSyncLabel();
    document.dispatchEvent(new CustomEvent('scripture-cloud-status', { detail: { signedIn, email: session?.user?.email || '' } }));
  }

  async function flushQueue(silent = false) {
    if (!client || !session?.user || !navigator.onLine) return false;
    let q = parse(QUEUE_KEY, []);
    if (!q.length) return true;
    const uid = session.user.id;
    const remaining = [];
    for (const op of q) {
      try {
        const payload = { ...(op.payload || {}), user_id: uid };
        let result;
        if (op.kind === 'upsert') {
          result = await client.from(op.table).upsert(payload, { onConflict: op.conflict });
        } else if (op.kind === 'delete') {
          let builder = client.from(op.table).delete().eq('user_id', uid);
          for (const [k,v] of Object.entries(op.match || {})) builder = builder.eq(k, v);
          result = await builder;
        }
        if (result?.error) throw result.error;
      } catch (e) {
        remaining.push(op);
        if (!silent) console.error('Cloud sync queue error', e);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    return remaining.length === 0;
  }

  function noteChanged({ book, chapter, verse, body }) {
    const key = refKey(book, chapter, verse);
    stamp('notes', key);
    queue({
      table: 'notes', key, kind: 'upsert',
      conflict: 'user_id,book,chapter,verse',
      payload: { book, chapter, verse, body: body || '', deleted_at: body ? null : isoNow() }
    });
  }
  function bookmarkChanged({ book, chapter, verse, active }) {
    const key = refKey(book, chapter, verse);
    stamp('bookmarks', key);
    queue({
      table: 'bookmarks', key, kind: 'upsert',
      conflict: 'user_id,book,chapter,verse,translation_code',
      payload: { book, chapter, verse, translation_code: 'ALL', deleted_at: active ? null : isoNow() }
    });
  }
  function highlightChanged({ book, chapter, verse, color }) {
    const key = refKey(book, chapter, verse);
    stamp('highlights', key);
    queue({
      table: 'highlights', key, kind: 'upsert',
      conflict: 'user_id,book,chapter,verse,translation_code',
      payload: { book, chapter, verse, translation_code: 'ALL', color: color || 'yellow', deleted_at: color ? null : isoNow() }
    });
  }
  function readingChanged({ book, chapter, verse, translation, at }) {
    const key = `${book}|${chapter}|${translation || 'BSB'}`;
    queue({
      table: 'reading_history', key, kind: 'upsert',
      conflict: 'user_id,book,chapter,translation_code',
      payload: { book, chapter, verse: verse || 1, translation_code: translation || 'BSB', opened_at: new Date(at || Date.now()).toISOString() }
    });
  }
  function preferencesChanged(payload = {}) {
    stamp('preferences', 'main');
    queue({
      table: 'user_preferences', key: 'main', kind: 'upsert',
      conflict: 'user_id',
      payload: {
        default_translation: payload.translation || localStorage.getItem('lastTranslation') || 'BSB',
        parallel_translations: payload.compare || parse('compareTranslations', ['KJV','TAG1905']),
        theme: payload.dark ?? (localStorage.getItem('dark') === '1') ? 'dark' : 'light',
        settings: { fontSize: payload.fontSize || localStorage.getItem('fontSize') || 'normal' }
      }
    });
  }

  async function syncNotes(meta, remote) {
    const local = parse('notes', {});
    const rmap = new Map(remote.map(r => [rowKey(r), r]));
    for (const r of remote) {
      const key = rowKey(r), rt = ms(r.updated_at || r.created_at), lt = Number(meta.notes[key] || 0);
      if (rt >= lt) {
        if (r.deleted_at) delete local[key]; else local[key] = r.body || '';
        meta.notes[key] = rt;
      }
    }
    for (const key of new Set([...Object.keys(local), ...Object.keys(meta.notes)])) {
      const [book, chapter, verse] = key.split('|');
      const r = rmap.get(key), rt = ms(r?.updated_at || r?.created_at), lt = Number(meta.notes[key] || 0);
      if (!r || lt > rt) {
        queue({
          table:'notes', key, kind:'upsert', conflict:'user_id,book,chapter,verse',
          payload:{ book, chapter:Number(chapter), verse:Number(verse), body:local[key] || '', deleted_at: local[key] ? null : new Date(lt || Date.now()).toISOString() }
        });
      }
    }
    localStorage.setItem('notes', JSON.stringify(local));
  }

  async function syncBookmarks(meta, remote) {
    const local = new Set(parse('bookmarks', []));
    const rmap = new Map(remote.map(r => [rowKey(r), r]));
    for (const r of remote) {
      const key = rowKey(r), rt = ms(r.updated_at || r.created_at), lt = Number(meta.bookmarks[key] || 0);
      if (rt >= lt) {
        if (r.deleted_at) local.delete(key); else local.add(key);
        meta.bookmarks[key] = rt;
      }
    }
    for (const key of new Set([...local, ...Object.keys(meta.bookmarks)])) {
      const [book, chapter, verse] = key.split('|');
      const r = rmap.get(key), rt = ms(r?.updated_at || r?.created_at), lt = Number(meta.bookmarks[key] || 0);
      if (!r || lt > rt) {
        const active = local.has(key);
        queue({
          table:'bookmarks', key, kind:'upsert', conflict:'user_id,book,chapter,verse,translation_code',
          payload:{ book, chapter:Number(chapter), verse:Number(verse), translation_code:'ALL', deleted_at: active ? null : new Date(lt || Date.now()).toISOString() }
        });
      }
    }
    localStorage.setItem('bookmarks', JSON.stringify([...local]));
  }

  async function syncHighlights(meta, remote) {
    const local = parse('highlights', {});
    const rmap = new Map(remote.map(r => [rowKey(r), r]));
    for (const r of remote) {
      const key = rowKey(r), rt = ms(r.updated_at || r.created_at), lt = Number(meta.highlights[key] || 0);
      if (rt >= lt) {
        if (r.deleted_at) delete local[key]; else local[key] = r.color || 'yellow';
        meta.highlights[key] = rt;
      }
    }
    for (const key of new Set([...Object.keys(local), ...Object.keys(meta.highlights)])) {
      const [book, chapter, verse] = key.split('|');
      const r = rmap.get(key), rt = ms(r?.updated_at || r?.created_at), lt = Number(meta.highlights[key] || 0);
      if (!r || lt > rt) {
        queue({
          table:'highlights', key, kind:'upsert', conflict:'user_id,book,chapter,verse,translation_code',
          payload:{ book, chapter:Number(chapter), verse:Number(verse), translation_code:'ALL', color:local[key] || 'yellow', deleted_at: local[key] ? null : new Date(lt || Date.now()).toISOString() }
        });
      }
    }
    localStorage.setItem('highlights', JSON.stringify(local));
  }

  async function syncHistory(remote) {
    const local = parse('readingHistory', []);
    const map = new Map(local.map(h => [historyKey(h), h]));
    for (const r of remote) {
      const item = { book:r.book, chapter:r.chapter, verse:r.verse || 1, translation:r.translation_code || 'BSB', at:ms(r.opened_at) };
      const key = historyKey(item), old = map.get(key);
      if (!old || Number(item.at) > Number(old.at || 0)) map.set(key, item);
    }
    const merged = [...map.values()].sort((a,b) => Number(b.at||0) - Number(a.at||0)).slice(0,30);
    localStorage.setItem('readingHistory', JSON.stringify(merged));
    const remoteMap = new Map(remote.map(r => [historyKey(r), r]));
    for (const h of merged) {
      const r = remoteMap.get(historyKey(h));
      if (!r || Number(h.at||0) > ms(r.opened_at)) readingChanged(h);
    }
  }

  async function syncNow({ silent = false } = {}) {
    if (syncing) return;
    if (!client || !session?.user) {
      if (!silent) showAccount('Sign in to sync your notes and study library.');
      return;
    }
    if (!navigator.onLine) {
      if (!silent) setMessage('You are offline. Your local study data is safe and will sync when you reconnect.');
      return;
    }
    syncing = true;
    if (!silent) setMessage('Syncing…');
    try {
      await flushQueue(true);
      const uid = session.user.id;
      const [notesRes, marksRes, highRes, histRes] = await Promise.all([
        client.from('notes').select('book,chapter,verse,body,created_at,updated_at,deleted_at').eq('user_id',uid),
        client.from('bookmarks').select('book,chapter,verse,created_at,updated_at,deleted_at').eq('user_id',uid).eq('translation_code','ALL'),
        client.from('highlights').select('book,chapter,verse,color,created_at,updated_at,deleted_at').eq('user_id',uid).eq('translation_code','ALL'),
        client.from('reading_history').select('book,chapter,verse,translation_code,opened_at').eq('user_id',uid).order('opened_at',{ascending:false}).limit(60)
      ]);
      for (const r of [notesRes,marksRes,highRes,histRes]) if (r.error) throw r.error;
      const meta = getMeta();
      await syncNotes(meta, notesRes.data || []);
      await syncBookmarks(meta, marksRes.data || []);
      await syncHighlights(meta, highRes.data || []);
      await syncHistory(histRes.data || []);
      saveMeta(meta);
      await flushQueue(true);
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      updateUI();
      if (!silent) setMessage('Cloud sync complete.');
      if (window.state?.view === 'library' && typeof window.render === 'function') window.render();
    } catch (e) {
      console.error('Cloud sync failed', e);
      if (!silent) setMessage(e?.message || 'Cloud sync failed. Your local data is still safe.', true);
    } finally {
      syncing = false;
    }
  }

  async function signIn() {
    if (!client) return setMessage('Cloud service is not available right now.', true);
    const email = ($('#cloudEmail')?.value || '').trim();
    const password = $('#cloudPassword')?.value || '';
    if (!email || !password) return setMessage('Enter your email and password.', true);
    setMessage('Signing in…');
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return setMessage(error.message, true);
    setMessage('Signed in. Syncing your study library…');
  }

  async function signUp() {
    if (!client) return setMessage('Cloud service is not available right now.', true);
    const email = ($('#cloudEmail')?.value || '').trim();
    const password = $('#cloudPassword')?.value || '';
    if (!email || password.length < 8) return setMessage('Use a valid email and a password with at least 8 characters.', true);
    setMessage('Creating account…');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) return setMessage(error.message, true);
    if (data.session) setMessage('Account created. Syncing…');
    else setMessage('Account created. Check your email to confirm it, then return here and sign in.');
  }

  async function signOut() {
    if (!client) return;
    await flushQueue(true);
    const { error } = await client.auth.signOut();
    if (error) return setMessage(error.message, true);
    setMessage('Signed out. Your local Bible and study data remain on this device.');
  }

  function showAccount(message = '') {
    updateUI();
    if (message) setMessage(message);
    $('#accountDialog')?.showModal();
  }

  async function init() {
    $('#accountBtn')?.addEventListener('click', () => showAccount());
    $('#cloudSignInBtn')?.addEventListener('click', signIn);
    $('#cloudSignUpBtn')?.addEventListener('click', signUp);
    $('#cloudSignOutBtn')?.addEventListener('click', signOut);
    $('#cloudSyncBtn')?.addEventListener('click', () => syncNow());
    $('#cloudPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });

    if (!window.supabase?.createClient) {
      setMessage('Cloud sync could not load. The Bible app still works normally offline.', true);
      updateUI();
      return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await client.auth.getSession();
    if (!error) session = data.session;
    updateUI();

    client.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      updateUI();
      if (newSession && ['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
        setTimeout(() => syncNow({ silent: true }), 0);
      }
    });

    window.addEventListener('online', () => { if (session) syncNow({ silent: true }); });
    if (session && navigator.onLine) syncNow({ silent: true });
  }

  window.ScriptureCloud = {
    init, showAccount, syncNow, updateUI,
    noteChanged, bookmarkChanged, highlightChanged, readingChanged, preferencesChanged,
    isSignedIn: () => !!session?.user,
    user: () => session?.user || null
  };

  init();
})();
