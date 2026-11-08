// AnimeStream custom database accounts. This build does NOT use Supabase Auth.
// Password verification and session creation happen inside account-api on the server.
'use strict';
const ACCOUNT_TOKEN_KEY = 'animestream.accountToken.v1';
const SYNC_AT_KEY = 'animestream.syncedAt.v1';
const SYNC_KEYS = [
  'animestream.mylist.v1','animestream.continue.v1','animestream.progress.v1',
  'animestream.mangaprogress.v1','animestream.lang','animestream.autonext',
  'animestream.manga.saver','player_settings'
];
const authCfg = window.AUTH_CONFIG || {};
const AUTH_ON = !!(authCfg.url && authCfg.key && authCfg.accountApi);
let accountUser = null, accountToken = '', accountPushTimer = null, accountBusy = false;
let accountApplyingCloud = false, accountRevision = 0, accountPushedRevision = 0, accountPushing = false, accountPushAgain = false;
const accountRawSet = Storage.prototype.setItem;
function accountRead(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }
function accountRaw(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function accountWrite(k,v) { accountApplyingCloud=true; try { accountRawSet.call(localStorage,k,JSON.stringify(v)); } finally { accountApplyingCloud=false; } }
function accountWriteRaw(k,v) { accountApplyingCloud=true; try { accountRawSet.call(localStorage,k,String(v)); } finally { accountApplyingCloud=false; } }
function accountSnapshot() {
  const preferences={};
  for (const [k,n] of [['animestream.lang','language'],['animestream.autonext','auto_next'],['animestream.manga.saver','manga_saver']]) { const v=accountRaw(k); if(v!==null) preferences[n]=v; }
  const ps=accountRead('player_settings'); if(ps&&typeof ps==='object'&&!Array.isArray(ps)) preferences.player_settings=ps;
  return {
    my_list: accountRead('animestream.mylist.v1') || [],
    continue_watching: accountRead('animestream.continue.v1') || [],
    watch_progress: accountRead('animestream.progress.v1') || {},
    manga_progress: accountRead('animestream.mangaprogress.v1') || {}, preferences
  };
}
function accountApply(data) {
  accountWrite('animestream.mylist.v1',Array.isArray(data?.my_list)?data.my_list:[]);
  accountWrite('animestream.continue.v1',Array.isArray(data?.continue_watching)?data.continue_watching:[]);
  accountWrite('animestream.progress.v1',data?.watch_progress||{});
  accountWrite('animestream.mangaprogress.v1',data?.manga_progress||{});
  const p=data?.preferences||{};
  if(p.language!=null) accountWriteRaw('animestream.lang',p.language);
  if(p.auto_next!=null) accountWriteRaw('animestream.autonext',p.auto_next);
  if(p.manga_saver!=null) accountWriteRaw('animestream.manga.saver',p.manga_saver);
  if(p.player_settings&&typeof p.player_settings==='object') accountWrite('player_settings',p.player_settings);
}
function accountMerge(local,remote) {
  const mergeList=(a,b)=>{const out=[],idx=new Map();[...(a||[]),...(b||[])].forEach(x=>{const k=typeof mediaKey==='function'?mediaKey(x):JSON.stringify(x);if(!idx.has(k)){idx.set(k,out.length);out.push(x);}else if(Number(x?._updatedAt||x?._savedAt||0)>Number(out[idx.get(k)]?._updatedAt||out[idx.get(k)]?._savedAt||0))out[idx.get(k)]=x;});return out.slice(0,300);};
  const progress={...(remote?.watch_progress||{})};Object.entries(local?.watch_progress||{}).forEach(([k,v])=>{if(!progress[k]||(v?.t||0)>=(progress[k]?.t||0))progress[k]=v;});
  return {my_list:mergeList(local.my_list,remote?.my_list),continue_watching:mergeList(local.continue_watching,remote?.continue_watching).slice(0,60),watch_progress:progress,manga_progress:{...(remote?.manga_progress||{}),...(local?.manga_progress||{})},preferences:{...(remote?.preferences||{}),...(local?.preferences||{})}};
}
function accountTokenValue(){return accountToken||accountRaw(ACCOUNT_TOKEN_KEY)||'';}
window.accountTokenValue=accountTokenValue;
async function accountApi(action,payload={},withToken=true) {
  if(!AUTH_ON) throw new Error('Account service is not configured.');
  const token=withToken?accountTokenValue():'';
  const headers={'Content-Type':'application/json','apikey':authCfg.key};
  if(token) headers.Authorization='Bearer '+token;
  const res=await fetch(authCfg.accountApi,{method:'POST',headers,cache:'no-store',credentials:'omit',body:JSON.stringify({action,...payload})});
  let data={};try{data=await res.json();}catch(_){}
  if(!res.ok){const e=new Error(data.error||'Account request failed.');e.status=res.status;throw e;}
  return data;
}
window.accountApi=accountApi;
function accountName(u){return String(u?.display_name||(u?.email||'Member').split('@')[0]).slice(0,40)||'Member';}
function applyAccount(user){accountUser=user||null;if(user){const old=readProfile();writeProfile({name:accountName(user),email:user.email,cloud:true,created:old?.cloud?old.created:(Date.parse(user.created_at)||Date.now())});}else{const old=readProfile();if(old?.cloud)localStorage.removeItem(PROFILE_KEY);}renderProfileChrome();}
function accountError(message){const el=document.getElementById('authError');if(el){el.textContent=message||'';el.hidden=!message;}}
function accountStatus(message){const el=document.getElementById('authStatus');if(el){el.textContent=message||'';el.hidden=!message;}}
function setAuthMode(mode){accountError('');accountStatus('');window.authMode=mode==='signup'?'signup':'signin';const signup=window.authMode==='signup';const title=document.getElementById('authTitle'),submit=document.getElementById('authSubmit'),confirm=document.getElementById('authConfirmWrap'),footIn=document.getElementById('authActionsSignin'),footUp=document.getElementById('authActionsSignup');if(title)title.textContent=signup?'Create your AnimeStream account':'Sign in to AnimeStream';if(submit)submit.textContent=signup?'Create account':'Sign in';if(confirm)confirm.hidden=!signup;if(footIn)footIn.hidden=signup;if(footUp)footUp.hidden=!signup;const pass=document.getElementById('authPassword'),confirmInput=document.getElementById('authPasswordConfirm');if(pass)pass.autocomplete=signup?'new-password':'current-password';if(confirmInput){confirmInput.required=signup;confirmInput.value='';}['signin','signup'].forEach(m=>{const el=document.getElementById(m==='signin'?'authTabSignin':'authTabSignup');if(el){el.classList.toggle('active',window.authMode===m);el.setAttribute('aria-selected',String(window.authMode===m));}});}
function setAccountBusy(busy){accountBusy=!!busy;const btn=document.getElementById('authSubmit');if(btn){btn.disabled=accountBusy;btn.textContent=accountBusy?'Please wait…':(window.authMode==='signup'?'Create account':'Sign in');}}
async function handleAuthSubmit(e){if(e)e.preventDefault();if(accountBusy)return false;accountError('');accountStatus('');const emailEl=document.getElementById('authEmail'),passEl=document.getElementById('authPassword'),confirmEl=document.getElementById('authPasswordConfirm');const email=String(emailEl?.value||'').trim().toLowerCase(),password=String(passEl?.value||'');if(!emailEl?.checkValidity()){accountError('Enter a valid email address.');emailEl?.focus();return false;}if(password.length<8){accountError('Use a password with at least 8 characters.');passEl?.focus();return false;}if(window.authMode==='signup'&&password!==String(confirmEl?.value||'')){accountError('The passwords do not match.');confirmEl?.focus();return false;}setAccountBusy(true);try{const result=await accountApi(window.authMode,{email,password},false);accountToken=result.token;accountRawSet.call(localStorage,ACCOUNT_TOKEN_KEY,accountToken);accountRawSet.call(localStorage,SYNC_AT_KEY,result.library?.updated_at||'');applyAccount(result.account);const merged=accountMerge(accountSnapshot(),result.library||{});accountApply(merged);await accountPushNow();closeLogin();if(passEl)passEl.value='';if(confirmEl)confirmEl.value='';flashNote(window.authMode==='signup'?'Your AnimeStream account is ready.':'Welcome back. Your library is synced.');if(window.roomsResumePending)window.roomsResumePending();if(window.pendingAccountOpen){window.pendingAccountOpen=false;openAccount(true);}}catch(err){accountError(err.message||'Could not complete account request.');}finally{setAccountBusy(false);}return false;}
window.handleAuthSubmit=handleAuthSubmit;window.setAuthMode=setAuthMode;
async function accountPushNow(){if(!accountUser||!accountToken)return false;if(accountPushing){accountPushAgain=true;return false;}accountPushing=true;let ok=true;try{do{accountPushAgain=false;const rev=accountRevision;const result=await accountApi('sync',{library:accountSnapshot()});accountRawSet.call(localStorage,SYNC_AT_KEY,result.updated_at||new Date().toISOString());accountPushedRevision=rev;if(accountRevision!==rev)accountPushAgain=true;}while(accountPushAgain);}catch(e){ok=false;if(e.status===401)expireAccountSession();console.warn('Account sync failed',e.message);}finally{accountPushing=false;if(accountPushAgain)scheduleAccountPush();}return ok;}
function scheduleAccountPush(){if(!accountUser)return;clearTimeout(accountPushTimer);accountPushTimer=setTimeout(()=>accountPushNow(),800);}
Storage.prototype.setItem=function(k,v){accountRawSet.call(this,k,v);if(!accountApplyingCloud&&this===localStorage&&SYNC_KEYS.includes(k)){accountRevision++;scheduleAccountPush();if(typeof activeRoom!=='undefined'&&activeRoom&&currentScreenId==='accountView')setTimeout(renderAccountView,0);}};
function expireAccountSession(){accountToken='';localStorage.removeItem(ACCOUNT_TOKEN_KEY);applyAccount(null);flashNote('Your session expired. Please sign in again.');}
let accountReadyResolve;window.accountReady=new Promise(resolve=>accountReadyResolve=resolve);
async function initCustomAccount(){if(!AUTH_ON){accountReadyResolve(false);return;}document.documentElement.classList.add('auth-enabled');renderProfileChrome();accountToken=accountRaw(ACCOUNT_TOKEN_KEY)||'';if(!accountToken){accountReadyResolve(false);return;}try{const data=await accountApi('session');applyAccount(data.account);const merged=accountMerge(accountSnapshot(),data.library||{});accountApply(merged);await accountPushNow();accountReadyResolve(true);}catch(e){if(e.status===401){localStorage.removeItem(ACCOUNT_TOKEN_KEY);accountToken='';applyAccount(null);accountReadyResolve(false);}else{console.warn('Account service unavailable; local browsing continues.',e.message);accountReadyResolve(false);}}}
function profileAuthAction(){if(!accountUser){openLogin();return;}accountPushNow().then(async ok=>{if(!ok){flashNote('Your latest changes could not be saved. Try again before signing out.');return;}try{await accountApi('logout');}catch(e){if(e.status!==401){flashNote('Could not sign out. Try again.');return;}}accountToken='';localStorage.removeItem(ACCOUNT_TOKEN_KEY);SYNC_KEYS.forEach(k=>localStorage.removeItem(k));localStorage.removeItem(SYNC_AT_KEY);applyAccount(null);updateSavedCount();toggleProfileMenu(true);flashNote('Signed out. Your library remains saved to your account.');});}
window.profileAuthAction=profileAuthAction;
if(AUTH_ON){document.documentElement.classList.add('auth-enabled');renderProfileChrome();setAuthMode('signin');}

function accountEscape(v){return typeof escHtml==='function'?escHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderAccountView(){
  if(!accountUser)return;
  const snap=accountSnapshot();
  const heading=document.getElementById('accountHeading'),email=document.getElementById('accountEmail');
  if(heading)heading.textContent=accountName(accountUser);if(email)email.textContent=accountUser.email||'';
  const count=(id,n,label)=>{const el=document.getElementById(id);if(el)el.textContent=`${n} ${label}${n===1?'':'s'}`;};
  count('accountSavedCount',(snap.my_list||[]).length,'saved title');count('accountContinueCount',(snap.continue_watching||[]).length,'continue item');count('accountWatchCount',Object.keys(snap.watch_progress||{}).length,'watch position');
  const draw=(id,items,storageKey)=>{const el=document.getElementById(id);if(!el)return;el.innerHTML=items.length?items.map(item=>{const k=typeof mediaKey==='function'?mediaKey(item):'';return `<div class="account-item">${cardHTML(item)}<button type="button" onclick="removeAccountSaved('${storageKey}','${encodeURIComponent(k)}')"><i class="ri-delete-bin-line"></i> Remove</button></div>`;}).join(''):'<p class="account-empty">Nothing saved here yet.</p>';};
  draw('accountMyListGrid',snap.my_list||[],'animestream.mylist.v1');draw('accountContinueGrid',snap.continue_watching||[],'animestream.continue.v1');
  const rows=document.getElementById('accountWatchRows');if(rows){const entries=Object.entries(snap.watch_progress||{});rows.innerHTML=entries.length?entries.map(([k,v])=>`<div class="account-watch-row"><span>${accountEscape(k)}</span><button type="button" onclick="removeAccountSaved('animestream.progress.v1','${encodeURIComponent(k)}')">Remove</button></div>`).join(''):'<p class="account-empty">No watch progress saved yet.</p>';}
}
function openAccount(){if(!accountUser){openLogin();return;}renderAccountView();toggleProfileMenu(true);showPage('accountView');if(!applyingHistory)pushHist({kind:'account'});}
function removeAccountSaved(storeKey,encoded){const key=decodeURIComponent(encoded||'');const value=accountRead(storeKey);if(Array.isArray(value))accountWrite(storeKey,value.filter(item=>mediaKey(item)!==key));else if(value&&typeof value==='object'){delete value[key];accountWrite(storeKey,value);}accountRevision++;scheduleAccountPush();updateSavedCount();renderAccountView();roomToastSafe('Removed from your saved account data.');}
function roomToastSafe(message){if(typeof flashNote==='function')flashNote(message);}
window.openAccount=openAccount;window.renderAccountView=renderAccountView;window.removeAccountSaved=removeAccountSaved;

initCustomAccount();
